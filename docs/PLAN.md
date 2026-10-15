# Kế hoạch triển khai — Network Topology Builder

Mỗi task đủ nhỏ để làm trong 1 phiên Claude Code. Làm theo thứ tự trong phase, trừ khi người dùng chỉ định khác.
Tick `[x]` khi xong và ghi `docs/STATUS.md`. Chi tiết yêu cầu tra trong `docs/SRS.md` theo số mục (§).

Phase hiện tại: **Phase 0**

---

## Phase 0 — Khởi tạo dự án

- [x] **P0-01 Khung monorepo**: tạo `/frontend` (Vite + React + TS strict + Tailwind + shadcn/ui), `/backend` (Go module, `cmd/ntb/main.go` in "ok"), `Makefile`, `.editorconfig`, `.gitignore`, `README.md`.
  Done khi: `make dev-web` mở trang trống; `cd backend && go build ./...` thành công.
- [x] **P0-02 Lint & test**: oxlint + Prettier, Vitest; golangci-lint, `go test`; target `make check`.
  Done khi: `make check` pass trên repo trống.
- [ ] **P0-03 Schema file dự án**: `schema/ntb.schema.json` v1.0.0 theo SRS §7; `testdata/sample-small.ntb.json` (~10 thiết bị, có VLAN, subnet, link); `make types` sinh TS types.
  Done khi: file mẫu validate pass bằng ajv; types sinh ra được import trong frontend.
- [ ] **P0-04 Docker Compose dev**: `deploy/docker-compose.yml` gồm `web` (Nginx phục vụ build frontend) và `db` (Postgres 16, volume); `.env.example`.
  Done khi: `docker compose up -d --build` mở được app ở http://localhost:8080.

## Phase 1 — MVP (chỉ frontend, chạy offline)

- [ ] **P1-01 Store & command**: Network model + View model (SRS §7) trong Zustand + Immer; command pattern; undo/redo ≥ 100 bước, gộp thao tác kéo liên tục.
  Done khi: unit test thêm/sửa/xóa device, link + undo/redo pass.
- [ ] **P1-02 Device catalog**: template cho 5 nhóm thiết bị gốc (SRS §2) gồm icon SVG, loại, port layout mặc định (vd switch 24×RJ45 + 4×SFP+).
  Done khi: tạo device từ template sinh đúng danh sách interface.
- [ ] **P1-03 Palette**: danh sách theo nhóm, ô tìm kiếm, kéo thả vào canvas.
- [ ] **P1-04 Canvas cơ bản**: React Flow, zoom 10–400%, pan (Space + kéo), grid snap bật/tắt, minimap, Fit to screen.
- [ ] **P1-05 Thao tác chọn & sửa**: multi-select (Shift, rubber-band, Ctrl+A), copy/paste giữ link nội bộ và tự đổi hostname trùng, duplicate, delete (xóa kèm link), lock, phím tắt theo SRS §3.
- [ ] **P1-06 Nối dây port → port**: kéo từ thiết bị, popup chọn cổng trống hợp lệ, auto-assign, chặn 2 link vào 1 cổng, loại link (Ethernet/Fiber/Wireless/Serial/Logical) với kiểu nét theo SRS §4, nhiều link song song không đè nhau.
- [ ] **P1-07 Sidebar thuộc tính**: tab General / Interfaces / Links / Notes cho Device; form Link; nhập IP dạng CIDR; sửa hàng loạt khi chọn nhiều.
- [ ] **P1-08 Label & tooltip**: label template `{hostname}\n{mgmtIp}`, label cổng hai đầu link + tốc độ; ẩn label phụ khi zoom < 50%; tooltip khi hover.
- [ ] **P1-09 Validation**: rule engine trong Web Worker, debounce 300 ms, các rule MVP ở SRS §6; panel Problems, click lỗi → zoom tới đối tượng, badge cảnh báo trên node.
  Done khi: mỗi rule có unit test (trường hợp đúng + sai).
- [ ] **P1-10 Lưu trữ**: autosave IndexedDB (30 s + khi đổi), khôi phục phiên; Save/Load file `.ntb.json` có validate schema; cảnh báo rời trang khi chưa lưu.
  Done khi: Save → Load cho model giống hệt (deep equal).
