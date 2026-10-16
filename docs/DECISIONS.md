# Quyết định kiến trúc (ADR)

Bản hợp nhất 2026-10-16 (gom các ADR đã chốt, đánh số lại liên tục; lịch sử cũ xem git).
Quy ước: thêm ADR mới ở cuối; không sửa nội dung ADR cũ, đổi ý thì viết ADR mới "Thay thế ADR-xxx".

---

### ADR-001 — Self-hosted
- **Quyết định:** triển khai bằng Docker Compose trên server của người dùng. Không phụ thuộc dịch vụ cloud bên ngoài, không telemetry.
- **Lý do:** dữ liệu hạ tầng và mật khẩu thiết bị cực kỳ nhạy cảm; cần chạy trong mạng nội bộ để poll thiết bị.

### ADR-002 — React + TypeScript + shadcn/ui
- **Quyết định:** React, TypeScript strict, shadcn/ui + Tailwind. Không dùng Vue / Ant Design. (Phiên bản React: xem ADR-010.)
- **Lý do:** hệ sinh thái diagram mạnh nhất; shadcn/ui copy code vào dự án, kiểm soát hoàn toàn giao diện và Dark Mode.

### ADR-003 — Canvas dùng React Flow
- **Quyết định:** @xyflow/react.
- **Xem lại khi:** benchmark không đạt 2.000 node/trang → cân nhắc Konva/PixiJS.

### ADR-004 — Backend Go (chi, pgx, sqlc)
- **Quyết định:** Go, router chi, pgx v5 + sqlc, golang-migrate.
- **Lý do:** poll SNMP song song (goroutine, gosnmp); 1 binary nhỏ, ít RAM, dễ self-host.

### ADR-005 — PostgreSQL thuần, không Supabase
- **Quyết định:** Postgres 16 trong Compose; auth và API tự viết.

### ADR-006 — JSON Schema cho file dự án *(phần hợp đồng API được thay bởi ADR-017)*
- **Quyết định ban đầu:** `schema/ntb.schema.json` là hợp đồng chung FE ↔ BE.
- **Hiện tại:** chỉ còn là định dạng file export/import `.ntb.json`.

### ADR-007 — MVP chỉ frontend *(đã thay bởi ADR-015)*

### ADR-008 — SNMP chỉ đọc, đẩy live bằng SSE
- **Quyết định:** chỉ GET/WALK/BULKWALK, không SET; ưu tiên SNMPv3; poller chạy cùng binary API; đẩy trạng thái bằng Server-Sent Events.
- **Lưu ý:** container backend phải route tới mạng quản trị thiết bị.

### ADR-009 — Hoãn cộng tác realtime
- **Quyết định:** chưa làm ở Phase 1–3; dùng optimistic lock khi lưu. Khi làm: cân nhắc Yjs + sidecar y-websocket.

### ADR-010 — React 19
- **Quyết định:** dùng React 19. Chưa bật React Compiler; xem lại sau benchmark editor.

### ADR-011 — Giám sát là tùy chọn theo thiết bị; nhiều site qua VPN
- **Quyết định:** sơ đồ/kho là nguồn chính; SNMP chỉ bổ sung trạng thái khi bật `monitoring_enabled`.
  Poller trung tâm đi tới các site qua VPN. Thiết bị có `depends_on_device_id` (thường là gateway đầu VPN của site):
  cha unreachable → con hiển thị "unknown". Có sẵn `poller_id` (mặc định "central"); remote poller (`ntb agent`) ở Phase 4.

### ADR-012 — Interface ảo; IP quản trị gắn với interface
- **Quyết định:** interface có `kind`: physical | svi | loopback | tunnel | subinterface | lag. Template chỉ sinh physical.
  Interface ảo không làm đầu mút link vật lý; tunnel làm đầu mút link logical (VPN/GRE).
  Device có `mgmt_interface_id`; IP quản trị = IP chính của interface đó (suy ra, không nhập tay).
  IP không cấu hình trên thiết bị (NAT/public) lưu với role nat|public. `poll_address` = địa chỉ poller dùng, null = IP quản trị.
