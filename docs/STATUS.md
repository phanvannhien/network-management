# Nhật ký trạng thái

Mục mới nhất ở trên cùng. Claude Code ghi vào đây sau mỗi task (mẫu trong `CLAUDE.md`).
Khi cần bàn bạc trên claude.ai, dán mục mới nhất (hoặc cả file) vào chat.

---

## 2026-10-15 — P1-03 Palette (làm sau P1-04 theo thứ tự đã duyệt)
- Đã làm:
  - `src/panels/Palette.tsx`: sidebar trái — template phân nhóm theo SRS §2 (từ catalog P1-02), ô tìm kiếm (lọc theo label + typeId), item kéo thả HTML5 (MIME `application/ntb-device`); icon DeviceIcon từng loại.
  - `src/catalog/hostname.ts`: `nextHostname` — hostname tự sinh `SW-01`, `RTR-01`… theo prefix từng loại, bỏ qua tên đã tồn tại, chung namespace toàn document.
  - `src/canvas/dropDevice.ts`: `deviceDropCommand` — tạo device từ template + node view tại vị trí thả (1 command → undo/redo được).
  - `CanvasView`: `onDragOver`/`onDrop` + `screenToFlowPosition` (đúng vị trí dù đang zoom/pan).
  - `App.tsx`: layout flex — Palette trái, canvas phải.
- Test / cách kiểm tra: 39/39 pass (7 test mới: hostname sinh/tăng/bỏ qua/trùng loại, drop tạo device + node đúng vị trí, undo xóa sạch, 2 lần thả liên tiếp → CAM-01/CAM-02). `make check` pass. ✅
- Còn dở / lỗi đã biết: kéo thả thật trên trình duyệt kiểm tra bằng tay (Playwright để gate P1-14); chưa có Favorites/Recently used (SRS §2 — cân nhắc thêm khi có localStorage, có thể gộp P1-12).
- Câu hỏi cho người dùng: không.
- Task tiếp theo đề xuất: P1-05 Thao tác chọn & sửa (multi-select, rubber-band, copy/paste, duplicate, delete cascade, lock, phím tắt §3).

## 2026-10-15 — ADR-010/011 cập nhật tài liệu
- Đã làm:
  - `docs/DECISIONS.md`: thêm ADR-011 (giám sát tùy chọn theo thiết bị, nhiều site qua VPN, remote poller để Phase 4). ADR-010 đã có từ phiên trước nên bỏ qua theo chỉ dẫn.
  - `CLAUDE.md` + `docs/SRS.md` §9: React 19 đã cập nhật từ phiên trước (bỏ qua).
  - `docs/SRS.md` §7: ví dụ JSON thêm `pollerId: "central"`, `dependsOnDeviceId: null` vào monitoring; §11: thêm đoạn "Nhiều site / VPN" (unknown khi thiết bị cha unreachable; 5 trạng thái; giới hạn dải IP trùng).
  - `docs/PLAN.md`: chèn P3-05b (phụ thuộc theo site) sau P3-05; thêm remote poller vào Phase 4.
  - `schema/ntb.schema.json`: `monitoring.pollerId` (string, default "central"), `monitoring.dependsOnDeviceId` (null hoặc UUID, dùng anyOf vì $ref không ghép được với type). SchemaVersion giữ 1.0.0 (chưa phát hành bản nào).
  - `testdata/sample-small.ntb.json`: 10 device đều có 2 field mới.
  - Go `MonitoringConfig`: thêm `PollerID`, `DependsOnDeviceID` — round-trip test vẫn pass.
  - `make types` sinh lại TS types.
  - React 19: đã chạy từ P0-01 (react 19.2.8 + @types 19), không có xung đột peer dependency khi cài @xyflow/react/zustand/immer/catalog deps.
- Test / cách kiểm tra: `make check` pass — 32 test FE (ajv + round-trip io + model + catalog + canvas), Go round-trip với file mẫu mới, lint 0 issues. ✅
- Còn dở / lỗi đã biết: không.
- Câu hỏi cho người dùng: không.
- Task tiếp theo đề xuất: P1-03 Palette.

