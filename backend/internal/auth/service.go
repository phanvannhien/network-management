package auth

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/audit"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/secrets"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/store"
)

// Policy constants (SRS §10). Kept together so the security review has one place to look.
const (
	MaxFailedLogins  = 5
	LockDuration     = 15 * time.Minute
	SessionIdle      = 12 * time.Hour
	SessionAbsolute  = 7 * 24 * time.Hour
	touchGranularity = 5 * time.Minute // avoid a DB write on every request
)

var (
	// ErrInvalidCredentials covers unknown email, wrong password, locked and disabled accounts alike,
	// so responses never reveal which accounts exist.
	ErrInvalidCredentials = errors.New("invalid credentials")
	// ErrRateLimited means too many attempts from this IP or for this email.
	ErrRateLimited = errors.New("too many login attempts")
	// ErrNoSession means the cookie is missing, unknown or expired.
	ErrNoSession = errors.New("no valid session")
)

// RequestMeta is request context recorded with sessions and audit entries.
type RequestMeta = audit.Meta

// Session is an authenticated session as seen by handlers.
type Session struct {
	TokenHash     []byte
	CSRFToken     string
	UserID        pgtype.UUID
	Email         string
	DisplayName   string
	IsSystemAdmin bool
	MFAEnabled    bool        // user has confirmed TOTP enrollment
	MFAVerified   bool        // MFA code entered in this session
	MFARequired   bool        // system admin or org owner/admin (ADR-019)
	ActiveOrgID   pgtype.UUID // organization used last; only a default for the UI (ADR-023)
	ExpiresAt     time.Time   // current idle expiry (already capped by SessionAbsolute)
	MFAVerifiedAt time.Time   // zero when MFA has not been entered in this session
}

func sessionFromRow(row store.GetSessionRow) Session {
	return Session{
		TokenHash: row.TokenHash, CSRFToken: row.CsrfToken, UserID: row.UserID,
		Email: row.Email, DisplayName: row.DisplayName, IsSystemAdmin: row.IsSystemAdmin,
		MFAEnabled: row.MfaEnabled, MFAVerified: row.MfaVerifiedAt.Valid, MFARequired: row.MfaRequired,
		ActiveOrgID: row.ActiveOrganizationID, ExpiresAt: row.ExpiresAt.Time, MFAVerifiedAt: row.MfaVerifiedAt.Time,
	}
}

// LoginResult carries the new cookie token (only ever sent to the client, never stored) and the session.
type LoginResult struct {
	Token   string
	Session Session
}

// Service implements login, logout, session lookup and MFA.
type Service struct {
	pool     *pgxpool.Pool // for multi-statement transactions
	q        store.Querier
	keys     *secrets.Keyring
	logger   *slog.Logger
	argon    Argon2Params
	ipLimit  *RateLimiter
	idLimit  *RateLimiter
	mfaLimit *RateLimiter
	now      func() time.Time
	dummyPwd string // hash compared when the email is unknown (constant-ish timing)
}

// NewService builds the auth service with the given argon2 cost (tests pass a cheap one).
func NewService(pool *pgxpool.Pool, keys *secrets.Keyring, logger *slog.Logger, argon Argon2Params) (*Service, error) {
	dummy, err := HashPassword("not-a-real-password-for-timing", argon)
	if err != nil {
		return nil, err
	}
	return &Service{
		pool:     pool,
		q:        store.New(pool),
		keys:     keys,
		logger:   logger,
		argon:    argon,
		ipLimit:  NewRateLimiter(10, time.Minute),
		idLimit:  NewRateLimiter(5, time.Minute),
		mfaLimit: NewRateLimiter(5, time.Minute),
		now:      time.Now,
		dummyPwd: dummy,
	}, nil
}

// withTx runs fn inside one database transaction.
func (s *Service) withTx(ctx context.Context, fn func(q store.Querier) error) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := fn(store.New(tx)); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit tx: %w", err)
	}
	return nil
}

