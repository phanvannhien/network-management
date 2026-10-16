package api

import (
	"context"
	"log/slog"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/api/apigen"
)

// Pinger is the slice of store.Querier the health check needs (keeps handlers testable without a DB).
type Pinger interface {
	Ping(ctx context.Context) (int32, error)
}

// Server implements apigen.StrictServerInterface (generated from api/openapi.yaml).
type Server struct {
	logger  *slog.Logger
	db      Pinger
	version string
}

var _ apigen.StrictServerInterface = (*Server)(nil)

// NewServer builds the API handlers.
func NewServer(logger *slog.Logger, db Pinger, version string) *Server {
	return &Server{logger: logger, db: db, version: version}
}

// GetHealthz reports liveness and whether the database answers a query (via sqlc).
func (s *Server) GetHealthz(ctx context.Context, _ apigen.GetHealthzRequestObject) (apigen.GetHealthzResponseObject, error) {
	if _, err := s.db.Ping(ctx); err != nil {
		s.logger.WarnContext(ctx, "health check: database unavailable", "error", err)
		return apigen.GetHealthz503JSONResponse{
			Status:   apigen.HealthStatusDegraded,
			Version:  s.version,
			Database: apigen.HealthDatabaseUnavailable,
		}, nil
	}
	return apigen.GetHealthz200JSONResponse{
		Status:   apigen.HealthStatusOk,
		Version:  s.version,
		Database: apigen.HealthDatabaseOk,
	}, nil
}
