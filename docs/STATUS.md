# Nhật ký trạng thái

Mục mới nhất ở trên cùng. Claude Code ghi vào đây sau mỗi task (mẫu trong `CLAUDE.md`).
Khi cần bàn bạc trên claude.ai, dán mục mới nhất (hoặc cả file) vào chat.

---

## 2026-10-16 — Chuyển sang SRS v2.0
- Đã làm: áp dụng CLAUDE.md mới, SRS v2.0, DECISIONS hợp nhất (ADR-001..020), PLAN v2. Đối chiếu code hiện có với PLAN v2 (chưa sửa code).
  Mọi task "P1-xx" ở các mục STATUS bên dưới là ID của PLAN v1, không trùng nghĩa với ID PLAN v2.
- Test / cách kiểm tra (chạy thật):
  - `make check` exit 0 (89 test FE, Go round-trip, oxlint + golangci-lint 0 issues).
  - P0-01: CHƯA đạt — `make dev-api` chỉ in "ok" rồi thoát; chưa có chi, `/healthz`, proxy Vite, `api/openapi.yaml`, react-router, TanStack Query.
  - P0-02: đạt về chức năng nhưng dùng oxlint (người dùng chốt ở phiên P0-02 cũ), PLAN v2 ghi ESLint → chưa tick, chờ chốt.
  - P0-03: CHƯA (chưa có oapi-codegen / openapi-typescript / sqlc). P0-04: một phần (db trong Compose, chưa có migration). P0-05: một phần (web + db, chưa có api; cổng đang là 8068 vì 8080 bị trùng, PLAN v2 ghi 8080).
  - Kết quả: không tick task nào trong PLAN v2.
- Code dùng lại được (ứng với PLAN v2):
  - Khung frontend Vite + React 19 + TS strict + Tailwind + shadcn/ui → P0-01 (thiếu router/TanStack Query).
  - Lint/format/test + `make check`, golangci-lint → P0-02. Dockerfile web, nginx.conf, service db → P0-04/P0-05.
  - Editor: store + commands + undo/redo (snapshot Immer, mergeKey, compound) → P1-13; CanvasView/DeviceNode/adapters → P1-14;
    catalog template + icon + generateInterfaces, Palette → P1-09/P1-15; chọn/copy/paste/duplicate/lock/phím tắt → P1-16;
    LinkDialog + ports.ts + edge style + link song song → P1-17; Sidebar, label template, LinkEdge, tooltip → P1-18;
    rule engine + Web Worker + Problems + badge + cidr helpers → P1-20; schema + ajv + Go round-trip → P1-22 (.ntb.json).
- Phải sửa:
  - Model editor: `NtbData` (cả tài liệu trong client) → view của diagram + tham chiếu thực thể kho lấy qua API; command sinh change set (view + kho) để lưu 1 request/1 transaction (P1-13).
  - Schema/types: mgmtIp → mgmt_interface_id; interface `kind`; ip_addresses (vrf, role); lifecycle mới (planned/active/spare/rma/retired); site/location, part number, S/N, managed; link endpoint a_kind/b_kind, interface null; endpoint_groups, ip_ranges; view node refKind. Go `internal/model` thành DTO export/import.
  - Hành vi: Delete chỉ gỡ khỏi sơ đồ, Shift+Delete xóa khỏi kho (hiện `deleteDevice` cascade xóa kho); `addLink` cho phép interface null, chặn link vật lý vào interface ảo; trùng hostname theo tổ chức + trùng S/N.
  - Cấu trúc thư mục: `src/model|canvas|panels|validation|io` → `src/editor/...`, `src/app`, `src/modules`, `src/api`.
  - Makefile: `make types` → `make gen`; migrate targets thật. Compose thêm `api` + proxy `/api`.
  - LỖI CỦA TÔI (P1-10 v1): `dexie` + `fake-indexeddb` cài nhầm vào `package.json` ở gốc repo (sai thư mục) và đã commit; phải chuyển vào `frontend/` và xóa `package.json`/`package-lock.json`/`node_modules` ở gốc.
- Nên bỏ: autosave cả tài liệu vào IndexedDB + khôi phục phiên (`useAutosave`, session `replaceDocument`) — ADR-015 chỉ giữ nháp chưa gửi;
  Save/Open file làm lưu chính (Ctrl+S nay là lưu lên server; logic file chuyển sang export/import P1-22); `useEnsurePage` tự tạo page; tạo device thuần client (`deviceDropCommand`, hostname tự sinh phía client) — tạo thiết bị phải qua API/change set; layout App 3 cột hiện tại → app shell có router.
