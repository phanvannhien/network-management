# Kế hoạch triển khai — Network Topology Builder (v2)

Áp dụng từ SRS v2.0 (2026-10-16). Mỗi task vừa một phiên Claude Code. Làm theo thứ tự trong phase trừ khi người dùng chỉ định.
Tick `[x]` khi xong và ghi `docs/STATUS.md`. Chi tiết tra SRS theo §.

Quy tắc chung cho MỌI task backend: endpoint khai báo trong `api/openapi.yaml` trước; query lọc `organization_id`;
có test chống truy cập chéo tổ chức; thao tác ghi có audit log; kiểm tra quyền ở backend.

Phase hiện tại: **Phase 0**

---

## Phase 0 — Nền móng

- [x] **P0-01 Khung monorepo**: `/frontend` (Vite + React 19 + TS strict + Tailwind + shadcn/ui + react-router + TanStack Query), `/backend` (Go module, chi, `/healthz`), `/api/openapi.yaml` tối thiểu, `Makefile`, `.editorconfig`, `.gitignore`, README.
  Done khi: `make dev-web` và `make dev-api` chạy; frontend gọi được `/api/healthz` qua proxy Vite.
- [x] **P0-02 Lint & test**: oxlint + Prettier (ADR-021), Vitest; golangci-lint, `go test`; `make check`.
- [x] **P0-03 Sinh code**: `make gen` chạy oapi-codegen (Go), openapi-typescript + openapi-fetch (TS), sqlc. Có một endpoint mẫu đi trọn đường OpenAPI → Go → TS.
- [x] **P0-04 Database**: Postgres 16 trong Compose dev; golang-migrate; migration đầu: organizations, users, memberships, sessions, audit_log; cấu hình test tích hợp với Postgres thật.
  Done khi: `make migrate-up/down` chạy; test Go kết nối DB pass.
- [x] **P0-05 Compose đầy đủ**: `web` (Nginx + build frontend, proxy `/api`), `api`, `db` (volume), healthcheck, `.env.example` (gồm `NTB_MASTER_KEY`).
  Done khi: `docker compose up -d --build` → mở http://localhost:8068 thấy trang đăng nhập (ADR-021).

## Phase 1 — MVP

### Nền tảng hệ thống
- [x] **P1-01 Đăng nhập**: argon2id, session cookie HttpOnly/SameSite trong Postgres, logout, khóa tạm khi sai nhiều lần, CSRF, rate limit; lệnh CLI `ntb admin create` tạo system admin đầu tiên.
- [x] **P1-02 MFA TOTP**: bật/tắt, mã khôi phục; bắt buộc với owner/admin; lưu secret mã hóa (envelope, `NTB_MASTER_KEY`).
- [x] **P1-03 Tổ chức & tenant middleware**: CRUD tổ chức (system admin), chuyển tổ chức, middleware lấy organization từ session/route; bộ test mẫu chống truy cập chéo dùng lại cho mọi module; membership giới hạn theo đơn vị/site. *(phần đơn vị chưa làm — thay bằng P1-07c theo ADR-029)*
- [x] **P1-04 Người dùng & vai trò**: mời/tạo user, membership nhiều tổ chức, vai trò owner/admin/editor/viewer, giới hạn theo site; kiểm tra quyền ở mọi endpoint.
- [x] **P1-05 Audit log**: ghi trước/sau cho thao tác ghi, đăng nhập, export; màn hình xem/lọc audit. *(export chưa có phía server — ghi audit `export.*` làm trong P1-22)*
- [x] **P1-06 App shell**: layout menu trái theo SRS §2 (module chưa làm thì ẩn), org switcher, Ctrl+K (khung, kết quả bổ sung dần), Dark/Light, i18n vi/en.

