.PHONY: dev-web dev-api sqlc migrate-up migrate-down types test check

# Frontend dev server (Vite)
dev-web:
	cd frontend && npm run dev

# Backend API server (currently a stub binary; replaced by real server in P2-01)
dev-api:
	cd backend && go run ./cmd/ntb

# Generate Go store code from db/queries (requires sqlc; added in P2-02)
sqlc:
	cd backend && sqlc generate

# Database migrations (added in P2-02)
migrate-up:
	cd backend && golang-migrate migrate -path db/migrations -database "$$DATABASE_URL" up

migrate-down:
	cd backend && golang-migrate migrate -path db/migrations -database "$$DATABASE_URL" down 1

# Generate TypeScript types from schema/ntb.schema.json (added in P0-03)
types:
	@echo "TODO: implemented in P0-03"

# Lint + typecheck + test for frontend and backend (added in P0-02)
check:
	@echo "TODO: implemented in P0-02"

test:
	cd frontend && npm run test --if-present
	cd backend && go test ./...
