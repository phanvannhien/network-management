package auth

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base32"
	"encoding/base64"
	"errors"
	"fmt"
	"image/png"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/pquerna/otp"
	"github.com/pquerna/otp/totp"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/secrets"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/store"
)

const (
	totpIssuer        = "Network Topology Builder"
	totpPeriod        = 30 // seconds
	totpSkewSteps     = 1  // accept the previous/next step to tolerate clock drift
	recoveryCodeCount = 10
)

var (
	ErrMFAAlreadyEnabled = errors.New("mfa already enabled")
	ErrMFANotPending     = errors.New("mfa enrollment not started")
	ErrMFANotEnabled     = errors.New("mfa not enabled")
	ErrMFARequired       = errors.New("mfa is mandatory for this account")
	ErrInvalidMFACode    = errors.New("invalid mfa code")
)

// Access describes what a session may do (ADR-019: MFA mandatory for system admins and org owners/admins).
type Access int

const (
	AccessFull          Access = iota
	AccessNeedsMFA             // MFA enabled, code not yet entered this session
	AccessNeedsMFASetup        // MFA mandatory for this user but not enrolled yet
)

// Access returns the session's access level.
func (s Session) Access() Access {
	switch {
	case s.MFAEnabled && !s.MFAVerified:
		return AccessNeedsMFA
	case !s.MFAEnabled && s.MFARequired:
		return AccessNeedsMFASetup
	default:
		return AccessFull
	}
}

// TOTPSetup is returned once when enrollment starts.
type TOTPSetup struct {
	Secret     string // base32, for manual entry
	OtpauthURL string
	QRDataURL  string // data:image/png;base64,...
}

func totpAAD(s Session) []byte { return secrets.TOTPAAD(uuidString(s.UserID.Bytes)) }

// SetupTOTP starts (or restarts) enrollment with a fresh seed, envelope-encrypted at rest.
func (s *Service) SetupTOTP(ctx context.Context, sess Session, meta RequestMeta) (TOTPSetup, error) {
	if sess.MFAEnabled {
		return TOTPSetup{}, ErrMFAAlreadyEnabled
	}
	key, err := totp.Generate(totp.GenerateOpts{Issuer: totpIssuer, AccountName: sess.Email, Period: totpPeriod})
	if err != nil {
		return TOTPSetup{}, fmt.Errorf("generate totp key: %w", err)
	}
	sealed, err := s.keys.Seal([]byte(key.Secret()), totpAAD(sess))
	if err != nil {
		return TOTPSetup{}, fmt.Errorf("seal totp secret: %w", err)
	}
	n, err := s.q.UpsertPendingTOTP(ctx, store.UpsertPendingTOTPParams{
		UserID: sess.UserID, SecretCiphertext: sealed.Ciphertext, WrappedDek: sealed.WrappedDEK, KeyVersion: sealed.KeyVersion,
	})
	if err != nil {
		return TOTPSetup{}, fmt.Errorf("store pending totp: %w", err)
	}
	if n == 0 {
		// MFA got enabled since this session was loaded (another tab / concurrent request): never hand out
		// a QR code for a seed that was not stored.
		return TOTPSetup{}, ErrMFAAlreadyEnabled
	}
	img, err := key.Image(240, 240)
	if err != nil {
		return TOTPSetup{}, fmt.Errorf("render qr: %w", err)
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return TOTPSetup{}, fmt.Errorf("encode qr: %w", err)
	}
	s.audit(ctx, sess.UserID, "mfa.setup", sess.Email, meta)
	return TOTPSetup{
		Secret:     key.Secret(),
		OtpauthURL: key.URL(),
		QRDataURL:  "data:image/png;base64," + base64.StdEncoding.EncodeToString(buf.Bytes()),
	}, nil
}

