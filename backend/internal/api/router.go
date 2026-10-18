// Package api wires HTTP routes. Handlers implement the contract in api/openapi.yaml.
package api

import (
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/api/apigen"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/auth"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/tenant"
)

// NewRouter returns the root handler; every route lives under /api (nginx proxies /api as-is).
func NewRouter(logger *slog.Logger, server *Server, resolver *auth.ClientIPResolver) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(securityHeaders)
	r.Use(limitBody)
	r.Use(requestLogger(logger))
	r.Use(middleware.Recoverer)
	r.Use(withRequestInfo(resolver))
	r.Use(withSession(server.auth))
	r.Use(csrfGuard)
	r.Use(mfaGate)
	r.Use(requireSystemAdmin)
	r.Use(tenant.Middleware(server.q, sessionUser))

	strict := apigen.NewStrictHandlerWithOptions(server, nil, apigen.StrictHTTPServerOptions{
		// Malformed JSON / params: generic 400, no parser internals echoed back.
		RequestErrorHandlerFunc: func(w http.ResponseWriter, r *http.Request, err error) {
			logger.InfoContext(r.Context(), "bad request", "error", err, "path", r.URL.Path)
			writeError(w, http.StatusBadRequest, "Yêu cầu không hợp lệ")
		},
		// Handler errors: log the detail, return a generic 500 (never leak DB errors to clients).
		ResponseErrorHandlerFunc: func(w http.ResponseWriter, r *http.Request, err error) {
			logger.ErrorContext(r.Context(), "handler error", "error", err, "path", r.URL.Path)
			writeError(w, http.StatusInternalServerError, "Lỗi máy chủ")
		},
	})
	apigen.HandlerWithOptions(strict, apigen.ChiServerOptions{
		BaseURL:    "/api",
		BaseRouter: r,
		// Bad path / query parameters: logged, a generic answer (no binder internals echoed back).
		ErrorHandlerFunc: func(w http.ResponseWriter, r *http.Request, err error) {
			logger.InfoContext(r.Context(), "bad parameter", "error", err, "path", r.URL.Path)
			writeError(w, http.StatusBadRequest, "Tham số không hợp lệ")
		},
	})
	return r
}

// tokenInPath: invitation / password-reset links carry a bearer token in the path; logs keep only its first characters.
var tokenInPath = regexp.MustCompile(`(/account-tokens/)([A-Za-z0-9_-]{4})[A-Za-z0-9_-]*`)

func redactPath(p string) string { return tokenInPath.ReplaceAllString(p, "${1}${2}…") }

func requestLogger(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
			start := time.Now()
			next.ServeHTTP(ww, r)
			logger.InfoContext(r.Context(), "http request",
				"method", r.Method,
				"path", redactPath(r.URL.Path),
				"status", ww.Status(),
				"duration_ms", time.Since(start).Milliseconds(),
				"request_id", middleware.GetReqID(r.Context()),
			)
		})
	}
}

// securityHeaders (P2-01): API answers are never cached unless a handler says otherwise (photos, files), are never
// sniffed into another type, and are never rendered as a page (CSP default-src 'none', no framing). nginx adds the
// page headers for the app itself.
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Cache-Control", "no-store")
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
		h.Set("Referrer-Policy", "same-origin")
		next.ServeHTTP(w, r)
	})
}

const (
	maxBody       = 4 << 20  // JSON requests (a 500-device diagram save fits easily)
	maxImportBody = 26 << 20 // Excel / .ntb.json imports and contract files (nginx caps at 25 MB)
)

// limitBody caps request bodies (P2-01): nothing is buffered beyond what the endpoint can use.
func limitBody(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Body != nil && r.Body != http.NoBody {
			limit := int64(maxBody)
			p := r.URL.Path
			if strings.HasSuffix(p, "/device-imports") || strings.Contains(p, "/ntb-imports") || strings.HasSuffix(p, "/files") {
				limit = maxImportBody
			}
			r.Body = http.MaxBytesReader(w, r.Body, limit)
		}
		next.ServeHTTP(w, r)
	})
}