## 2026-10-15 — P1-04 Canvas cơ bản (làm trước P1-03 theo đề xuất đã duyệt)
- Đã làm:
  - Thêm dep: `@xyflow/react` (React Flow v12).
  - `src/canvas/adapters.ts`: buildNodes/buildEdges từ NtbData → React Flow (canvas chỉ đọc model qua adapter, đúng quy ước); bỏ qua node thiếu device.
  - `src/canvas/DeviceNode.tsx`: custom node memo hóa, subscribe đúng device của nó (không re-render cả canvas khi 1 node đổi); icon + hostname; handle placeholder cho P1-06.
  - `src/canvas/CanvasView.tsx`: ReactFlow zoom 10–400% (minZoom 0.1/maxZoom 4), pan (Space + kéo, panOnDrag), selectionOnDrag + multiSelection Shift, snapToGrid bật/tắt + lưới 10/20/40 px, MiniMap, Controls, Fit to screen (nút + Shift+1); kéo node → `setNodePosition` với mergeKey `drag:<id>` (gộp 1 bước undo); `useEnsurePage` tự tạo page đầu khi document trống.
  - `App.tsx`: render CanvasView full-screen.
- Test / cách kiểm tra: 32/32 pass (5 test adapter mới + smoke render canvas trong jsdom với ResizeObserver mock); dev server chạy, HTTP 200; `make check` pass. ✅
- Còn dở / lỗi đã biết: kéo/thả và zoom cần kiểm tra bằng tay trên trình duyệt (Playwright E2E để sau — gate P1-14); chưa có selection sync vào store (làm ở P1-05); deleteKeyCode=null tạm (P1-05 sẽ bật có cascade).
- Câu hỏi cho người dùng: không.
- Task tiếp theo đề xuất: P1-03 Palette (đã có nền canvas để kéo thả vào).

## 2026-10-15 — P1-02 Device catalog
- Đã làm:
  - `src/catalog/types.ts`: `PortRun` (prefix + count + media/speed/mode/poe) → `generateInterfaces`.
  - `src/catalog/catalog.ts`: template cho mọi loại thiết bị trong SRS §2, chia 5 nhóm gốc + Other (`DEVICE_GROUP_ORDER`, `getTemplate`, `templatesByGroup`). Ví dụ: L2 switch 24×RJ45 + 4×SFP; PoE switch 24×RJ45 PoE + 2×SFP+; router Gi0/0/0–2 + Te0/1/0; server eno1–4 + 2×SFP+.
  - `src/catalog/icons.tsx`: `DeviceIcon` — SVG line-art 24×24 stroke `currentColor` cho từng loại (dark mode tự theo theme), có icon generic dự phòng.
  - `src/catalog/createFromTemplate.ts`: `createDeviceFromTemplate(typeId, hostname)` — dùng factory của P1-01, sinh đủ interface theo port layout.
- Test / cách kiểm tra: 27/27 test pass (10 test catalog mới: số lượng port, tên port, PoE, media, unique id, nhóm không rỗng, throw khi thiếu template). `make check` pass. ✅
- Còn dở / lỗi đã biết: label tiếng Việt cho nhóm/thiết bị sẽ qua react-i18next ở P1-12 (đã chừa key `device.<typeId>`, `group.<id>`); icon chưa có mẫu theo hãng/model (Phase 2).
- Câu hỏi cho người dùng: không.
- Task tiếp theo đề xuất: P1-03 Palette (danh sách theo nhóm, ô tìm kiếm, kéo thả vào canvas) — cần kết hợp với canvas P1-04, đề xuất làm P1-04 canvas cơ bản trước rồi P1-03 kéo thả ngay sau.

## 2026-10-15 — P1-01 Store & command
- Đã làm:
  - Thêm deps: `zustand`, `immer`.
  - `src/model/types.ts`: `NtbData` — Network + View model keyed theo id (dùng lại types sinh từ schema; json2ts đặt tên `Vlan` thay `VLAN`).
  - `src/model/factory.ts`: `newId()` (crypto.randomUUID), `createDevice/Interface/Link` với mặc định hợp lý.
  - `src/model/io.ts`: `fromNtbProjectFile` / `toNtbProjectFile` (Record ↔ array, giữ thứ tự page qua `pageOrder`).
  - `src/model/commands.ts`: `addPage`, `addDevice` (kèm node view), `updateDevice`, `updateInterface`, `deleteDevice` (cascade link + node), `addLink` (chặn port đã có link), `deleteLink`, `setNodePosition` (có mergeKey), `addVlan` (chặn trùng vlanId), `deleteVlan`.
  - `src/model/store.ts`: Zustand store; undo/redo bằng snapshot (Immer copy-on-write, rẻ); UNDO_LIMIT 200; gộp lệnh liên tiếp cùng `mergeKey` thành 1 bước undo (drag); `selection` là UI state ngoài undo.
