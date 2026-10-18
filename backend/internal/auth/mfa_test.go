package auth

import (
	"bytes"
	"context"
	"errors"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/pquerna/otp"
	"github.com/pquerna/otp/totp"
)

func codeAt(t *testing.T, secret string, at time.Time) string {
	t.Helper()
	c, err := totp.GenerateCodeCustom(secret, at, totp.ValidateOpts{Period: 30, Digits: otp.DigitsSix, Algorithm: otp.AlgorithmSHA1})
	if err != nil {
		t.Fatalf("generate code: %v", err)
	}
	return c
}

// loginAs signs in and returns the looked-up session (with MFA state).
func loginAs(t *testing.T, svc *Service, email, password string) Session {
	t.Helper()
	res, err := svc.Login(context.Background(), email, password, meta)
	if err != nil {
		t.Fatalf("login %s: %v", email, err)
	}
	sess, err := svc.Lookup(context.Background(), res.Token)
	if err != nil {
		t.Fatalf("lookup: %v", err)
	}
	return sess
}

func TestMFAEnrollVerifyReplayAndRecovery(t *testing.T) {
	svc, q, pool := newTestService(t)
	ctx := context.Background()
	clock := time.Now()
	svc.now = func() time.Time { return clock }
	user, _ := svc.CreateUser(ctx, "m@example.com", "M", "a-strong-password", false)

	sess := loginAs(t, svc, "m@example.com", "a-strong-password")
	if sess.Access() != AccessFull || sess.MFAEnabled {
		t.Fatalf("non-admin without MFA should have full access: %+v", sess)
	}

	setup, err := svc.SetupTOTP(ctx, sess, meta)
	if err != nil {
		t.Fatalf("setup: %v", err)
	}
	if !strings.HasPrefix(setup.QRDataURL, "data:image/png;base64,") || !strings.HasPrefix(setup.OtpauthURL, "otpauth://totp/") {
		t.Fatalf("unexpected setup payload: %+v", setup.OtpauthURL)
	}
	// The seed is stored encrypted, never in plaintext.
	row, _ := q.GetTOTP(ctx, user.ID)
	if bytes.Contains(row.SecretCiphertext, []byte(setup.Secret)) || bytes.Contains(row.WrappedDek, []byte(setup.Secret)) {
		t.Fatal("TOTP secret stored in plaintext")
	}

	if _, err := svc.EnableTOTP(ctx, sess, "000000", meta); !errors.Is(err, ErrInvalidMFACode) {
		t.Fatalf("wrong enable code: %v", err)
	}
	enableCode := codeAt(t, setup.Secret, clock)
	codes, err := svc.EnableTOTP(ctx, sess, enableCode, meta)
	if err != nil {
		t.Fatalf("enable: %v", err)
	}
	if len(codes) != 10 || !regexp.MustCompile(`^[A-Z2-7]{4}(-[A-Z2-7]{4}){3}$`).MatchString(codes[0]) {
		t.Fatalf("recovery codes = %v", codes)
	}
	var stored int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM mfa_recovery_codes WHERE code_hash = $1`, []byte(codes[0])).Scan(&stored)
	if stored != 0 {
		t.Fatal("recovery code stored in plaintext")
	}
	if _, err := svc.SetupTOTP(ctx, sess, meta); !errors.Is(err, ErrMFAAlreadyEnabled) {
		t.Fatalf("setup while enabled must be refused: %v", err)
	}

	// New sign-in now needs the second factor.
	sess2 := loginAs(t, svc, "m@example.com", "a-strong-password")
	if sess2.Access() != AccessNeedsMFA {
		t.Fatalf("access = %v, want AccessNeedsMFA", sess2.Access())
	}
	// Replay: the code used for enabling (same time step) is rejected.
	if err := svc.VerifyMFA(ctx, sess2, enableCode, "", meta); !errors.Is(err, ErrInvalidMFACode) {
		t.Fatalf("replayed code accepted: %v", err)
	}
	clock = clock.Add(30 * time.Second)
	if err := svc.VerifyMFA(ctx, sess2, codeAt(t, setup.Secret, clock), "", meta); err != nil {
		t.Fatalf("verify with fresh code: %v", err)
	}

	// Recovery codes work once, typed loosely (lowercase, no dashes).
	sess3 := loginAs(t, svc, "m@example.com", "a-strong-password")
	loose := strings.ToLower(strings.ReplaceAll(codes[0], "-", ""))
	if err := svc.VerifyMFA(ctx, sess3, "", loose, meta); err != nil {
		t.Fatalf("recovery code: %v", err)
	}
	sess4 := loginAs(t, svc, "m@example.com", "a-strong-password")
	if err := svc.VerifyMFA(ctx, sess4, "", codes[0], meta); !errors.Is(err, ErrInvalidMFACode) {
		t.Fatalf("used recovery code accepted again: %v", err)
	}
	if n, _ := q.CountUnusedRecoveryCodes(ctx, user.ID); n != 9 {
		t.Fatalf("unused recovery codes = %d, want 9", n)
	}

	// Voluntary users may disable MFA with a fresh code (sess2 was loaded after enabling and verified above).
	sess2.MFAVerified = true
	clock = clock.Add(30 * time.Second)
	if err := svc.DisableTOTP(ctx, sess2, codeAt(t, setup.Secret, clock), meta); err != nil {
		t.Fatalf("disable: %v", err)
	}
	if _, err := q.GetTOTP(ctx, user.ID); err == nil {
		t.Fatal("TOTP row still present after disable")
	}
}

func TestMFARequiredForSystemAdmin(t *testing.T) {
	svc, _, _ := newTestService(t)
	ctx := context.Background()
	clock := time.Now()
	svc.now = func() time.Time { return clock }
	_, _ = svc.CreateUser(ctx, "root@example.com", "Root", "a-strong-password", true)

	sess := loginAs(t, svc, "root@example.com", "a-strong-password")
	if sess.Access() != AccessNeedsMFASetup || !sess.MFARequired {
		t.Fatalf("system admin without MFA: access = %v, want AccessNeedsMFASetup", sess.Access())
	}
	setup, err := svc.SetupTOTP(ctx, sess, meta)
	if err != nil {
		t.Fatalf("setup: %v", err)
	}
	if _, err := svc.EnableTOTP(ctx, sess, codeAt(t, setup.Secret, clock), meta); err != nil {
		t.Fatalf("enable: %v", err)
	}
	sess.MFAEnabled, sess.MFAVerified = true, true
	clock = clock.Add(30 * time.Second)
	if err := svc.DisableTOTP(ctx, sess, codeAt(t, setup.Secret, clock), meta); !errors.Is(err, ErrMFARequired) {
		t.Fatalf("admin disabled mandatory MFA: %v", err)
	}
}

func TestMFAVerifyRateLimited(t *testing.T) {
	svc, _, _ := newTestService(t)
	ctx := context.Background()
	clock := time.Now()
	svc.now = func() time.Time { return clock }
	_, _ = svc.CreateUser(ctx, "r@example.com", "R", "a-strong-password", false)
	sess := loginAs(t, svc, "r@example.com", "a-strong-password")
	setup, _ := svc.SetupTOTP(ctx, sess, meta)
	if _, err := svc.EnableTOTP(ctx, sess, codeAt(t, setup.Secret, clock), meta); err != nil {
		t.Fatalf("enable: %v", err)
	}
	sess.MFAEnabled = true

	var last error
	for range 6 {
		last = svc.VerifyMFA(ctx, sess, "123456", "", meta)
	}
	if !errors.Is(last, ErrRateLimited) {
		t.Fatalf("6th wrong code within a minute: want ErrRateLimited, got %v", last)
	}
}

func TestMFASecretBoundToUser(t *testing.T) {
	svc, q, pool := newTestService(t)
	ctx := context.Background()
	a, _ := svc.CreateUser(ctx, "a@example.com", "A", "a-strong-password", false)
	b, _ := svc.CreateUser(ctx, "b@example.com", "B", "a-strong-password", false)
	sessA := loginAs(t, svc, "a@example.com", "a-strong-password")
	sessB := loginAs(t, svc, "b@example.com", "a-strong-password")
	setupA, _ := svc.SetupTOTP(ctx, sessA, meta)

	// Copy A's sealed seed onto B's row: it must not decrypt for B (AAD binds it to the user).
	rowA, _ := q.GetTOTP(ctx, a.ID)
	if _, err := pool.Exec(ctx,
		`INSERT INTO mfa_totp (user_id, secret_ciphertext, wrapped_dek, key_version) VALUES ($1, $2, $3, $4)`,
		b.ID, rowA.SecretCiphertext, rowA.WrappedDek, rowA.KeyVersion); err != nil {
		t.Fatalf("copy row: %v", err)
	}
	if _, err := svc.EnableTOTP(ctx, sessB, codeAt(t, setupA.Secret, time.Now()), meta); err == nil {
		t.Fatal("seed copied from another user was accepted")
	}
}

// Someone holding the password cannot reset the wrong-code count by signing in again: the count only resets after a
// right code, so enough wrong codes across sign-ins lock the account and end its sessions.
func TestMFAFailuresSurviveNewSignIn(t *testing.T) {
	svc, q, _ := newTestService(t)
	ctx := context.Background()
	clock := time.Now()
	svc.now = func() time.Time { return clock }
	for _, l := range []*RateLimiter{svc.idLimit, svc.ipLimit, svc.mfaLimit} {
		l.now = func() time.Time { return clock }
	}
	user, _ := svc.CreateUser(ctx, "g@example.com", "G", "a-strong-password", false)
	sess := loginAs(t, svc, "g@example.com", "a-strong-password")
	setup, err := svc.SetupTOTP(ctx, sess, meta)
	if err != nil {
		t.Fatalf("setup: %v", err)
	}
	if _, err := svc.EnableTOTP(ctx, sess, codeAt(t, setup.Secret, clock), meta); err != nil {
		t.Fatalf("enable: %v", err)
	}
	wrong := func(s Session, n int) {
		for i := 0; i < n; i++ {
			clock = clock.Add(time.Minute)
			if err := svc.VerifyMFA(ctx, s, "000000", "", meta); !errors.Is(err, ErrInvalidMFACode) {
				t.Fatalf("wrong code: %v", err)
			}
		}
	}
	clock = clock.Add(time.Minute)
	wrong(loginAs(t, svc, "g@example.com", "a-strong-password"), MaxFailedLogins-1)
	clock = clock.Add(time.Minute)
	res, err := svc.Login(ctx, "g@example.com", "a-strong-password", meta)
	if err != nil {
		t.Fatalf("second sign-in: %v", err)
	}
	if u, _ := q.GetUserByID(ctx, user.ID); u.FailedLoginCount != int32(MaxFailedLogins-1) {
		t.Fatalf("signing in reset the wrong-code count: %d", u.FailedLoginCount)
	}
	second, _ := svc.Lookup(ctx, res.Token)
	wrong(second, 1)
	if _, err := svc.Lookup(ctx, res.Token); !errors.Is(err, ErrNoSession) {
		t.Fatalf("session survived the MFA lockout: %v", err)
	}
	clock = clock.Add(time.Minute)
	if _, err := svc.Login(ctx, "g@example.com", "a-strong-password", meta); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("locked account signed in: %v", err)
	}
}
