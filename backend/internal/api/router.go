// Package api wires HTTP routes. Handlers implement the contract in api/openapi.yaml.
package api

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/api/apigen"
)

// NewRouter returns the root handler; every route lives under /api (nginx proxies /api as-is).
func NewRouter(logger *slog.Logger, server apigen.StrictServerInterface) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	// No middleware.RealIP: it trusts client-supplied X-Forwarded-For (IP spoofing).
	// Client IP behind the trusted nginx proxy is resolved explicitly in P1-01 (rate limit, audit).
	r.Use(requestLogger(logger))
	r.Use(middleware.Recoverer)

	apigen.HandlerWithOptions(apigen.NewStrictHandler(server, nil), apigen.ChiServerOptions{
		BaseURL:    "/api",
		BaseRouter: r,
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
