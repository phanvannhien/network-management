.PHONY: dev-web dev-api sqlc migrate-up migrate-down types test check format

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

# Generate TypeScript types from schema/ntb.schema.json into the frontend
types:
	cd frontend && npx json2ts --input ../schema/ntb.schema.json --output src/types/ntb.ts

# Lint + typecheck + test for frontend and backend
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