- Test / cách kiểm tra: 17 test pass — device CRUD + undo/redo, cascade delete, chặn 2 link 1 port, undo ≥ 150 bước, merge 3 drag → 1 undo, redo bị xóa khi dispatch mới, selection sống sót qua undo, round-trip file mẫu. `make check` pass. ✅
- Còn dở / lỗi đã biết: chưa có lệnh cho subnet/group (làm cùng panel tương ứng); `addLink` mới thêm edge vào page chưa làm (canvas P1-06 sẽ thêm khi nối dây).
- Câu hỏi cho người dùng: không.
- Task tiếp theo đề xuất: P1-02 Device catalog (template 5 nhóm thiết bị, icon SVG, port layout mặc định).

## 2026-10-15 — P0-04 Docker Compose dev
- Đã làm:
  - `deploy/docker-compose.yml`: service `web` (build multi-stage, cổng 8080→80, depends_on db healthy) + `db` (postgres:16-alpine, volume `db_data`, healthcheck `pg_isready`); cấu hình qua env có mặc định dev.
  - `deploy/web.Dockerfile`: node:22-alpine `npm ci && npm run build` → nginx:1.27-alpine phục vụ static.
  - `deploy/nginx.conf`: cache `/assets/`, SPA fallback `try_files … /index.html`, comment sẵn block proxy `/api` cho Phase 2.
  - `deploy/.env.example`: WEB_PORT, POSTGRES_USER/PASSWORD/DB.
- Test / cách kiểm tra: `docker compose -f deploy/docker-compose.yml up -d --build` → web Up, db Up (healthy); curl http://localhost:8080 trả HTTP 200 với title "Network Topology Builder"; SPA fallback /some-route trả 200. ✅
- Còn dở / lỗi đã biết: không. (Stack dev đang chạy — tắt bằng `docker compose -f deploy/docker-compose.yml down`.)
- Câu hỏi cho người dùng: không.
- Đề xuất quyết định cần chốt: không.
- Task tiếp theo đề xuất: **Phase 1 — P1-01 Store & command** (Network model + View model, Zustand + Immer, command pattern, undo/redo).

## 2026-10-15 — P0-03 Schema file dự án
- Đã làm:
  - `schema/ntb.schema.json` v1.0.0 (JSON Schema draft 2020-12) phản chiếu SRS §7: project, vlans, subnets, devices/interfaces, links (a/b port→port), groups, assets, pages; enum cho device type/role/lifecycle, media, speed, mode, link kind/medium/status, page layer, routing; UUID/IPv4 CIDR theo pattern; `additionalProperties: false` để bắt lỗi chính tả.
  - `testdata/sample-small.ntb.json`: 10 thiết bị (router, firewall, 2× L3 core, 2× access, server, PC, camera, AP), 3 VLAN + 3 subnet, 10 link port→port hợp lệ, 1 page + 1 group zone.
  - `make types` → `frontend/src/types/ntb.ts` bằng `json-schema-to-typescript` (devDep mới, ngoài PLAN cần bạn biết); thêm `ajv-formats` cho `format: date-time`.
  - Test ajv `src/schema/schema.test.ts`: sample PASS; schemaVersion sai, vlanId out of range, unknown property → FAIL.
  - Go struct `backend/internal/model` + test round-trip với file mẫu (đúng quy ước CLAUDE.md). Bài học: `omitempty` phá round-trip với `false`/`{}`/`[]`/`""`; `allowedVlans` dùng `*[]int` để phân biệt vắng mặt vs `[]`.
  - (Đã chốt từ phiên trước) ADR-010 React 19; SRS + CLAUDE.md cập nhật.
