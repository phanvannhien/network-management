// Package api wires HTTP routes. Handlers implement the contract in api/openapi.yaml.
package api

import (
	"log/slog"
	"net/http"
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
		ErrorHandlerFunc: func(w http.ResponseWriter, r *http.Request, err error) {
			writeError(w, http.StatusBadRequest, err.Error())
		},
	})
	return r
}

func requestLogger(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
			start := time.Now()
			next.ServeHTTP(ww, r)
			logger.InfoContext(r.Context(), "http request",
				"method", r.Method,
				"path", r.URL.Path,
				"status", ww.Status(),
				"duration_ms", time.Since(start).Milliseconds(),
				"request_id", middleware.GetReqID(r.Context()),
			)
		})
	}
}
