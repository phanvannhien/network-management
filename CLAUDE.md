# Network Topology Builder — Hướng dẫn cho Claude Code

## Dự án là gì
Ứng dụng web **self-hosted** để vẽ sơ đồ mạng: kéo thả thiết bị, nối dây port → port, khai báo IP/VLAN,
kiểm tra lỗi thiết kế, export ảnh/PDF/bảng. Về sau đọc **trạng thái thật qua SNMP** và hiển thị lên sơ đồ.

Tài liệu nguồn (đọc khi cần, không cần đọc hết mỗi phiên):
- `docs/SRS.md` — đặc tả yêu cầu đầy đủ (nguồn sự thật về tính năng).
- `docs/PLAN.md` — danh sách task theo phase, có ID (P1-07…) và điều kiện "Done khi".
- `docs/DECISIONS.md` — các quyết định kiến trúc (ADR). Không làm trái ADR nếu chưa hỏi.
- `docs/STATUS.md` — nhật ký từng phiên làm việc. Luôn đọc mục mới nhất khi bắt đầu.

## Quy trình mỗi phiên
1. Đọc mục mới nhất trong `docs/STATUS.md`, rồi `docs/PLAN.md`. Làm task người dùng chỉ định;
   nếu không chỉ định, lấy task chưa tick đầu tiên của phase hiện tại.
2. Với task lớn hơn ~1 file: trình bày kế hoạch ngắn (file sẽ tạo/sửa, cách test) và chờ đồng ý.
3. Code kèm test. Task chỉ được coi là xong khi đạt mục "Done khi" của task VÀ `make check` pass.
4. Tick checkbox của task trong `docs/PLAN.md`, thêm một mục vào đầu `docs/STATUS.md` theo mẫu bên dưới.
5. Gặp điểm mơ hồ, mâu thuẫn với SRS, hoặc cần quyết định kiến trúc mới: DỪNG và hỏi.
   Khi người dùng chốt, ghi thành ADR mới trong `docs/DECISIONS.md`.
6. Không tự ý thêm thư viện ngoài danh sách Stack. Cần thì hỏi kèm lý do.
7. Commit nhỏ theo từng task, Conventional Commits: `feat(canvas): port-to-port linking (P1-06)`.

## Stack (đã chốt — xem ADR)
- **Frontend:** React 18, TypeScript (strict), Vite, @xyflow/react (React Flow), Zustand + Immer,
  shadcn/ui + Tailwind CSS, ajv (validate JSON Schema), ipaddr.js, Dexie (IndexedDB),
  html-to-image, react-i18next, Vitest, Playwright.
- **Backend:** Go (bản stable mới nhất), chi (router), pgx v5, sqlc, golang-migrate, gosnmp, log/slog.
- **Database:** PostgreSQL 16.
- **Deploy:** Docker Compose; Nginx phục vụ frontend tĩnh và reverse proxy `/api` → backend.

## Cấu trúc repo
```
/frontend            React app (Vite)
  src/model/         Network model, View model, commands, undo/redo
  src/canvas/        React Flow: node, edge, handle, layer
  src/panels/        Palette, Sidebar thuộc tính, Problems, VLAN, Subnet
  src/validation/    Rule engine + Web Worker
  src/io/            Load/Save JSON, autosave, export
  src/catalog/       Device template, icon SVG
/backend             Go module
  cmd/ntb/           main: API + SNMP poller trong cùng một binary
  internal/api/      HTTP handler (chi)
  internal/auth/
  internal/project/
  internal/snmp/     Poller, credential, mapping ifIndex
  internal/store/    Code sinh bởi sqlc
  db/migrations/     golang-migrate (*.up.sql / *.down.sql)
  db/queries/        SQL cho sqlc
/schema              ntb.schema.json — schema file dự án (dùng chung FE + BE)
/testdata            File *.ntb.json mẫu (nhỏ, 500 node, 2000 node)
/deploy              docker-compose.yml, nginx.conf, .env.example
/docs                SRS, PLAN, DECISIONS, STATUS
Makefile
```

## Lệnh (Makefile — tạo ở task P0-01)
- `make dev-web` — chạy Vite dev server
- `make dev-api` — chạy backend Go
- `make sqlc` — sinh code từ `backend/db/queries`
- `make migrate-up` / `make migrate-down`
- `make types` — sinh TypeScript types từ `schema/ntb.schema.json`
- `make test` — Vitest + `go test ./...`
- `make check` — lint + typecheck + test (phải pass trước khi đánh dấu xong)
- `docker compose -f deploy/docker-compose.yml up -d --build`

## Quy ước kỹ thuật
- **Schema:** `schema/ntb.schema.json` là nguồn duy nhất cho định dạng file dự án. TS types sinh tự động
  (`make types`); Go struct viết tay nhưng phải có test round-trip với mọi file trong `/testdata`.
  Đổi schema → tăng `schemaVersion` và viết migration cho file cũ.
- **Model:** tách Network model (devices, interfaces, links, vlans, subnets) khỏi View model
  (pages, tọa độ, style). Canvas chỉ đọc model qua selector. Mọi thay đổi đi qua command để undo/redo.
- **Hiệu năng:** không re-render toàn bộ canvas khi một node đổi; validation chạy trong Web Worker.
- **Go:** không dùng ORM; SQL viết tay trong `db/queries`; lỗi wrap `fmt.Errorf("...: %w", err)`;
  `context.Context` là tham số đầu; log bằng slog, dạng JSON.
- **SNMP:** CHỈ đọc (GET / WALK / BULKWALK). Tuyệt đối không dùng SET.
  Ưu tiên SNMPv3. Credential mã hóa AES-GCM với key từ env `NTB_SECRET_KEY`; không bao giờ log credential.
  Credential không bao giờ nằm trong file `.ntb.json` export.
- **Ngôn ngữ:** code, tên biến, comment, commit message bằng tiếng Anh.
  Trao đổi với người dùng và viết docs bằng tiếng Việt.

## Mẫu ghi `docs/STATUS.md` (thêm vào ĐẦU file)
```
## YYYY-MM-DD — <Task ID> <tên task>
- Đã làm:
- Test / cách kiểm tra:
- Còn dở / lỗi đã biết:
- Câu hỏi cho người dùng:
- Đề xuất quyết định cần chốt:
- Task tiếp theo đề xuất:
```