- Còn dở / lỗi đã biết: file `ntb-v2.zip` (bản gốc 4 tài liệu) nằm chưa track ở gốc repo — không commit, đề xuất xóa hoặc thêm vào .gitignore.
- Câu hỏi cho người dùng: (1) giữ oxlint (ghi ADR mới) hay đổi sang ESLint? (2) cổng web 8080 (theo PLAN) hay 8068 (đang dùng vì trùng cổng)? (3) cho phép cài tool CLI: oapi-codegen, sqlc, golang-migrate (go install/brew)?
- Đề xuất quyết định cần chốt: oapi-codegen chưa hỗ trợ đầy đủ OpenAPI 3.1 (ADR-017 ghi 3.1) — cần kiểm tra phiên bản; nếu không ổn thì viết spec 3.0.3 và ghi ADR.
- Task tiếp theo đề xuất: dọn dẹp (package.json gốc, zip, chốt lint/cổng) → P0-01 → P0-04 → P0-03 → P0-05 (đổi chỗ 03/04 vì sqlc cần migration có sẵn).

## 2026-10-16 — P1-10 Lưu trữ
- Đã làm:
  - Thêm deps: `dexie` (Stack), `fake-indexeddb` (dev, test IndexedDB).
  - `src/io/autosave.ts`: Dexie DB `ntb`, bảng `sessions` (1 dòng `current`), `saveSession/loadSession/clearSession`; dirty tracking module-level (`isDirty`/`markSaved`).
  - `src/io/useAutosave.ts`: autosave 30 s sau lần thay đổi cuối, flush khi `pagehide`, cảnh báo `beforeunload` khi chưa flush, khôi phục phiên lúc mở app (chỉ khi document còn trống và session không rỗng).
  - `src/io/schemaValidate.ts`: compile schema bằng ajv (alias `@schema` mới — vite/vitest/tsconfig, vì schema nằm ngoài frontend root; thêm `resolveJsonModule`).
  - `src/io/file.ts`: `downloadProjectFile` (tải `.ntb.json`, tên theo project.name), `readProjectFile` (JSON.parse → ajv validate → fromNtbProjectFile, lỗi có thông báo tiếng Việt).
  - Lệnh `replaceDocument` (load file / restore = 1 bước undo). Toolbar: nút Open (file input ẩn) + Save; **Ctrl+S** lưu file + refresh autosave (SRS §3).
- Test / cách kiểm tra: 89/89 pass (7 test mới) — **Done khi: Save → Load deep-equal** cho cả round-trip file lẫn session IndexedDB (fake-indexeddb); validate schema chặn file hỏng; replaceDocument 1 bước undo. `make check` pass. ✅
- Còn dở / lỗi đã biết: IndexedDB là theo origin — dữ liệu dev (5173) và Docker (8068) khác nhau; autosave chưa hiện trạng thái "đã lưu lúc…" trên UI (có thể thêm nhỏ ở P1-12).
- Câu hỏi cho người dùng: không.
- Task tiếp theo đề xuất: P1-11 Export PNG (1x–4x, nền trong suốt/trắng) và SVG, có legend.

## 2026-10-15 — P1-09 Validation
- Đã làm:
  - `src/validation/cidr.ts`: parse strict IPv4 CIDR (network/broadcast/contains/networkKey). Bài học: `ipaddr.IPv4.subnetMask` không tồn tại ở ESM build → tự tính mask từ prefix; `parsed.octets` cần cast vì type union IPv4|IPv6.
  - `src/validation/rules.ts`: 8 rule MVP SRS §6 — R1 IP sai định dạng/network/broadcast (Error), R2 trùng IP cùng VRF (Error), R3 trùng hostname (Error), R4 1 cổng > 1 link (Error), R5 sai loại cổng RJ45↔SFP (Warning), R6 gateway ngoài subnet (Warning), R7 2 đầu link L3 khác subnet (Warning), R8 thiết bị không link (Info); `severityForDevice` cho badge.
  - `engine.ts` (gộp rule) + `worker.ts` (Web Worker, Vite `new URL` module worker) + `useValidation` hook (debounce 300 ms, fallback chạy sync khi không có Worker — jsdom).
  - Store: `problems`, `focusTarget` (nonce để click lặp lại vẫn re-zoom). `Problems.tsx`: panel đáy canvas, đếm theo severity, click → zoom tới node (`setCenter`) hoặc fitView 2 đầu link. `DeviceNode`: badge màu theo severity nặng nhất (đỏ/vàng/xanh).
  - `testdata/sample-small.ntb.json`: thêm cổng SFP uplink cho 2 access switch và cổng X1/X2 SFP+ cho firewall FG-100F (2 link cũ rj45↔sfp_plus sai thực tế) — file mẫu giờ validate sạch.