- **Lý do:** switch Cisco quản trị qua SVI, router qua Loopback, FortiGate qua cổng mgmt/VLAN/tunnel.

### ADR-013 — Hỗ trợ sơ đồ mức logic
- **Quyết định:** link có thể chưa gán cổng (interface null); node `endpoint_group` (nhóm thiết bị đầu cuối ×N);
  node `segment` (bus L2); device `managed=false` cho thiết bị bên ngoài (không validate sâu, không poll);
  annotation (text màu, mũi tên) và style label trong dữ liệu view.
- **Lý do:** bản vẽ thực tế thường ở mức logic (vd sơ đồ văn phòng Daewoo De-Heim).

### ADR-014 — Ba cấp địa chỉ IP: quy hoạch, khai báo, thực tế
- **Quyết định:** quy hoạch = `ip_ranges` trong subnet (dhcp|static|reserved, purpose, vlan); khai báo = IP của interface
  và thành viên `endpoint_members`; thực tế (Phase 3) = ARP của gateway + bảng MAC của switch qua SNMP.
  Mức sử dụng dải là giá trị tính toán. Switch hiển thị dải/VLAN nó phục vụ, suy ra từ link.

### ADR-015 — Backend và database ngay từ MVP; database là nguồn sự thật *(thay thế ADR-007)*
- **Quyết định:** Phase 1 đã có Go API + Postgres + đăng nhập. Dữ liệu mạng (thiết bị, interface, IP, link, subnet…)
  lưu dạng quan hệ trong Postgres và tồn tại độc lập với sơ đồ. Sơ đồ (`diagrams`) chỉ lưu dữ liệu hiển thị
  (vị trí node, đường dây, chú thích) dạng JSONB, tham chiếu tới thực thể trong kho. Một thiết bị có thể nằm trên nhiều sơ đồ
  hoặc không nằm trên sơ đồ nào. File `.ntb.json` chỉ dùng export/import. IndexedDB chỉ giữ bản nháp chưa gửi.
- **Lý do:** cần kho thiết bị độc lập, nhiều người dùng, phân quyền và lưu mật khẩu an toàn — không làm được trong trình duyệt.
- **Đánh đổi:** MVP dài hơn; app không còn chạy offline thuần trình duyệt.

### ADR-016 — Đa tổ chức (internal + MSP)
- **Quyết định:** thực thể `organizations`. Dùng nội bộ = 1 tổ chức; nhà tích hợp = nhiều tổ chức khách hàng.
  User có membership ở một hoặc nhiều tổ chức, mỗi membership một vai trò. Mọi bảng nghiệp vụ có `organization_id`;
  backend luôn lọc theo tổ chức lấy từ session/route; test bắt buộc chống truy cập chéo. Có `system_admin` quản trị toàn hệ thống.
  Postgres Row-Level Security cân nhắc thêm ở Phase 2 như lớp phòng thủ thứ hai.
- **Lý do:** người dùng cần cả hai mô hình; tách dữ liệu khách hàng là yêu cầu bắt buộc với MSP.

### ADR-017 — OpenAPI là hợp đồng FE ↔ BE *(thay thế phần hợp đồng API của ADR-006)*
- **Quyết định:** `api/openapi.yaml` (OpenAPI 3.1) là nguồn duy nhất. Go sinh types/interface bằng oapi-codegen;
  frontend sinh types + client bằng openapi-typescript/openapi-fetch; dữ liệu server quản lý bằng TanStack Query.
- **Lý do:** API giờ là REST nhiều tài nguyên, không còn là một file JSON duy nhất.

### ADR-018 — Kho mật khẩu: lưu mã hóa trong app hoặc tham chiếu kho ngoài
- **Quyết định:** bảng `credentials` hỗ trợ hai kiểu lưu:
  (1) **local** — mã hóa envelope: mỗi bí mật có data key riêng (AES-256-GCM), data key được mã hóa bằng master key từ env `NTB_MASTER_KEY`;
  hỗ trợ xoay master key.
  (2) **external** — chỉ lưu tham chiếu (provider: bitwarden/vaultwarden, hashicorp_vault, other; item ID/path; URL mở nhanh).
  Phase 2 chỉ hiển thị liên kết mở kho ngoài; đọc trực tiếp qua API của HashiCorp Vault để giai đoạn sau.
  Xem/copy bí mật cần quyền `credential.reveal` + xác thực MFA trong 5 phút gần nhất; mỗi lần đều ghi audit; clipboard tự xóa sau 30 giây.
  Bí mật không bao giờ có trong API danh sách, export, log. Tài khoản cloud (FortiCloud, Omada, UniFi, Meraki…) dùng chung cơ chế này.
