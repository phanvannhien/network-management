.PHONY: dev-web dev-api dev-env db-up gen sqlc migrate-up migrate-down types test check format seed-demo seed-bench

# Dev Postgres from deploy/docker-compose.yml (service `db`, host port 5468). Override per shell if needed.
DATABASE_URL ?= postgres://ntb:ntb_dev_password@localhost:5468/ntb?sslmode=disable
# Integration tests create throwaway databases on this server (see backend/internal/testdb).
NTB_TEST_DATABASE_URL ?= $(DATABASE_URL)
export DATABASE_URL NTB_TEST_DATABASE_URL

# Frontend dev server (Vite, hot reload); proxies /api to the Go API.
dev-web:
	cd frontend && npm run dev

# Go API on :8069 (NTB_HTTP_ADDR). Uses the NTB_MASTER_KEY from deploy/.env — the same key as the Docker
# stack, because both share the dev database (different keys would make stored MFA seeds unreadable).
dev-api: dev-env
	cd backend && NTB_MASTER_KEY="$$(grep '^NTB_MASTER_KEY=' ../deploy/.env | cut -d= -f2-)" go run ./cmd/ntb

# Create deploy/.env for Docker Compose (random NTB_MASTER_KEY) if it does not exist yet.
# Keep that key: losing or changing it makes every stored secret (MFA seeds, …) unreadable.
dev-env:
	@if [ -f deploy/.env ]; then echo "deploy/.env already exists — not touching it"; \
	else sed "s|^NTB_MASTER_KEY=.*|NTB_MASTER_KEY=$$(openssl rand -base64 32)|" deploy/.env.example > deploy/.env \
	  && chmod 600 deploy/.env && echo "Created deploy/.env with a random NTB_MASTER_KEY"; fi

# Start only the dev database.
db-up: dev-env
	docker compose -f deploy/docker-compose.yml up -d --wait db

# Regenerate all code from contracts (ADR-017): run after editing api/openapi.yaml or db/queries.
#   oapi-codegen (pinned in backend/go.mod as a Go tool) -> backend/internal/api/apigen
#   sqlc (brew install sqlc)                              -> backend/internal/store
#   openapi-typescript                                    -> frontend/src/api/schema.d.ts
gen:
	cd backend && go tool oapi-codegen -config internal/api/oapi-codegen.yaml ../api/openapi.yaml
	cd backend && sqlc generate
	cd frontend && npx openapi-typescript ../api/openapi.yaml -o src/api/schema.d.ts

sqlc:
	cd backend && sqlc generate

# Apply / roll back one migration with the golang-migrate CLI (brew install golang-migrate).
# Sample data (P1-25), owned by an existing system admin: make seed-demo OWNER=admin@example.vn
seed-demo:
	cd backend && go run ./cmd/ntb seed demo --owner "$(OWNER)"

# Benchmark inventory: make seed-bench OWNER=admin@example.vn DEVICES=2000
DEVICES ?= 500
seed-bench:
	cd backend && go run ./cmd/ntb seed bench --owner "$(OWNER)" --devices $(DEVICES)

migrate-up:
	migrate -path backend/db/migrations -database "$(DATABASE_URL)" up

migrate-down:
	migrate -path backend/db/migrations -database "$(DATABASE_URL)" down 1

# Generate TypeScript types from schema/ntb.schema.json (export/import format)
types:
	cd frontend && npx json2ts --input ../schema/legacy/ntb-v1.schema.json --output src/types/ntb.ts

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