// Argon returns the hashing parameters (used by the admin CLI so hashes match the server's cost).
func (s *Service) Argon() Argon2Params { return s.argon }

// Login verifies credentials, applies lockout and rate limits, creates a session and writes audit entries.
func (s *Service) Login(ctx context.Context, email, password string, meta RequestMeta) (LoginResult, error) {
	email = strings.TrimSpace(email)
	if !s.ipLimit.Allow("ip:"+meta.IP.String()) || !s.idLimit.Allow("email:"+strings.ToLower(email)) {
		s.audit(ctx, pgtype.UUID{}, "auth.login_rate_limited", email, meta)
		return LoginResult{}, ErrRateLimited
	}

	user, err := s.q.GetUserByEmail(ctx, email)
	if errors.Is(err, pgx.ErrNoRows) {
		_, _ = VerifyPassword(password, s.dummyPwd)
		s.audit(ctx, pgtype.UUID{}, "auth.login_failed", email, meta)
		return LoginResult{}, ErrInvalidCredentials
	}
	if err != nil {
		return LoginResult{}, fmt.Errorf("load user: %w", err)
	}

	if user.PasswordHash == "" {
		// Invited user who has not accepted yet: no password exists, so nothing can match.
		_, _ = VerifyPassword(password, s.dummyPwd)
		s.audit(ctx, user.ID, "auth.login_failed", user.Email, meta)
		return LoginResult{}, ErrInvalidCredentials
	}
	ok := false
	if len(password) <= MaxPasswordLength {
		if ok, err = VerifyPassword(password, user.PasswordHash); err != nil {
			return LoginResult{}, fmt.Errorf("verify password: %w", err)
		}
	}
	locked := user.LockedUntil.Valid && user.LockedUntil.Time.After(s.now())
	if !ok || locked || user.DisabledAt.Valid {
		if !ok && !locked {
			// Wrong passwords lock new sign-ins only: ending the sessions too would let anyone who knows an e-mail
			// sign its owner out every 15 minutes.
			if _, err := s.recordFailure(ctx, user.ID, false); err != nil {
				return LoginResult{}, err
			}
		}
		s.audit(ctx, user.ID, "auth.login_failed", user.Email, meta)
		return LoginResult{}, ErrInvalidCredentials
	}

	token, err := NewToken()
	if err != nil {
		return LoginResult{}, err
	}
	csrf, err := NewToken()
	if err != nil {
		return LoginResult{}, err
	}
	params := store.CreateSessionParams{
		TokenHash: HashToken(token),
		UserID:    user.ID,
		CsrfToken: csrf,
		UserAgent: meta.UserAgent,
		ExpiresAt: pgtype.Timestamptz{Time: s.now().Add(SessionIdle), Valid: true},
	}
	if meta.IP.IsValid() {
		ip := meta.IP
		params.Ip = &ip
	}
	if err := s.q.CreateSession(ctx, params); err != nil {
		return LoginResult{}, fmt.Errorf("create session: %w", err)
	}
	s.audit(ctx, user.ID, "auth.login", user.Email, meta)

	// Reload through GetSession so the result carries the same MFA state Lookup would report.
	row, err := s.q.GetSession(ctx, params.TokenHash)
	if err != nil {
		return LoginResult{}, fmt.Errorf("load new session: %w", err)
	}
	sess := sessionFromRow(row)
	// With MFA the count is reset once the code is right (VerifyMFA): signing in again must not wipe the wrong codes.
	if !sess.MFAEnabled {
		if err := s.q.ResetLoginFailures(ctx, user.ID); err != nil {
			return LoginResult{}, fmt.Errorf("reset login failures: %w", err)
		}
	}
	return LoginResult{Token: token, Session: sess}, nil
}