- Test / cách kiểm tra: 82/82 pass — mỗi rule có test đúng + sai (tiêu chí "Done khi"), test cidr helpers, engine tổng hợp, **file mẫu phải sạch hoàn toàn**. `make check` pass. ✅
- Còn dở / lỗi đã biết: chưa test chính Web Worker (chạy browser, kiểm tay; jsdom dùng fallback sync); click problem của subnet không có device thì không zoom (target rỗng, no-op có chủ đích).
- Câu hỏi cho người dùng: không.
- Task tiếp theo đề xuất: P1-10 Lưu trữ (autosave IndexedDB 30 s + khi đổi, khôi phục phiên, Save/Load .ntb.json validate schema, cảnh báo rời trang; Done khi Save→Load deep equal).

## 2026-10-15 — P1-08 Label & tooltip
- Đã làm:
  - `src/canvas/labels.ts`: `renderLabelTemplate` — thay `{hostname}`, `{mgmtIp}`, `{vendor}`, `{model}`, `{role}`, `{site}`; mặc định `{hostname}\n{mgmtIp}` (page.labelTemplate, placeholder lạ giữ nguyên).
  - `DeviceNode`: render label theo template — dòng đầu luôn hiện, dòng phụ (mgmtIp…) ẩn khi zoom < 50% (đọc zoom từ store của React Flow); tooltip hover = `title` gồm hostname · mgmtIp · vendor · model.
  - `src/canvas/LinkEdge.tsx`: custom edge với `EdgeLabelRenderer` — tên cổng 2 đầu + tốc độ ở giữa (dữ liệu do `buildEdges` gắn); label edge cũng ẩn khi zoom < 50%; giữ style màu/nét đứt từ `edgeVisual` và curvature link song song.
  - `CanvasView`: đăng ký `edgeTypes` ổn định (hằng số ngoài component tránh warning React Flow).
- Test / cách kiểm tra: 69/69 pass (5 test mới: template mặc định/custom/placeholder lạ/thiếu giá trị, buildNodes gắn label, buildEdges gắn sourceLabel/targetLabel/speed). Zoom ẩn/hiện và tooltip kiểm tra bằng tay (Playwright để gate P1-14). `make check` pass. ✅
- Còn dở / lỗi đã biết: label template chưa có UI sửa (thuộc multi-page P2-07); label tốc độ hiện text đơn giản, độ dày nét theo tốc độ đã có ở edgeVisual (fiber 3px).
- Câu hỏi cho người dùng: không.
- Task tiếp theo đề xuất: P1-09 Validation (rule engine trong Web Worker, debounce 300ms, rule MVP SRS §6, panel Problems) — task lớn nhất còn lại của Phase 1 MVP lõi.

## 2026-10-15 — P1-07 Sidebar thuộc tính
- Đã làm:
  - Thêm dep `ipaddr.js` (đã trong Stack). `src/lib/validate.ts`: `isValidCidr` (strict dotted-quad — ipaddr.js mặc định chấp nhận viết tắt kiểu "10.0.0/24", đã chặn bằng regex), `parseCidrList` (danh sách IP cách nhau dấu phẩy/khoảng trắng).
  - Lệnh mới: `updateLink`, `updateDevicesBulk` (1 bước undo).
  - `src/panels/Sidebar.tsx`: sidebar phải với 3 tab khi chọn 1 thiết bị — General (hostname/vendor/model/role/lifecycle/mgmtIp CIDR/site; text commit khi blur, select/checkbox commit ngay, CIDR sai viền đỏ + không commit), Interfaces (từng interface: mode, speed, IP CIDR list, PoE, admin up), Links (link 2 đầu: hiển thị port ↔ peer, sửa status/speed/cableId/lengthM/notes). Chọn nhiều → form sửa hàng loạt role/lifecycle/site + nút Áp dụng.
  - `App.tsx`: layout Palette | Canvas | Sidebar.
- Test / cách kiểm tra: 64/64 pass (9 test mới: CIDR đúng/sai/viết tắt bị chặn, parseCidrList, updateDevice, updateDevicesBulk 1 bước undo, updateLink không đụng 2 đầu, throw khi thiếu link). `make check` pass. ✅
- Còn dở / lỗi đã biết: tab Notes và các field SRS §5 chưa có trong schema v1.0.0 (serial, OS, gateway, DNS, VLAN quản trị, tầng/phòng, bảo hành, công suất, PoE budget) — cần mở rộng schema ở task riêng; sửa hàng loạt cho interfaces (mode/accessVlan chung) chưa làm; label template {hostname}\n{mgmtIp} là P1-08.
- Câu hỏi cho người dùng: không.
- Task tiếp theo đề xuất: P1-08 Label & tooltip (label template, label cổng 2 đầu + tốc độ, ẩn khi zoom < 50%, tooltip hover).

