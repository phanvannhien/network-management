-- name: Ping :one
-- Round-trip through sqlc + pgx; used by GET /api/healthz.
SELECT 1::int AS ok;