- **Lý do:** kho mật khẩu là mục tiêu tấn công số một; doanh nghiệp lớn thường bắt buộc dùng kho riêng có sẵn.
- **Thời điểm:** Phase 2, sau khi RBAC, audit log và MFA đã hoàn chỉnh.

### ADR-019 — Xác thực và phân quyền
- **Quyết định:** đăng nhập email/password (argon2id), session cookie HttpOnly + SameSite lưu Postgres, TOTP MFA (bắt buộc với người có quyền xem mật khẩu và quản trị).
  Vai trò theo tổ chức: owner, admin, editor, viewer; quyền bổ sung: `credential.reveal`, `credential.manage`, `user.manage`.
  Giới hạn phạm vi theo site (tùy chọn). Link chia sẻ chỉ xem sơ đồ: token có hạn, tùy chọn ẩn IP, không bao giờ chứa mật khẩu.
  SSO qua OIDC (Azure AD/Entra ID, Google Workspace, Keycloak) ở Phase 2; LDAP để sau.

### ADR-020 — Khung giao diện: menu module + không gian vẽ riêng
- **Quyết định:** menu trái là điều hướng module (Dashboard, Sơ đồ, Thiết bị, IPAM, Sites, Đối tác, Kho mật khẩu & Cloud,
  Giám sát, Báo cáo, Quản trị), kèm bộ chọn tổ chức và tìm kiếm toàn cục (Ctrl+K).
  Màn hình vẽ thu gọn menu trái; công cụ ở thanh nổi phía trên (kiểu Photoshop); thư viện thiết bị là panel nổi kéo được
  (có tab "thiết bị trong kho chưa vẽ") và thêm nhanh bằng tìm kiếm (phím `/`); panel thuộc tính bên phải; panel Problems phía dưới.
- **Lý do:** app nhiều module; vẽ cần tối đa diện tích canvas; 40+ loại thiết bị không vừa một thanh công cụ.

### ADR-021 — Linter frontend dùng oxlint; cổng web mặc định 8068
- **Quyết định:** frontend lint bằng oxlint (thay ESLint ghi trong PLAN), kèm Prettier. Cổng web mặc định trong Compose là 8068 (đổi qua `WEB_PORT`).
- **Lý do:** oxlint đã chạy ổn trong repo, nhanh hơn ESLint nhiều lần, đủ rule cho React/TS; cổng 8080 trùng dịch vụ khác trên máy phát triển.
- **Chốt:** người dùng xác nhận 2026-10-16.

### ADR-022 — Xóa mềm cho user và tổ chức; thêm golang.org/x/term
- **Quyết định:** user và tổ chức không bị xóa cứng khi đã có dữ liệu liên quan (audit, …). Ứng dụng xóa mềm:
  user qua `disabled_at`, tổ chức qua `deleted_at`. Khóa ngoại từ `audit_log` tới `users`/`organizations` là `ON DELETE RESTRICT`
  (xóa cứng bản ghi đã có audit sẽ bị chặn với lỗi rõ ràng); xóa cứng chỉ thành công khi không còn dữ liệu nào tham chiếu.
  Thêm `golang.org/x/term` vào Stack backend để ẩn mật khẩu khi gõ ở CLI (`ntb admin create`).
- **Lý do:** audit log phải giữ nguyên tối thiểu 1 năm (SRS §10) và append-only; FK `ON DELETE SET NULL` cũ mâu thuẫn với trigger
  chặn UPDATE nên xóa user/tổ chức báo lỗi khó hiểu. Mật khẩu gõ tay không được hiện trên màn hình.
- **Chốt:** người dùng xác nhận 2026-10-16.