// EnableTOTP confirms enrollment with a valid code, issues recovery codes (returned once) and marks
// the current session as MFA-verified — all in one transaction.
func (s *Service) EnableTOTP(ctx context.Context, sess Session, code string, meta RequestMeta) ([]string, error) {
	// Own bucket (also for disabling): setting MFA up must not use the attempts the next sign-in needs.
	if !s.mfaLimit.Allow("mfa-setup:" + uuidString(sess.UserID.Bytes)) {
		return nil, ErrRateLimited
	}
	row, err := s.q.GetTOTP(ctx, sess.UserID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrMFANotPending
	}
	if err != nil {
		return nil, fmt.Errorf("load totp: %w", err)
	}
	if row.EnabledAt.Valid {
		return nil, ErrMFAAlreadyEnabled
	}
	step, ok, err := s.matchTOTP(row, sess, code)
	if err != nil {
		return nil, err
	}
	if !ok {
		s.audit(ctx, sess.UserID, "mfa.enable_failed", sess.Email, meta)
		return nil, ErrInvalidMFACode
	}

	codes, hashes, err := newRecoveryCodes()
	if err != nil {
		return nil, err
	}
	err = s.withTx(ctx, func(q store.Querier) error {
		n, err := q.EnableTOTP(ctx, store.EnableTOTPParams{UserID: sess.UserID, Step: step})
		if err != nil {
			return fmt.Errorf("enable totp: %w", err)
		}
		if n != 1 {
			return ErrMFAAlreadyEnabled // concurrent enable won
		}
		if err := q.DeleteRecoveryCodes(ctx, sess.UserID); err != nil {
			return fmt.Errorf("clear recovery codes: %w", err)
		}
		for _, h := range hashes {
			if err := q.InsertRecoveryCode(ctx, store.InsertRecoveryCodeParams{UserID: sess.UserID, CodeHash: h}); err != nil {
				return fmt.Errorf("store recovery code: %w", err)
			}
		}
		return q.MarkSessionMFAVerified(ctx, sess.TokenHash)
	})
	if err != nil {
		return nil, err
	}
	s.audit(ctx, sess.UserID, "mfa.enable", sess.Email, meta)
	return codes, nil
}

// VerifyMFA completes sign-in for a session with MFA enabled, using a TOTP code or a recovery code.
func (s *Service) VerifyMFA(ctx context.Context, sess Session, code, recoveryCode string, meta RequestMeta) error {
	if !sess.MFAEnabled {
		return ErrMFANotEnabled
	}
	if !s.mfaLimit.Allow("mfa:" + uuidString(sess.UserID.Bytes)) {
		s.audit(ctx, sess.UserID, "mfa.verify_rate_limited", sess.Email, meta)
		return ErrRateLimited
	}

	action := "mfa.verify"
	ok := false
	switch {
	case strings.TrimSpace(code) != "":
		row, err := s.q.GetTOTP(ctx, sess.UserID)
		if err != nil {
			return fmt.Errorf("load totp: %w", err)
		}
		step, match, err := s.matchTOTP(row, sess, code)
		if err != nil {
			return err
		}
		if match {
			// Claim the step atomically: the same code (or an older one) cannot be replayed.
			n, err := s.q.ClaimTOTPStep(ctx, store.ClaimTOTPStepParams{UserID: sess.UserID, Step: step})
			if err != nil {
				return fmt.Errorf("claim totp step: %w", err)
			}
			ok = n == 1
		}
	case strings.TrimSpace(recoveryCode) != "":
		n, err := s.q.UseRecoveryCode(ctx, store.UseRecoveryCodeParams{
			UserID: sess.UserID, CodeHash: hashRecoveryCode(recoveryCode),
		})
		if err != nil {
			return fmt.Errorf("use recovery code: %w", err)
		}
		ok = n == 1
		action = "mfa.recovery_code_used"
	}
	if !ok {
		s.audit(ctx, sess.UserID, "mfa.verify_failed", sess.Email, meta)
		// Wrong codes count like wrong passwords: enough of them lock the account and end its sessions.
		if _, err := s.recordFailure(ctx, sess.UserID); err != nil {
			return err
		}
		return ErrInvalidMFACode
	}
	if err := s.q.ResetLoginFailures(ctx, sess.UserID); err != nil {
		return fmt.Errorf("reset failures: %w", err)
	}
	if err := s.q.MarkSessionMFAVerified(ctx, sess.TokenHash); err != nil {
		return fmt.Errorf("mark session verified: %w", err)
	}
	s.audit(ctx, sess.UserID, action, sess.Email, meta)
	return nil
}