### Dữ liệu hạ tầng
- [x] **P1-07 Đơn vị/Sites/Location/Rack**: CRUD đơn vị; site có kind và đơn vị (hoặc dùng chung); cây location; rack view đơn giản; quy tắc mã ADR-030 (bắt buộc + gợi ý).
- [x] **P1-07b Cấp Đối tác (ADR-031)**: bảng `partners` (mã, quan hệ với tổ chức, liên hệ); đơn vị bắt buộc thuộc đối tác (mã đơn vị duy nhất trong đối tác); mã site theo mã đối tác; chuyển dữ liệu P1-07 (đơn vị hiện có → đối tác + một đơn vị mặc định mã `MAIN`); giao diện Đối tác → Đơn vị → Site.
- [x] **P1-07c Phân quyền theo đối tác/đơn vị & chia sẻ (ADR-029, ADR-031)**: `partner_members` (partner_admin/editor/viewer) và `business_unit_members` (unit_admin/editor/viewer), quyền = hợp các cấp; partner_admin/unit_admin mời/phân quyền user, tạo/sửa đơn vị/site trong phạm vi; `resource_shares` cho site với đích đối tác hoặc đơn vị (xem/sửa); bộ chọn đối tác/đơn vị trên topbar; bỏ `site_scope`; audit mọi cấp/thu hồi quyền; test chéo đối tác/đơn vị như test chéo tổ chức.
- [x] **P1-08 Kho thiết bị**: bảng devices đủ trường SRS §4.1 (trừ phần Phase 2), danh sách phân trang server + lọc + chọn cột + sửa hàng loạt; trang chi tiết các tab có sẵn dữ liệu; custom fields + tag; thiết bị có business_unit_id (mặc định theo site, bắt buộc chọn khi site dùng chung); lọc theo đối tác/đơn vị.
- [x] **P1-09 Template & interface**: template theo SRS §4.3 sinh cổng physical; thêm interface ảo; IP theo interface (CIDR, VRF, role); chọn interface quản trị; IP NAT/public; `poll_address`.
- [x] **P1-09b Cụm thiết bị**: device_clusters, gán thành viên, IP/hostname cụm, rule trùng IP/hostname bỏ qua trong cụm; trên sơ đồ hiển thị gộp/mở rộng.
- [x] **P1-10 IPAM cơ bản**: VLAN, subnet, ip_ranges; mức sử dụng; gợi ý IP trống; tìm IP thuộc ai.
- [x] **P1-11 Nhóm thiết bị đầu cuối**: endpoint_groups + members, liên kết dải IP, đã dùng/tổng, tách thành viên thành device.
  IP của thành viên nhóm phải vào view `ipam_addresses` (P1-10) để được tính "đang dùng" và "IP trống kế tiếp" bỏ qua.
- [x] **P1-12 Link API**: links với đầu mút device/endpoint group, interface null được; chặn 2 link vào 1 cổng vật lý; chặn link vật lý vào interface ảo.

### Tái cấu trúc phân cấp & quyền (ADR-032, chốt 2026-10-16) — làm trước P1-14
- [x] **P1-27 Cây Danh mục & mã site tự sinh**: migration `categories` (cây cha–con, mã duy nhất giữa anh em), `organizations.code`,
  `sites.category_id` (null = gắn vào tổ chức) + mã riêng + `full_code` (duy nhất trong tổ chức); chuyển dữ liệu theo ADR-032
  (đối tác → danh mục, đơn vị → danh mục con trừ `MAIN`, `SHARED-…` → gắn tổ chức, bỏ tiền tố mã site); API CRUD danh mục, chuyển
  nhánh; **xem trước đổi mã** (`…/preview` trả site cũ → mới) và áp dụng có xác nhận; màn "Danh mục & Sites" dạng cây (thêm/sửa/
  chuyển/xóa danh mục, site dưới mọi nút). Done khi: tạo được "Công ty → Site" không qua danh mục; cây 3+ cấp; đổi mã danh mục hiện
  danh sách site đổi mã và chỉ đổi sau khi xác nhận; dữ liệu cũ chuyển đúng; test chéo tổ chức cho mọi endpoint mới.
- [x] **P1-28 Quyền chỉ theo tổ chức**: bỏ `partner_members`, `business_unit_members`, `resource_shares`, vai trò `member` (→ viewer),
  bộ lọc hiển thị trong mọi query (thiết bị, cụm, nhóm, IPAM, link, sơ đồ) và màn giao quyền/chia sẻ; `access` trên bản ghi = vai trò
  tổ chức; bộ chọn topbar = chọn nhánh danh mục (lọc). Done khi: viewer chỉ xem, editor sửa toàn tổ chức, admin quản lý user;
  không còn code/bảng đối tác/đơn vị/chia sẻ; `make check` pass.