### ADR-023 — Tổ chức xác định theo đường dẫn; system admin không mặc nhiên đọc dữ liệu tổ chức
- **Quyết định:** API nghiệp vụ nằm dưới `/api/orgs/{orgId}/…`, URL web dưới `/o/{orgId}/…`. Middleware tenant đọc `orgId` từ đường dẫn,
  kiểm tra membership của user trong session ở MỌI request; không phải thành viên (hoặc tổ chức đã xóa mềm) → 404, không lộ tổ chức có tồn tại.
  Handler chỉ lấy tổ chức từ context do middleware đặt, không từ body. Session chỉ lưu "tổ chức dùng gần nhất" để mở mặc định.
  System admin quản lý danh sách tổ chức (`/api/admin/organizations`: tạo, liệt kê, xóa mềm) nhưng chỉ đọc/sửa dữ liệu một tổ chức khi là thành viên.
- **Lý do:** nhân viên MSP mở nhiều tab cho nhiều khách hàng cùng lúc mà không lẫn dữ liệu; link chia sẻ trỏ đúng tổ chức;
  một tài khoản quản trị bị lộ không tự động lộ dữ liệu mọi khách hàng; mọi truy cập đi qua membership nên truy vết được.
- **Chốt:** người dùng xác nhận 2026-10-16.

### ADR-024 — Hệ thống thiết kế giao diện (NMS)
- **Quyết định:** giao diện theo `docs/DESIGN.md`: AppShell sidebar thu gọn (tự thu thành icon khi < 1440px); topbar luôn hiện
  tổ chức hiện tại kèm avatar chữ viết tắt + màu cố định; khu vực Hệ thống có dải màu riêng; bảng là thành phần chính
  (cuộn ngang trong khung, ghim cột chọn + hostname); token màu riêng (accent aqua OM3, nền NOC tối) cho Light/Dark;
  màu trạng thái cố định + icon + chữ; IBM Plex Sans/Mono đóng gói qua @fontsource (không Google Fonts), mono chỉ cho dữ liệu kỹ thuật;
  mật độ Gọn/Thoáng; xác nhận phá hủy 2 mức; `SecretField` cho bí mật; component dùng chung trong `frontend/src/components/`.
  Thêm thư viện: @tanstack/react-table, cmdk, sonner, recharts, @fontsource/ibm-plex-sans, @fontsource/ibm-plex-mono,
  @axe-core/playwright (dev); gỡ @fontsource-variable/geist. react-i18next/i18next (đã có trong Stack) cài từ bước này.
  API thêm `Health.environment` (env `NTB_ENV`) và `AuthSession.expiresAt` để hiện badge môi trường và cảnh báo hết phiên.
- **Lý do:** người dùng là kỹ sư mạng cần mật độ thông tin cao, quét trạng thái nhanh; nhân viên MSP làm nhiều tổ chức cùng lúc
  phải luôn biết đang ở tổ chức nào; app chạy trong mạng không Internet.
- **Ràng buộc:** mọi trang mới dùng component dùng chung; không màu/kích thước viết cứng ngoài token; đạt WCAG AA; nhãn qua i18n.
- **Chốt:** người dùng xác nhận 2026-10-16 (kèm 10 chỉnh sửa ghi trong DESIGN.md §8b, đánh dấu ✎).

### ADR-025 — Site, location, rack; phạm vi site của thành viên; sơ đồ thuộc đúng một site
- **Quyết định:**
  - Phân cấp: tổ chức (khách hàng / nội bộ) → nhiều **site** → cây **location** (tòa nhà → tầng → phòng; tầng/phòng có thể
    nằm thẳng dưới site cho site nhỏ) → **rack** (thuộc một location, 1–60U, mặc định 42U). Mỗi site có nhiều thiết bị (P1-08)
    và nhiều sơ đồ (P1-13). Mã site duy nhất trong tổ chức; tên location duy nhất giữa các nút anh em.
  - **Mỗi sơ đồ thuộc đúng một site** (`diagrams.site_id`). Sơ đồ WAN/VPN đặt ở site chính (thường là HQ / đầu VPN); thiết bị
    của site khác vẫn đặt lên được vì một thiết bị có thể nằm trên nhiều sơ đồ. (Thay câu "hoặc nhiều site" trong SRS §6.1.)
  - `memberships.site_scope`: NULL = mọi site; có giá trị = chỉ các site đó. Chỉ áp dụng cho editor/viewer — owner/admin luôn
    thấy toàn tổ chức. Site ngoài phạm vi trả 404 (như chéo tổ chức). Thành viên bị giới hạn không tạo được site mới.
    Thiết bị/sơ đồ (P1-08, P1-13) dùng lại cùng phạm vi.
  - Xóa site = **xóa mềm** (`deleted_at`), chỉ owner/admin, xác nhận gõ lại tên; dữ liệu và audit giữ nguyên.
    Location chỉ xóa được khi không còn nút con/rack; rack chỉ xóa được khi trống (từ P1-08: không còn thiết bị).