## 2026-10-15 — P1-06 Nối dây port → port
- Đã làm:
  - `src/model/ports.ts`: `mediaGroup` (copper/fiber/wireless/serial/console/logical — cổng chỉ nối được cùng nhóm, SRS §4), `usedPorts`, `firstFreePort` (auto-assign), `kindForMediaGroup`.
  - Lệnh `connectPorts` = `addLink` (chặn port đã có link, có sẵn P1-01) + `addPageEdge` — 1 bước undo.
  - `src/canvas/LinkDialog.tsx`: popup sau khi kéo dây từ thiết bị A thả vào B — chọn cổng 2 đầu; cổng đã dùng/sai loại bị disable + làm mờ kèm chú thích; mặc định = auto-assign cổng trống đầu tiên cùng nhóm media; loại link suy theo nhóm cổng.
  - Kéo dây: `onConnectStart` (lấy nodeId nguồn) → `onConnectEnd` (elementFromPoint tìm node đích) → mở dialog; handle nguồn connectable trên DeviceNode.
  - `src/canvas/edges.ts` + `buildEdges`: kiểu nét & màu theo SRS §4 — ethernet liền, fiber dày 3px, wireless `5 4`, serial `2 3`, logical `7 5`, console `1 4`; màu theo status up xanh / down đỏ / planned+admin_down xám; **link song song tách curvature tăng dần** theo cặp 2 đầu.
- Test / cách kiểm tra: 55/55 pass (10 test mới: phân nhóm media, usedPorts, auto-assign, connectPorts 1 bước undo + chặn port trùng + mở lại port sau khi xóa link, style theo kind/status, curvature tăng dần cho link song song). `make check` pass. ✅
- Còn dở / lỗi đã biết: kéo lại đầu dây để đổi cổng (SRS §4) chưa làm; sửa form Link thuộc P1-07; hiện dialog chỉ khi thả vào node (thả ra vùng trống = hủy). Bugs đã sửa trong phiên: rules-of-hooks (useCallback sau early return), `Record<Link['status']>`, `Link['status']` là optional sau json2ts — dùng hàm colorFor thay Record.
- Câu hỏi cho người dùng: không.
- Task tiếp theo đề xuất: P1-07 Sidebar thuộc tính (tab General / Interfaces / Links cho Device; form Link; nhập CIDR; sửa hàng loạt).

## 2026-10-15 — P1-05 Thao tác chọn & sửa
- Đã làm:
  - Selection: đồng bộ 2 chiều store ↔ React Flow qua `onNodesChange` (select changes → `setSelection`), `buildNodes` nhận `selection` để render selected; rubber-band + Shift+click của RF giữ nguyên, multi-select Shift.
  - Lệnh mới: `compound` (gộp nhiều lệnh = 1 bước undo), `deleteDevices` (xóa hàng loạt 1 bước), `setNodeLocked`, `buildPasteCommand` (copy device: id/interface mới, **hostname tự đổi khi trùng** — sinh trong apply để tránh đụng nhau, giữ link nội bộ remap 2 đầu, node offset +20px, tất cả 1 bước undo).
  - Store: thêm `clipboard` (UI state, không undo).
  - `useCanvasShortcuts`: Ctrl/Cmd+Z (+Shift redo), Ctrl+A, Ctrl+C/X/V, Ctrl+D (duplicate), Delete/Backspace (xóa selection), Ctrl+L (lock/unlock selection); bỏ qua khi đang gõ trong input/select/textarea.
  - Toolbar: nút Lock/Unlock (disabled khi không có selection).
- Test / cách kiểm tra: 45/45 pass (6 test mới: deleteDevices 1 bước undo, paste đổi hostname SW-03/SW-04 + giữ link remap + offset vị trí + 1 bước undo, lock → draggable=false, compound, clipboard sống sót qua dispatch). `make check` pass. ✅
- Còn dở / lỗi đã biết: chọn link (edge) chưa lưu vào selection (làm cùng P1-06/P1-07 khi có form Link); Group/Ungroup (Ctrl+G) thuộc panel group — hoãn về P2-07; paste ngoài canvas (sau khi reload) chưa cần vì clipboard chỉ trong bộ nhớ.
- Câu hỏi cho người dùng: không.
- Task tiếp theo đề xuất: P1-06 Nối dây port → port (handle theo interface, popup chọn cổng, auto-assign, chặn 2 link 1 port — lệnh addLink đã có sẵn từ P1-01).

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
