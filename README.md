# Network Topology Builder

Ứng dụng web self-hosted để vẽ sơ đồ mạng: kéo thả thiết bị, nối dây port → port,
khai báo IP/VLAN, kiểm tra lỗi thiết kế, export ảnh/PDF/bảng. Về sau đọc trạng thái
thật qua SNMP và hiển thị lên sơ đồ.

Xem `docs/SRS.md` (đặc tả), `docs/PLAN.md` (kế hoạch), `docs/DECISIONS.md` (ADR).

## Cấu trúc

```
/frontend   React 18 + TypeScript (strict) + Vite + React Flow + Zustand
/backend    Go (chi, pgx v5, sqlc, gosnmp)
/schema     JSON Schema định dạng file dự án (.ntb.json)
/testdata   File mẫu
/deploy     Docker Compose, Nginx
/docs       SRS, PLAN, DECISIONS, STATUS
```

## Phát triển

Yêu cầu: Node ≥ 20, Go ≥ 1.25, GNU Make.

Yêu cầu thêm: Docker (Postgres dev), `brew install golang-migrate sqlc`
(oapi-codegen được ghim phiên bản trong `backend/go.mod`, chạy qua `go tool`).

```sh
make db-up     # Postgres dev trong Docker, cổng host 5468
make migrate-up / make migrate-down   # áp/rollback migration (DATABASE_URL mặc định trỏ DB dev)
make dev-api   # Go API ở http://localhost:8069 (đổi bằng NTB_HTTP_ADDR)
make dev-web   # Vite ở http://localhost:5173, proxy /api → API (đổi bằng NTB_API_URL)
make test      # Vitest + go test
make check     # lint + typecheck + test
```

Hợp đồng API: `api/openapi.yaml` (OpenAPI 3.1). Quy trình: sửa `api/openapi.yaml` hoặc `backend/db/queries/*.sql`
→ `make gen` (sinh Go server types, sqlc store, TS client) → viết handler / frontend.

## Triển khai

```sh
cp deploy/.env.example deploy/.env    # đổi mật khẩu DB, đặt NTB_MASTER_KEY
docker compose -f deploy/docker-compose.yml up -d --build   # web :8068, api, db
```

Tạo system admin đầu tiên (mật khẩu ≥ 12 ký tự, đọc từ stdin để không lộ trong lịch sử shell):

```sh
# Docker
docker compose -f deploy/docker-compose.yml exec -T api ntb admin create --email admin@example.com --name "Admin" < matkhau.txt
# Dev (dùng DB dev ở cổng 5468)
cd backend && go run ./cmd/ntb admin create --email admin@example.com --name "Admin"
```
