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

Yêu cầu thêm: Docker (Postgres dev), golang-migrate CLI (`brew install golang-migrate`).

```sh
make db-up     # Postgres dev trong Docker, cổng host 5468
make migrate-up / make migrate-down   # áp/rollback migration (DATABASE_URL mặc định trỏ DB dev)
make dev-api   # Go API ở http://localhost:8069 (đổi bằng NTB_HTTP_ADDR)
make dev-web   # Vite ở http://localhost:5173, proxy /api → API (đổi bằng NTB_API_URL)
make test      # Vitest + go test
make check     # lint + typecheck + test
```

Hợp đồng API: `api/openapi.yaml` (sửa file này trước khi viết handler/frontend).

## Triển khai

```sh
docker compose -f deploy/docker-compose.yml up -d --build   # từ P0-04
```