- **Lý do:** MSP quản lý nhiều khách hàng, mỗi khách hàng nhiều chi nhánh; kỹ sư hiện trường chỉ cần (và chỉ nên) thấy site
  mình phụ trách; cây location chuẩn hóa thay ô gõ tự do (SRS §3); sơ đồ một site giữ phân quyền theo site đơn giản.
- **Chốt:** người dùng xác nhận 2026-10-16.

### ADR-026 — Cấp Đơn vị giữa Tổ chức và Site
- **Quyết định:** phân cấp: Tổ chức → Đơn vị (business unit) → Site → Location → Rack → Thiết bị.
  Tổ chức = bên ký hợp đồng với đơn vị vận hành (vd CJ). Đơn vị = công ty con / đối tác / khách hàng của tổ chức (vd CJ Foodville).
  Site = địa điểm vật lý có địa chỉ, có `kind`: office | factory | datacenter | warehouse | store | other.
  Site có `business_unit_id` hoặc null (= site dùng chung của tổ chức, vd IDC). Thiết bị có `business_unit_id` riêng
  (mặc định lấy theo site; bắt buộc chọn khi site dùng chung). Location (tòa/tầng/phòng) và Rack không bắt buộc.
  Phân quyền: membership có thể giới hạn theo danh sách đơn vị và/hoặc site.
- **Lý do:** Excel thực tế của khách dùng "Site" = công ty và "Location" = địa điểm; một công ty có nhiều địa điểm và một địa điểm
  (IDC) có thể phục vụ nhiều công ty — phải tách thành hai cấp.

### ADR-027 — Cụm thiết bị (HA, stack)
- **Quyết định:** bảng `device_clusters`: kind (ha_active_passive | ha_active_active | stack | vpc | vss | other), tên, hostname cụm (tùy chọn),
  IP quản trị cụm (gắn interface ảo của cụm hoặc IP riêng). Thiết bị thành viên giữ S/N, part number, bảo hành riêng; có
  `cluster_id`, `cluster_role` (primary | secondary | member), `cluster_member_no`.
  Validation: IP trùng và hostname trùng được bỏ qua khi các thiết bị cùng một cụm. Trên sơ đồ, cụm hiển thị gộp thành 1 node
  (badge "HA" / "Stack ×3") hoặc mở rộng từng thành viên.
- **Lý do:** cặp FortiGate HA dùng chung IP quản trị; switch stack nhiều S/N chung một hostname/IP.

### ADR-028 — Sơ đồ nhiều cấp và đi sâu (drill-down)
- **Quyết định:** sơ đồ thuộc tổ chức, có `scope`: organization | business_unit | site (kèm id tương ứng). Ba loại:
  tổng quan tổ chức (trung tâm + đơn vị + WAN/VPN), tổng quan đơn vị (các site dạng khối nối về trung tâm), chi tiết site (LAN).
  Node "site" trên sơ đồ tổng quan: double-click mở sơ đồ chi tiết của site đó. Sơ đồ tổng quan có thể tự sinh từ dữ liệu
  (sites + link WAN/VPN), người dùng chỉnh bố cục sau. Một site có thể có nhiều sơ đồ chi tiết (vật lý, L2, L3).
- **Lý do:** khách nhiều đơn vị × nhiều site; một sơ đồ cho cả đơn vị sẽ quá rối, kỹ sư cần nhìn tổng quan rồi đi sâu.