- [ ] **P1-11 Export**: PNG (1x–4x, nền trong suốt/trắng) và SVG, có legend.
- [ ] **P1-12 Theme & i18n**: Dark/Light/System; tiếng Việt + tiếng Anh.
- [ ] **P1-13 Benchmark**: script sinh sơ đồ 500 và 2.000 thiết bị vào `/testdata`; đo FPS khi kéo và thời gian mở file; ghi kết quả vào STATUS.
- [ ] **P1-14 Gate MVP**: chạy checklist nghiệm thu SRS §10; sửa lỗi tới khi đạt.

## Phase 2 — Backend Go & tính năng Pro

- [ ] **P2-01 API skeleton**: chi, cấu hình từ env, slog JSON, `/healthz`, graceful shutdown; thêm service `api` vào Compose, Nginx proxy `/api`.
- [ ] **P2-02 DB & migration**: bảng `users`, `sessions`, `projects`, `project_versions` (JSONB + schema_version), `audit_log`; query sqlc.
  Done khi: `make migrate-up` chạy được, test sqlc với Postgres trong Docker.
- [ ] **P2-03 Auth**: đăng nhập email/password (argon2id), session cookie HttpOnly lưu Postgres; vai trò owner/editor/viewer theo project.
- [ ] **P2-04 Projects API**: list/create/get/save có kiểm tra version (optimistic lock, trả 409 khi xung đột); list/restore phiên bản; validate body bằng JSON Schema.
- [ ] **P2-05 Frontend ↔ API**: màn hình danh sách dự án, mở/lưu lên server, xử lý xung đột; vẫn dùng được chế độ offline.
- [ ] **P2-06 Panel VLAN & Subnet/IPAM**: CRUD, màu VLAN áp toàn sơ đồ, gợi ý IP trống, % sử dụng subnet.
- [ ] **P2-07 Multi-page & layer**: nhiều trang/site, off-page connector, layer Physical / L2 / L3.
- [ ] **P2-08 Validation Phase 2**: VLAN lệch, trunk thiếu VLAN, speed/duplex mismatch, subnet chồng lấn.
- [ ] **P2-09 Export báo cáo**: PDF A4/A3 có title block; CSV/Excel: IP plan, port map, danh sách thiết bị/BOQ, bảng VLAN.
- [ ] **P2-10 Compose production**: web + api + db, healthcheck, restart policy, script backup `pg_dump` hằng ngày, hướng dẫn cài trong README.
- [ ] **P2-11 Gate Pro**: PDF đúng mẫu, review bảo mật (auth, phân quyền, header, rate limit login).

## Phase 3 — SNMP: trạng thái thật trên sơ đồ

- [ ] **P3-01 Môi trường test SNMP**: thêm container `snmpsim` với dữ liệu mẫu (2–3 switch/router) vào Compose dev; mọi test tích hợp SNMP chạy với nó.
- [ ] **P3-02 Credential profile**: SNMP v2c/v3 (auth SHA/SHA-256, priv AES), lưu mã hóa AES-GCM; API CRUD chỉ trả về metadata, không trả secret.
- [ ] **P3-03 Gắn thiết bị**: device ↔ mgmt IP + profile; nút "Test SNMP" (đọc sysName, sysDescr); tự map interface ↔ ifIndex qua ifName/ifDescr, cho phép sửa tay.
- [ ] **P3-04 Poller**: worker pool goroutine, chu kỳ cấu hình (mặc định 60 s), timeout/retry, giới hạn số request đồng thời; OID theo SRS §11.
  Done khi: poll 200 thiết bị giả lập trong < 1 chu kỳ, không rò goroutine (test).
- [ ] **P3-05 Lưu trạng thái**: `device_status`, `interface_status` (giá trị mới nhất), `interface_metrics` (time series, giữ 7 ngày, job dọn dữ liệu).
- [ ] **P3-06 Đẩy live**: SSE `GET /api/projects/{id}/live` gửi thay đổi trạng thái.
- [ ] **P3-07 UI live**: màu link theo ifOperStatus thật, % utilization trên link, badge thiết bị unreachable, "last seen"; công tắc Design ↔ Live.
- [ ] **P3-08 Discovery LLDP (tùy chọn)**: walk LLDP-MIB → đề xuất link chưa vẽ và cảnh báo link vẽ sai cổng.

## Phase 4 — Mở rộng (chưa lên lịch)

- [ ] Cộng tác realtime (xem ADR-009)
- [ ] Import draw.io / CSV
- [ ] Path trace, phát hiện single point of failure, PoE budget
- [ ] SNMP trap receiver
- [ ] Desktop app (Tauri)
