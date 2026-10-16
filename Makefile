.PHONY: dev-web dev-api db-up sqlc migrate-up migrate-down types test check format

# Dev Postgres from deploy/docker-compose.yml (service `db`, host port 5468). Override per shell if needed.
DATABASE_URL ?= postgres://ntb:ntb_dev_password@localhost:5468/ntb?sslmode=disable
# Integration tests create throwaway databases on this server (see backend/internal/testdb).
NTB_TEST_DATABASE_URL ?= $(DATABASE_URL)
export DATABASE_URL NTB_TEST_DATABASE_URL

# Frontend dev server (Vite, hot reload); proxies /api to the Go API.
dev-web:
	cd frontend && npm run dev

# Go API on :8069 (NTB_HTTP_ADDR).
dev-api:
	cd backend && go run ./cmd/ntb

# Start only the dev database.
db-up:
	docker compose -f deploy/docker-compose.yml up -d --wait db

# Generate Go store code from db/queries (wired up in P0-03).
sqlc:
	cd backend && sqlc generate

# Apply / roll back one migration with the golang-migrate CLI (brew install golang-migrate).
migrate-up:
	migrate -path backend/db/migrations -database "$(DATABASE_URL)" up

migrate-down:
	migrate -path backend/db/migrations -database "$(DATABASE_URL)" down 1

# Generate TypeScript types from schema/ntb.schema.json (export/import format)
types:
	cd frontend && npx json2ts --input ../schema/ntb.schema.json --output src/types/ntb.ts

# Lint + typecheck + test for frontend and backend (needs `make db-up` for DB tests)
check:
	cd frontend && npm run lint
	cd frontend && npm run format:check
	cd frontend && npx tsc -b
	cd frontend && npm run test
	cd backend && go vet ./...
	cd backend && golangci-lint run
	cd backend && go test ./...

# Rewrite frontend code formatting
format:
	cd frontend && npm run format

test:
	cd frontend && npm run test
	cd backend && go test ./...