- Test / cách kiểm tra: `make check` pass — 5 test FE (schema 4 + App smoke 1), Go round-trip + schemaVersion pass, oxlint/golangci-lint 0 issues. ✅
- Còn dở / lỗi đã biết: schema thuần không diễn đạt được ràng buộc chéo (vd 2 đầu link cùng 1 interface) — việc của validation engine (P1-09), không phải schema.
- Câu hỏi cho người dùng: không.
- Đề xuất quyết định cần chốt: không.
- Task tiếp theo đề xuất: P0-04 Docker Compose dev (web + db Postgres 16).

## 2026-10-15 — P0-02 Lint & test
- Đã làm:
  - Frontend: giữ **oxlint** (có sẵn từ template, thay cho ESLint trong PLAN — người dùng đã chốt); thêm **Prettier** (`.prettierrc.json`, `.prettierignore`); thêm **Vitest** + jsdom + Testing Library (`vitest.config.ts`, `vitest.setup.ts`, test smoke `src/App.test.tsx`); d.ts đăng ký matcher jest-dom.
  - Backend: `.golangci.yml` (default standard + revive + sloglint); cài golangci-lint qua Homebrew.
  - `Makefile`: `check` = oxlint + prettier check + tsc -b + vitest + go vet + golangci-lint + go test; thêm target `format`.
  - Đổi `__dirname` → `import.meta.dirname` trong vite/vitest config theo khuyến nghị Vite.
- Test / cách kiểm tra: `make check` pass sạch (exit 0, 1 test pass, "0 issues") trên repo trống. ✅
- Còn dở / lỗi đã biết: không.
- Câu hỏi cho người dùng: (treo từ P0-01) React 18 hay 19 — cần chốt để cập nhật ADR.
- Đề xuất quyết định cần chốt: không mới.
- Task tiếp theo đề xuất: P0-03 Schema file dự án (`ntb.schema.json` v1.0.0 + file mẫu + `make types`).

## 2026-10-15 — P0-01 Khung monorepo
- Đã làm:
  - `/frontend`: scaffold Vite + React + TS strict (`"strict": true` thêm tay vào tsconfig.app.json), Tailwind CSS v4 (plugin `@tailwindcss/vite`), shadcn/ui init (preset `nova`, Base UI), alias `@/ -> src/`. Trang trống tối giản, title "Network Topology Builder".
  - `/backend`: Go module `github.com/phanvannhien/networkdiagramdrawer/backend`, `cmd/ntb/main.go` in "ok".
  - `Makefile` (dev-web, dev-api hoạt động; sqlc/migrate-up/types/check ghi khung TODO cho task sau), `.editorconfig`, `.gitignore`, `README.md`, thư mục `schema/`, `testdata/`, `deploy/` giữ chỗ.
- Test / cách kiểm tra:
  - `make dev-web` → curl http://localhost:5173/ trả HTTP 200, trang chứa "Network Topology Builder". ✅
  - `cd backend && go build ./...` + `go vet ./...` pass; `go run ./cmd/ntb` in "ok". ✅
  - `npm run build` (gồm `tsc -b` strict) pass. ✅
- Còn dở / lỗi đã biết: template Vite hiện tại dùng TS 6.0 — đã bỏ `baseUrl` (deprecated) và dùng `paths` tương đối.
- Câu hỏi cho người dùng: **React 18 hay 19?** Vite template mới cài sẵn React 19.2.8. CLAUDE.md/ADR ghi React 18. Đề xuất giữ React 19 (stable, `@xyflow/react` v12 hỗ trợ) và cập nhật lại stack trong docs; hoặc hạ xuống 18.3.1 nếu muốn bám đúng ADR.
- Đề xuất quyết định cần chốt: nếu giữ React 19 → thêm ADR-010 (hoặc sửa ADR cũ về stack) ghi rõ thay đổi.
- Task tiếp theo đề xuất: P0-02 Lint & test (ESLint + Prettier + Vitest, golangci-lint, `make check`).

## 2026-10-15 — Khởi tạo tài liệu
- Đã làm: chốt SRS v1.2, kế hoạch theo phase, các ADR 001–009.
- Câu hỏi cho người dùng: quy mô sơ đồ lớn nhất thực tế (thiết bị/trang)? Danh sách hãng/model ưu tiên? Team bao nhiêu người, deadline MVP?
- Task tiếp theo đề xuất: P0-01 Khung monorepo.
