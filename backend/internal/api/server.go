package api

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/google/uuid"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/api/apigen"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/auth"
)

// Pinger is the slice of store.Querier the health check needs (keeps handlers testable without a DB).
type Pinger interface {
	Ping(ctx context.Context) (int32, error)
}

// Server implements apigen.StrictServerInterface (generated from api/openapi.yaml).
type Server struct {
	logger  *slog.Logger
	db      Pinger
	auth    *auth.Service
	version string
}

var _ apigen.StrictServerInterface = (*Server)(nil)

// NewServer builds the API handlers.
func NewServer(logger *slog.Logger, db Pinger, authSvc *auth.Service, version string) *Server {
	return &Server{logger: logger, db: db, auth: authSvc, version: version}
}

const msgBadCredentials = "Email hoặc mật khẩu không đúng, hoặc tài khoản đang tạm khóa"

// GetHealthz reports liveness and whether the database answers a query (via sqlc).
func (s *Server) GetHealthz(ctx context.Context, _ apigen.GetHealthzRequestObject) (apigen.GetHealthzResponseObject, error) {
	if _, err := s.db.Ping(ctx); err != nil {
		s.logger.WarnContext(ctx, "health check: database unavailable", "error", err)
		return apigen.GetHealthz503JSONResponse{
			Status: apigen.HealthStatusDegraded, Version: s.version, Database: apigen.HealthDatabaseUnavailable,
		}, nil
	}
	return apigen.GetHealthz200JSONResponse{
		Status: apigen.HealthStatusOk, Version: s.version, Database: apigen.HealthDatabaseOk,
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
	}
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
