# Network Topology Builder — Hướng dẫn cho Claude Code

## Dự án là gì
Hệ thống **self-hosted** quản lý hạ tầng mạng cho doanh nghiệp và nhà tích hợp (MSP):
kho thiết bị, Site/Location, IPAM, sơ đồ mạng kéo thả, đơn vị & sites, nhà cung cấp & hợp đồng, kho mật khẩu & tài khoản cloud,
phân quyền nhiều tổ chức, và (Phase 3) trạng thái thật qua SNMP.

Tài liệu nguồn:
- `docs/SRS.md` — đặc tả yêu cầu (nguồn sự thật về tính năng). Tra theo số mục §.
- `docs/PLAN.md` — task theo phase, có ID và điều kiện "Done khi".
- `docs/DECISIONS.md` — quyết định kiến trúc (ADR). Không làm trái ADR nếu chưa hỏi.
- `docs/STATUS.md` — nhật ký phiên làm việc. Luôn đọc mục mới nhất khi bắt đầu.
- `docs/GLOSSARY.md` — thuật ngữ mạng giải thích cho người không chuyên; cập nhật khi thêm khái niệm mới vào sản phẩm.

## Quy trình mỗi phiên
1. Đọc mục mới nhất trong `docs/STATUS.md`, rồi `docs/PLAN.md`. Làm task người dùng chỉ định;
   nếu không, lấy task chưa tick đầu tiên của phase hiện tại.
2. Task lớn hơn ~1 file: trình bày kế hoạch ngắn (file tạo/sửa, migration, endpoint, cách test) và chờ đồng ý.
3. Code kèm test. Xong khi đạt "Done khi" VÀ `make check` pass.
4. Tick checkbox trong `docs/PLAN.md`, thêm mục vào ĐẦU `docs/STATUS.md` theo mẫu bên dưới.
5. Mơ hồ, mâu thuẫn SRS, hoặc cần quyết định kiến trúc mới: DỪNG và hỏi. Người dùng chốt → ghi ADR mới.
6. Không thêm thư viện ngoài danh sách Stack khi chưa hỏi.
7. Commit nhỏ theo task, Conventional Commits: `feat(inventory): device list filters (P1-08)`.

## Stack (đã chốt — xem ADR)
- **Frontend:** React 19, TypeScript strict, Vite, react-router, TanStack Query (dữ liệu server),
  Zustand + Immer (trạng thái editor sơ đồ), @xyflow/react, shadcn/ui + Tailwind CSS,
  openapi-typescript + openapi-fetch (client sinh từ OpenAPI), ipaddr.js, ajv (file import/export),
  SheetJS (Excel import/export), html-to-image, react-i18next, Dexie (chỉ lưu nháp chưa gửi), Vitest, Playwright,
  @tanstack/react-table, cmdk, sonner, recharts, IBM Plex qua @fontsource, @axe-core/playwright (ADR-024; giao diện theo `docs/DESIGN.md`).
- **Backend:** Go (stable mới nhất), chi, oapi-codegen (server types từ OpenAPI), pgx v5, sqlc, golang-migrate,
  log/slog, golang.org/x/crypto (argon2id, ssh — Phase 4), golang.org/x/term (ẩn mật khẩu CLI, ADR-022), pquerna/otp (TOTP), coreos/go-oidc (SSO — Phase 2),
  santhosh-tekuri/jsonschema (validate file import), gosnmp (Phase 3).
- **Database:** PostgreSQL 16.
- **Deploy:** Docker Compose: `web` (Nginx: frontend tĩnh + proxy `/api`), `api` (Go), `db` (Postgres).

## Cấu trúc repo
```
/api                 openapi.yaml — hợp đồng FE ↔ BE (nguồn duy nhất cho API)
/schema              ntb.schema.json — định dạng file export/import .ntb.json
/frontend
  src/app/           App shell: layout, menu trái, org switcher, tìm kiếm toàn cục, router
  src/modules/       inventory, sites (tổ chức → đối tác → đơn vị → site), ipam, vendors, vault, admin, dashboard, reports
  src/editor/        Màn hình vẽ: model, commands, canvas, toolbar nổi, panels, validation worker
  src/api/           Client sinh từ OpenAPI + hooks TanStack Query
  src/i18n/
/backend
  cmd/ntb/           main: API (+ poller SNMP ở Phase 3)
  internal/api/      handler (implement interface sinh từ oapi-codegen)
  internal/auth/     session, argon2id, TOTP, RBAC, OIDC
  internal/tenant/   middleware xác định organization, kiểm tra quyền
  internal/inventory/ internal/ipam/ internal/diagram/ internal/vendor/ internal/vault/
  internal/audit/    internal/notify/ internal/importer/ internal/snmp/
  internal/store/    code sinh bởi sqlc
  db/migrations/  db/queries/
/testdata            file .ntb.json và Excel mẫu
/deploy              docker-compose.yml, nginx.conf, .env.example
/docs
Makefile
```

## Lệnh (Makefile)
`make dev-web` · `make dev-api` · `make gen` (oapi-codegen + openapi-typescript + sqlc) · `make migrate-up` / `migrate-down`
· `make test` · `make check` (lint + typecheck + test) · `docker compose -f deploy/docker-compose.yml up -d --build`

## Quy tắc bắt buộc
- **Đa tổ chức (tenant):** mọi bảng dữ liệu nghiệp vụ có `organization_id`. Mọi query sqlc nhận `organization_id`
  và lọc theo nó. Organization lấy từ session/route qua middleware, KHÔNG lấy từ body request.
  Mỗi endpoint mới phải có test chứng minh user tổ chức A không đọc/sửa được dữ liệu tổ chức B.
- **Phân quyền:** kiểm tra quyền ở backend cho mọi endpoint (frontend ẩn nút chỉ là phụ).
- **Audit:** mọi thao tác ghi (tạo/sửa/xóa) và mọi lần xem/copy mật khẩu ghi vào `audit_log`.
- **Bí mật (mật khẩu thiết bị, tài khoản cloud, TOTP secret, community SNMP):**
  mã hóa envelope AES-256-GCM, master key từ env `NTB_MASTER_KEY`; không bao giờ log, không trả về trong API danh sách,
  không có trong file export, không có trong audit log. Chỉ trả qua endpoint "reveal" có quyền riêng + MFA gần đây.
- **API:** sửa `api/openapi.yaml` trước, chạy `make gen`, rồi mới viết handler và frontend.
- **Go:** không ORM; SQL viết tay; lỗi wrap `fmt.Errorf("...: %w", err)`; `context.Context` tham số đầu; slog JSON.
- **SNMP / SSH:** chỉ đọc. SNMP chỉ GET/WALK/BULKWALK; SSH (Phase 4) chỉ lệnh show. Không bao giờ ghi cấu hình thiết bị.
- **Editor sơ đồ:** thay đổi đi qua command (undo/redo); không re-render toàn canvas khi một node đổi; validation trong Web Worker.
- **Ngôn ngữ:** code, biến, comment, commit tiếng Anh; trao đổi với người dùng và docs tiếng Việt.

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
