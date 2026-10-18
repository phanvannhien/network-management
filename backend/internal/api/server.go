package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/api/apigen"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/auth"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/backup"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/store"
)

// Pinger is the slice of store.Querier the health check needs (keeps handlers testable without a DB).
type Pinger interface {
	Ping(ctx context.Context) (int32, error)
}

// Server implements apigen.StrictServerInterface (generated from api/openapi.yaml).
type Server struct {
	logger  *slog.Logger
	db      Pinger
	pool    *pgxpool.Pool // nil in handler tests that never touch the database
	q       store.Querier
	auth    *auth.Service
	version string
	env     string
	backups BackupInfo
}

// BackupInfo is how backups are set up (environment), shown to system admins (P2-13).
type BackupInfo struct {
	Enabled  bool
	Dir      string
	Schedule string // "02:00" or "off"
	Keep     string // "7,4,12"
	// Svc runs backups and tests destinations (nil when backups are off).
	Svc *backup.Service
	// KeyFingerprint of the current master key: which backup files its vault passwords open.
	KeyFingerprint string
}

// WithBackups records the backup setup for GET /admin/backups.
func (s *Server) WithBackups(b BackupInfo) *Server {
	s.backups = b
	return s
}

var _ apigen.StrictServerInterface = (*Server)(nil)

// NewServer builds the API handlers.
func NewServer(logger *slog.Logger, db Pinger, pool *pgxpool.Pool, authSvc *auth.Service, version, env string) *Server {
	return &Server{logger: logger, db: db, pool: pool, q: store.New(pool), auth: authSvc, version: version, env: env}
}

// errRollback aborts a transaction without being reported as a server error.
var errRollback = errors.New("rollback")

// withTx runs fn in one transaction; returning errRollback rolls back and yields nil.
func (s *Server) withTx(ctx context.Context, fn func(q store.Querier) error) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := fn(store.New(tx)); err != nil {
		if errors.Is(err, errRollback) {
			return nil
		}
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit tx: %w", err)
	}
	return nil
}

const msgBadCredentials = "Email hoặc mật khẩu không đúng, hoặc tài khoản đang tạm khóa"

// GetHealthz reports liveness and whether the database answers a query (via sqlc).
func (s *Server) GetHealthz(ctx context.Context, _ apigen.GetHealthzRequestObject) (apigen.GetHealthzResponseObject, error) {
	if _, err := s.db.Ping(ctx); err != nil {
		s.logger.WarnContext(ctx, "health check: database unavailable", "error", err)
		return apigen.GetHealthz503JSONResponse{
			Status: apigen.HealthStatusDegraded, Version: s.version, Environment: s.env, Database: apigen.HealthDatabaseUnavailable,
		}, nil
	}
	return apigen.GetHealthz200JSONResponse{
		Status: apigen.HealthStatusOk, Version: s.version, Environment: s.env, Database: apigen.HealthDatabaseOk,
	}, nil
}

// Login verifies credentials and sets the session cookie.
func (s *Server) Login(ctx context.Context, req apigen.LoginRequestObject) (apigen.LoginResponseObject, error) {
	info := infoFrom(ctx)
	if req.Body == nil {
		return apigen.Login401JSONResponse{UnauthorizedJSONResponse: apigen.UnauthorizedJSONResponse{Message: msgBadCredentials}}, nil
	}
	res, err := s.auth.Login(ctx, string(req.Body.Email), req.Body.Password, info.meta)
	switch {
	case errors.Is(err, auth.ErrInvalidCredentials):
		return apigen.Login401JSONResponse{UnauthorizedJSONResponse: apigen.UnauthorizedJSONResponse{Message: msgBadCredentials}}, nil
	case errors.Is(err, auth.ErrRateLimited):
		return apigen.Login429JSONResponse{Message: "Thử đăng nhập quá nhiều lần, vui lòng đợi một phút"}, nil
	case err != nil:
		return nil, err
	}
	// Replace any previous session from this browser instead of leaving it alive.
	if old, ok := sessionFrom(ctx); ok {
		_ = s.auth.Logout(ctx, old, info.meta)
	}
	cookie := sessionCookie(res.Token, info.secure, int(auth.SessionAbsolute.Seconds()))
	return apigen.Login200JSONResponse{
		Body:    toAuthSession(res.Session),
		Headers: apigen.Login200ResponseHeaders{SetCookie: &cookie},
	}, nil
}

// Logout deletes the session and clears the cookie. csrfGuard already checked X-CSRF-Token.
func (s *Server) Logout(ctx context.Context, _ apigen.LogoutRequestObject) (apigen.LogoutResponseObject, error) {
	sess, ok := sessionFrom(ctx)
	if !ok {
		return apigen.Logout401JSONResponse{UnauthorizedJSONResponse: apigen.UnauthorizedJSONResponse{Message: "Chưa đăng nhập"}}, nil
	}
	info := infoFrom(ctx)
	if err := s.auth.Logout(ctx, sess, info.meta); err != nil {
		return nil, err
	}
	cleared := sessionCookie("", info.secure, -1)
	return apigen.Logout204Response{Headers: apigen.Logout204ResponseHeaders{SetCookie: &cleared}}, nil
}

// GetCurrentSession returns the signed-in user and the CSRF token for subsequent writes.
func (s *Server) GetCurrentSession(ctx context.Context, _ apigen.GetCurrentSessionRequestObject) (apigen.GetCurrentSessionResponseObject, error) {
	sess, ok := sessionFrom(ctx)
	if !ok {
		return apigen.GetCurrentSession401JSONResponse{UnauthorizedJSONResponse: apigen.UnauthorizedJSONResponse{Message: "Chưa đăng nhập"}}, nil
	}
	return apigen.GetCurrentSession200JSONResponse(toAuthSession(sess)), nil
}

func toAuthSession(s auth.Session) apigen.AuthSession {
	return apigen.AuthSession{
		CsrfToken: s.CSRFToken,
		User: apigen.CurrentUser{
			Id: uuid.UUID(s.UserID.Bytes), Email: s.Email, DisplayName: s.DisplayName, IsSystemAdmin: s.IsSystemAdmin,
		},
		Mfa: apigen.MfaStatus{
			Enabled: s.MFAEnabled, Verified: s.MFAVerified, Required: s.MFARequired, VerifiedAt: mfaVerifiedAt(s),
		},
		ActiveOrganizationId: activeOrg(s),
		ExpiresAt:            s.ExpiresAt,
	}
}

func mfaVerifiedAt(s auth.Session) *time.Time {
	if s.MFAVerifiedAt.IsZero() {
		return nil
	}
	t := s.MFAVerifiedAt
	return &t
}

func activeOrg(s auth.Session) *uuid.UUID {
	if !s.ActiveOrgID.Valid {
		return nil
	}
	id := uuid.UUID(s.ActiveOrgID.Bytes)
	return &id
}

// sessionCookie builds the Set-Cookie value; maxAge < 0 deletes the cookie.
func sessionCookie(value string, secure bool, maxAge int) string {
	c := http.Cookie{
		Name:     SessionCookie,
		Value:    value,
		Path:     "/",
		MaxAge:   maxAge,
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
	}
	return c.String()
}

func writeError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(apigen.Error{Message: message})
}
