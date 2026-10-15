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

```sh
make dev-web   # frontend dev server (Vite)
make dev-api   # backend (hiện là stub, thực từ Phase 2)
make test      # Vitest + go test
make check     # lint + typecheck + test (từ P0-02)
```

## Triển khai

```sh
docker compose -f deploy/docker-compose.yml up -d --build   # từ P0-04
```