- [x] **P1-29 Gỡ Đơn vị khỏi thiết bị, cụm, nhóm, sơ đồ**: bỏ `business_unit_id` ở devices / device_clusters / endpoint_groups
  (danh mục suy từ site; lọc thiết bị theo nhánh danh mục); sơ đồ thuộc tổ chức (bỏ scope, bỏ hidden refs); form và danh sách cập
  nhật; i18n, hướng dẫn, glossary ("Danh mục" thay "Đối tác/Đơn vị", bỏ "site dùng chung"). Done khi: không còn trường đơn vị ở
  giao diện/API; test cũ viết lại theo mô hình mới pass.

- [x] **P1-31 Mô hình dây & loại thiết bị theo thực tế (ADR-033, chốt 2026-10-17)**: loại dây ethernet (gồm DAC) / fiber (SM-MM,
  đầu nối, PON) / wireless / stack / power / dsl / cellular / console / serial / logical với luật cổng theo từng loại; dịch vụ WAN;
  loại thiết bị provider_cloud, olt, wireless_bridge, console_server; hostname tự đặt + gợi ý theo mã site.
  Done khi: API từ chối dây không cắm được, cho nhiều dây trên radio/PON; dữ liệu cũ chuyển (DAC, MPLS); `make check` pass.

### Editor sơ đồ
- [x] **P1-13 Diagram API & store**: bảng diagrams (view JSONB), lưu có optimistic lock (409 khi xung đột); store editor (Zustand + Immer), commands, undo/redo ≥ 100; lưu = một request gồm thay đổi view + thay đổi dữ liệu kho trong một transaction; nháp chưa gửi giữ ở IndexedDB; diagram có scope organization | business_unit | site *(bỏ phạm vi ở P1-29, ADR-032)*.
- [x] **P1-14 Canvas & toolbar nổi**: React Flow, zoom/pan/grid/minimap/fit, thanh công cụ nổi trên, menu trái thu gọn khi vào màn vẽ. Tooltip tên + phím tắt cho mọi nút; gợi ý thao tác lần đầu mở editor, tắt được (DESIGN.md §4a).
- [x] **P1-15 Thư viện & thêm nhanh**: panel thư viện nổi (tab template / tab "trong kho chưa vẽ"), tìm kiếm, phím `/` thêm nhanh, kéo thả. Mỗi loại thiết bị / template có mô tả 1 dòng; panel thuộc tính dùng hint/guide/help (DESIGN.md §4a).
- [x] **P1-16 Thao tác chọn & sửa**: multi-select, copy/paste giữ link, duplicate, lock, phím tắt SRS §6.4; Delete chỉ gỡ khỏi sơ đồ, Shift+Delete hoặc menu → xóa khỏi kho, **luôn có hộp xác nhận** liệt kê thiết bị và dây bị xóa theo (ADR-033).
- [x] **P1-17 Nối dây**: port → port hoặc device → device; popup chọn cổng; kiểu nét theo loại; link song song; gán cổng sau.
- [ ] **P1-18 Panel thuộc tính & hiển thị**: sửa nhanh device/link/nhóm, mở trang chi tiết; **IPAM ngay trong panel** (chốt 2026-10-16): gán VLAN cho cổng (+ tạo VLAN mới tại chỗ), gán IP cho interface (+ lấy IP trống từ subnet, tạo subnet mới tại chỗ) — lưu vào IPAM chung, menu IPAM giữ để tra cứu nhanh; label template, màu nền label, label cổng, ẩn label khi zoom < 50%, tooltip, viền nét đứt cho managed=false.
- [ ] **P1-19 Annotation & khung nhóm**: text màu, mũi tên, zone có nền; **khung nhóm gắn site/location** (ADR-032): tên lấy theo
  site/location, thiết bị mới thả vào khung nhận site/location của khung.