// DisableTOTP removes MFA after a fresh valid code. Not allowed when MFA is mandatory for the user.
func (s *Service) DisableTOTP(ctx context.Context, sess Session, code string, meta RequestMeta) error {
	if !sess.MFAEnabled {
		return ErrMFANotEnabled
	}
	if !s.mfaLimit.Allow("mfa-setup:" + uuidString(sess.UserID.Bytes)) {
		return ErrRateLimited
	}
	if sess.MFARequired {
		return ErrMFARequired
	}
	row, err := s.q.GetTOTP(ctx, sess.UserID)
	if err != nil {
		return fmt.Errorf("load totp: %w", err)
	}
	step, match, err := s.matchTOTP(row, sess, code)
	if err != nil {
		return err
	}
	if match {
		n, err := s.q.ClaimTOTPStep(ctx, store.ClaimTOTPStepParams{UserID: sess.UserID, Step: step})
		if err != nil {
			return fmt.Errorf("claim totp step: %w", err)
		}
		match = n == 1
	}
	if !match {
		s.audit(ctx, sess.UserID, "mfa.disable_failed", sess.Email, meta)
		if _, err := s.recordFailure(ctx, sess.UserID); err != nil {
			return err
		}
		return ErrInvalidMFACode
	}
	err = s.withTx(ctx, func(q store.Querier) error {
		if err := q.DeleteRecoveryCodes(ctx, sess.UserID); err != nil {
			return fmt.Errorf("delete recovery codes: %w", err)
		}
		return q.DeleteTOTP(ctx, sess.UserID)
	})
	if err != nil {
		return err
	}
	s.audit(ctx, sess.UserID, "mfa.disable", sess.Email, meta)
	return nil
}

// matchTOTP decrypts the seed and checks code against the current step ± skew, returning the matched step.
func (s *Service) matchTOTP(row store.MfaTotp, sess Session, code string) (int64, bool, error) {
	seed, err := s.keys.Open(secrets.Sealed{
		Ciphertext: row.SecretCiphertext, WrappedDEK: row.WrappedDek, KeyVersion: row.KeyVersion,
	}, totpAAD(sess))
	if err != nil {
		return 0, false, fmt.Errorf("open totp secret: %w", err)
	}
	code = strings.ReplaceAll(strings.TrimSpace(code), " ", "")
	now := s.now()
	for skew := -totpSkewSteps; skew <= totpSkewSteps; skew++ {
		t := now.Add(time.Duration(skew*totpPeriod) * time.Second)
		want, err := totp.GenerateCodeCustom(string(seed), t, totp.ValidateOpts{
			Period: totpPeriod, Digits: otp.DigitsSix, Algorithm: otp.AlgorithmSHA1,
		})
		if err != nil {
			return 0, false, fmt.Errorf("generate totp code: %w", err)
		}
		if subtle.ConstantTimeCompare([]byte(code), []byte(want)) == 1 {
			return t.Unix() / totpPeriod, true, nil
		}
	}
	return 0, false, nil
}

// newRecoveryCodes returns display codes (XXXX-XXXX-XXXX-XXXX, 80 bits each) and their hashes.
func newRecoveryCodes() ([]string, [][]byte, error) {
	enc := base32.StdEncoding.WithPadding(base32.NoPadding)
	codes := make([]string, 0, recoveryCodeCount)
	hashes := make([][]byte, 0, recoveryCodeCount)
	for range recoveryCodeCount {
		b := make([]byte, 10)
		if _, err := rand.Read(b); err != nil {
			return nil, nil, fmt.Errorf("generate recovery code: %w", err)
		}
		raw := enc.EncodeToString(b) // 16 chars
		codes = append(codes, raw[0:4]+"-"+raw[4:8]+"-"+raw[8:12]+"-"+raw[12:16])
		hashes = append(hashes, hashRecoveryCode(raw))
	}
	return codes, hashes, nil
}

// hashRecoveryCode normalizes (case, dashes, spaces) before hashing so users can type codes loosely.
func hashRecoveryCode(code string) []byte {
	normalized := strings.ToUpper(strings.NewReplacer("-", "", " ", "").Replace(code))
	sum := sha256.Sum256([]byte(normalized))
	return sum[:]
}

func uuidString(b [16]byte) string {
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