// Lookup resolves a cookie token to a live session and slides its idle expiry (capped by SessionAbsolute).
func (s *Service) Lookup(ctx context.Context, token string) (Session, error) {
	if token == "" {
		return Session{}, ErrNoSession
	}
	row, err := s.q.GetSession(ctx, HashToken(token))
	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, ErrNoSession
	}
	if err != nil {
		return Session{}, fmt.Errorf("load session: %w", err)
	}
	now := s.now()
	if now.Sub(row.CreatedAt.Time) >= SessionAbsolute {
		_ = s.q.DeleteSession(ctx, row.TokenHash)
		return Session{}, ErrNoSession
	}
	if now.Sub(row.LastSeenAt.Time) >= touchGranularity {
		expires := now.Add(SessionIdle)
		if hardStop := row.CreatedAt.Time.Add(SessionAbsolute); expires.After(hardStop) {
			expires = hardStop
		}
		if err := s.q.TouchSession(ctx, store.TouchSessionParams{
			TokenHash: row.TokenHash, ExpiresAt: pgtype.Timestamptz{Time: expires, Valid: true},
		}); err != nil {
			return Session{}, fmt.Errorf("touch session: %w", err)
		}
		row.ExpiresAt = pgtype.Timestamptz{Time: expires, Valid: true}
	}
	return sessionFromRow(row), nil
}

// Logout deletes the session and records it.
func (s *Service) Logout(ctx context.Context, sess Session, meta RequestMeta) error {
	if err := s.q.DeleteSession(ctx, sess.TokenHash); err != nil {
		return fmt.Errorf("delete session: %w", err)
	}
	s.audit(ctx, sess.UserID, "auth.logout", sess.Email, meta)
	return nil
}

// CreateUser hashes the password and inserts a user (admin CLI; user management comes in P1-04).
func (s *Service) CreateUser(ctx context.Context, email, displayName, password string, systemAdmin bool) (store.User, error) {
	if len(password) < MinPasswordLength {
		return store.User{}, fmt.Errorf("password must be at least %d characters", MinPasswordLength)
	}
	hash, err := HashPassword(password, s.argon)
	if err != nil {
		return store.User{}, err
	}
	user, err := s.q.CreateUser(ctx, store.CreateUserParams{
		Email: strings.TrimSpace(email), DisplayName: displayName, PasswordHash: hash, IsSystemAdmin: systemAdmin,
	})
	if err != nil {
		return store.User{}, fmt.Errorf("create user: %w", err)
	}
	s.audit(ctx, user.ID, "user.create", user.Email, RequestMeta{UserAgent: "ntb admin create"})
	return user, nil
}

// audit records an authentication event. Failures are logged, not returned: auditing must not let an
// attacker turn a DB hiccup into a login bypass, nor block logins entirely. Secrets never go in here.
func (s *Service) audit(ctx context.Context, actor pgtype.UUID, action, email string, meta RequestMeta) {
	err := audit.Write(ctx, s.q, audit.Entry{Actor: actor, Action: action, ObjectType: "user", ObjectID: email, Meta: meta})
	if err != nil {
		s.logger.ErrorContext(ctx, "write audit log", "action", action, "error", err)
	}
}

// Keyring is the envelope-encryption keyring of the installation (other stored secrets use it too: SMTP password).
func (s *Service) Keyring() *secrets.Keyring { return s.keys }

// recordFailure counts a failed password or MFA code; true when it just locked the account. endSessions (wrong MFA
// codes) also ends the account's sessions then, so a stolen session cannot keep guessing codes.
func (s *Service) recordFailure(ctx context.Context, user pgtype.UUID, endSessions bool) (bool, error) {
	r, err := s.q.RecordLoginFailure(ctx, store.RecordLoginFailureParams{
		ID: user, MaxFailures: MaxFailedLogins, LockSeconds: int32(LockDuration / time.Second),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil // already locked: not counted
	}
	if err != nil {
		return false, fmt.Errorf("record login failure: %w", err)
	}
	if !r.LockedUntil.Valid || !endSessions {
		return r.LockedUntil.Valid, nil
	}
	if err := s.q.DeleteUserSessions(ctx, user); err != nil {
		return true, fmt.Errorf("end sessions of locked account: %w", err)
	}
	return true, nil
}