- [ ] **P1-20 Validation**: rule engine dùng chung logic cho Web Worker (khi vẽ); rule Phase 1 SRS §7; backend kiểm tra lại các rule Error khi lưu/import; panel Problems, badge node. Mỗi rule có unit test.
  Gồm thêm các rule nghiệp vụ mạng (chốt 2026-10-16): IP trùng **theo VRF** (bỏ qua thành viên cùng cụm, ADR-027); IP là địa chỉ
  mạng/broadcast của subnet IPv4 (trừ /31, /32) → cảnh báo; cổng access có allowed/native VLAN, cổng trunk có access VLAN →
  cảnh báo; thành viên LAG khác tốc độ/media → cảnh báo; thành viên cụm khác model/firmware → cảnh báo.
  Thiết bị nằm trong khung nhóm nhưng site/location thật khác khung → cảnh báo (ADR-032).

### Nhập/xuất & tiện ích
- [ ] **P1-21 Import Excel thiết bị**: file mẫu tải về, ánh xạ cột, xem trước, lỗi từng dòng, tạo mới/cập nhật theo hostname hoặc S/N, chạy nền có tiến trình; ánh xạ Site→Danh mục, Location→Site; chuẩn hóa và gộp tên gần giống; đề xuất cụm HA khi trùng IP.
- [ ] **P1-22 Export**: PNG (1x–4x) / SVG có legend; Excel danh sách thiết bị; `.ntb.json` export/import theo `schema/ntb.schema.json` (không có bí mật); mỗi lần export ghi audit `export.*` (từ P1-05).
- [ ] **P1-23 Tìm kiếm toàn cục**: hostname, IP, MAC, S/N, part number, site; kết quả mở đúng trang/zoom tới node trên sơ đồ.
- [ ] **P1-24 Dashboard cơ bản**: số thiết bị theo site/loại/trạng thái, top vấn đề validation, thiết bị thiếu thông tin.
- [ ] **P1-25 Dữ liệu mẫu & benchmark**: seed tổ chức "Tập đoàn Mẫu" (tên giả) có 2 danh mục "Mẫu Food" và "Mẫu Agri"; site "IDC HCM" (datacenter) gắn thẳng vào tổ chức
  có cặp FortiGate 80F HA chung IP 10.136.4.101; Mẫu Food: site Hà Nội (1 router ISR4331 10.136.41.1, 1 switch CBS220 10.136.41.2),
  site HCM (4 switch C1300 10.136.162.4–7); Mẫu Agri: 6 site (Hưng Yên, Vĩnh Long, Bình Định – nhà máy, Bến Cát, Biên Hòa, HCM) mỗi site 1 router
  (ISR4331/ISR4321/C2921/C2911/C2951, IP 10.136.<x>.1); link VPN từ mọi router chi nhánh về cụm FortiGate. S/N dùng giá trị giả.
  Giữ cả dữ liệu "Văn phòng mẫu" cũ như một danh mục thứ ba. Kèm file testdata/import-sample.xlsx đúng định dạng file khách
  (cột Site, Location, Category, Hostname, Ip Address mgmt, PartNumber, S/N, Person in charge) có tên viết lệch để test gộp.
  Script sinh 500/2.000 thiết bị; đo FPS, thời gian mở, thời gian lọc bảng.
- [ ] **P1-26 Gate MVP**: chạy checklist SRS §16, sửa tới khi đạt.

## Phase 2 — Enterprise

- [ ] **P2-01 Review bảo mật nền tảng**: tenant isolation, RBAC, session, CSRF, header, rate limit; cân nhắc Postgres RLS (ADR-016).
- [ ] **P2-02 Kho mật khẩu**: credentials local (envelope encryption, xoay master key) + external reference (Bitwarden/Vaultwarden, HashiCorp Vault, khác); gắn thiết bị; reveal/copy với quyền + MFA 5 phút + audit; clipboard tự xóa; cảnh báo dùng chung/quá hạn đổi.
- [ ] **P2-03 Tài khoản cloud**: CRUD, liên kết credential, thiết bị được quản lý, người giữ MFA, ngày hết hạn.
- [ ] **P2-04 Nhà cung cấp & hợp đồng**: vendors, vendor_contacts, contracts + đính kèm file; liên kết thiết bị/link WAN; trường mua sắm/hỗ trợ của thiết bị trỏ tới nhà cung cấp/hợp đồng. *(đổi tên từ "Đối tác & hợp đồng" — ADR-031)*
- [ ] **P2-05 Cảnh báo hết hạn**: cấu hình SMTP theo tổ chức; quy tắc 90/60/30/7 ngày cho bảo hành, license, EoL, cloud, hợp đồng, credential; thông báo trong app + email.
- [ ] **P2-06 Link chia sẻ chỉ xem**: token có hạn, mật khẩu tùy chọn, ẩn IP tùy chọn, thu hồi; trang xem công khai không lộ dữ liệu khác.
- [ ] **P2-07 SSO OIDC**: Entra ID / Google Workspace / Keycloak; ánh xạ nhóm → vai trò.
- [ ] **P2-08 Multi-page, layer L1/L2/L3, segment (bus)**, off-page connector.
- [ ] **P2-09 IPAM đầy đủ**: import subnet/dải từ Excel, bảng IP plan đặt lên sơ đồ, rule chồng lấn và IP tĩnh trong DHCP.
- [ ] **P2-10 Validation Phase 2** theo SRS §7.
- [ ] **P2-11 Báo cáo & export**: PDF A4/A3 có title block; Excel IP plan, port map, BOQ, VLAN; báo cáo hết hạn, thiếu thông tin.
- [ ] **P2-12 Model library theo hãng**.
- [ ] **P2-13 Vận hành**: script backup/khôi phục, hướng dẫn giữ master key, tài liệu cài đặt/nâng cấp.
- [ ] **P2-14 Gate Enterprise**: review bảo mật kho mật khẩu & phân quyền; kiểm thử xâm nhập cơ bản.
- [ ] **P2-21 Sơ đồ nhiều cấp**: sơ đồ tổng quan tổ chức/đơn vị, node site double-click mở sơ đồ chi tiết, tự sinh bố cục hình sao từ dữ liệu.
- [ ] **P2-22 Ngày End-of-Life trong model library**: model library lưu End-of-Sale/End-of-Support; tự điền cho thiết bị; báo cáo thiết bị hết hỗ trợ.

## Phase 3 — Giám sát SNMP

- [ ] **P3-01 snmpsim** trong Compose dev với dữ liệu mẫu (2–3 switch/router/firewall).
- [ ] **P3-02 SNMP profile** v2c/v3 lưu trong kho mật khẩu.
- [ ] **P3-03 Gắn thiết bị**: bật giám sát, poll_address, Test SNMP, map ifIndex (gồm interface ảo), đối chiếu S/N qua ENTITY-MIB.
- [ ] **P3-04 Poller**: worker pool, chu kỳ theo tổ chức, timeout/retry, giới hạn đồng thời. Done khi: 200 thiết bị giả lập < 1 chu kỳ, không rò goroutine.
- [ ] **P3-05 Lưu trạng thái**: device_status, interface_status, interface_metrics (7 ngày, job dọn).
- [ ] **P3-06 Phụ thuộc theo site**: depends_on_device_id → "unknown".
- [ ] **P3-07 ARP & bảng MAC**: ghép IP–MAC–cổng; panel IP thực tế vs khai báo; thêm vào nhóm từ IP phát hiện.
- [ ] **P3-08 SSE & UI live**: Design ↔ Live, màu link, utilization, unreachable, last seen, dashboard thiết bị down.
- [ ] **P3-09 LLDP**: đề xuất link chưa vẽ, cảnh báo sai cổng.

## Phase 4 — Mở rộng (chưa lên lịch)

- [ ] Backup cấu hình qua SSH (chỉ lệnh show), so sánh thay đổi giữa các lần
- [ ] Remote poller `ntb agent` (token, đẩy kết quả qua HTTPS)
- [ ] Đọc bí mật trực tiếp từ HashiCorp Vault
- [ ] Cộng tác realtime (ADR-009)
- [ ] API token công khai cho hệ thống khác
- [ ] Import draw.io; Design Document tổng hợp; desktop app (Tauri)
