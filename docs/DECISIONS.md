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
- **Chi tiết triển khai (P1-10/P1-11, người dùng đồng ý 2026-10-16):** dải IP **không có trường VLAN riêng** — dùng VLAN của
  subnet chứa nó (một subnet chạy trên đúng một VLAN, trường riêng chỉ tạo dữ liệu mâu thuẫn). "Đang dùng" = view
  `ipam_addresses`: IP interface thiết bị + IP quản trị cụm + IP thành viên nhóm đầu cuối (VRF của subnet chứa dải của nhóm).
- **Chỗ thao tác (người dùng chốt 2026-10-16):** VLAN/subnet/dải là dữ liệu chung của tổ chức (một VLAN dùng cho nhiều sơ đồ, màu
  chung). Menu **IPAM** giữ để tra cứu nhanh (IP thuộc ai, IP trống, mức sử dụng); **panel thuộc tính trên sơ đồ** cũng tạo/gán
  VLAN, subnet, IP tại chỗ (P1-18) — cùng ghi vào IPAM chung, không có bản riêng theo sơ đồ.

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
*(Thay đổi sau: phạm vi site của thành viên và "sơ đồ thuộc một site" bỏ hẳn — ADR-032.)*
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
- **Thay đổi sau:** ý "mỗi sơ đồ thuộc đúng một site" được thay bởi ADR-028 (sơ đồ có phạm vi tổ chức/đơn vị/site);
  `site_scope` được thay bởi giao quyền theo đơn vị + chia sẻ bản ghi (ADR-029).
- **Lý do:** MSP quản lý nhiều khách hàng, mỗi khách hàng nhiều chi nhánh; kỹ sư hiện trường chỉ cần (và chỉ nên) thấy site
  mình phụ trách; cây location chuẩn hóa thay ô gõ tự do (SRS §3); sơ đồ một site giữ phân quyền theo site đơn giản.
- **Chốt:** người dùng xác nhận 2026-10-16.

### ADR-026 — Cấp Đơn vị giữa Tổ chức và Site
*(Thay bởi ADR-032: cây Danh mục thay cho Đơn vị; bỏ site dùng chung.)*
- **Quyết định:** phân cấp: Tổ chức → Đơn vị (business unit) → Site → Location → Rack → Thiết bị.
  Tổ chức = bên ký hợp đồng với đơn vị vận hành (vd CJ). Đơn vị = công ty con / đối tác / khách hàng của tổ chức (vd CJ Foodville).
  Site = địa điểm vật lý có địa chỉ, có `kind`: office | factory | datacenter | warehouse | store | other.
  Site có `business_unit_id` hoặc null (= site dùng chung của tổ chức, vd IDC). Thiết bị có `business_unit_id` riêng
  (mặc định lấy theo site; bắt buộc chọn khi site dùng chung). Location (tòa/tầng/phòng) và Rack không bắt buộc.
  Phân quyền: membership có thể giới hạn theo danh sách đơn vị và/hoặc site.
  *(Chi tiết phân quyền: ADR-029 — theo đơn vị + chia sẻ bản ghi, không giới hạn theo site.)*
  *(Thay đổi sau: thêm cấp Đối tác giữa Tổ chức và Đơn vị — ADR-031.)*
- **Lý do:** Excel thực tế của khách dùng "Site" = công ty và "Location" = địa điểm; một công ty có nhiều địa điểm và một địa điểm
  (IDC) có thể phục vụ nhiều công ty — phải tách thành hai cấp.

### ADR-027 — Cụm thiết bị (HA, stack)
- **Quyết định:** bảng `device_clusters`: kind (ha_active_passive | ha_active_active | stack | vpc | vss | other), tên, hostname cụm (tùy chọn),
  IP quản trị cụm (gắn interface ảo của cụm hoặc IP riêng). Thiết bị thành viên giữ S/N, part number, bảo hành riêng; có
  `cluster_id`, `cluster_role` (primary | secondary | member), `cluster_member_no`.
  Validation: IP trùng và hostname trùng được bỏ qua khi các thiết bị cùng một cụm. Trên sơ đồ, cụm hiển thị gộp thành 1 node
  (badge "HA" / "Stack ×3") hoặc mở rộng từng thành viên.
- **Lý do:** cặp FortiGate HA dùng chung IP quản trị; switch stack nhiều S/N chung một hostname/IP.
- **Chi tiết triển khai (P1-09b, 2026-10-16):** cụm thuộc một site và một đơn vị; thành viên phải cùng site và đơn vị với cụm.
  Hostname duy nhất trong tổ chức **trừ các thành viên cùng một cụm** — không biểu diễn được bằng unique index nên API kiểm tra
  dưới khóa transaction theo hostname (`pg_advisory_xact_lock`). Rời cụm khi đang trùng hostname với thành viên khác → phải đổi
  hostname trước; xóa cụm chỉ khi không còn thành viên. IP quản trị cụm lưu trực tiếp trên cụm (CIDR); "interface ảo của cụm"
  để sau nếu cần. Hiển thị gộp trên sơ đồ làm cùng editor (P1-14+); bỏ qua IP trùng trong cụm làm ở rule validation (P1-20).
- **Quy định loại thiết bị (người dùng chốt 2026-10-16):** cụm **không bắt buộc**. Kiểu cụm chỉ nhận loại thiết bị phù hợp —
  HA (active-passive/active-active): firewall, router, VPN gateway, load balancer, wireless controller, WAF, proxy, IDS/IPS,
  SD-WAN edge, server, NAS; Stack: switch L2/L3/PoE; vPC/VSS: switch L2/L3; "Khác": mọi loại (trường hợp đặc biệt).
  Thành viên một cụm phải **cùng loại** (lỗi). Khác model/firmware chỉ **cảnh báo** (rule P1-20). Đổi kiểu cụm khi có thành
  viên không hợp → từ chối.

### ADR-028 — Sơ đồ nhiều cấp và đi sâu (drill-down)
*(Thay một phần bởi ADR-032: sơ đồ thuộc tổ chức, không có phạm vi; nhóm thiết bị theo site/location bằng khung trên sơ đồ.)*
- **Quyết định:** sơ đồ thuộc tổ chức, có `scope`: organization | business_unit | site (kèm id tương ứng). Ba loại:
  tổng quan tổ chức (trung tâm + đơn vị + WAN/VPN), tổng quan đơn vị (các site dạng khối nối về trung tâm), chi tiết site (LAN).
  Node "site" trên sơ đồ tổng quan: double-click mở sơ đồ chi tiết của site đó. Sơ đồ tổng quan có thể tự sinh từ dữ liệu
  (sites + link WAN/VPN), người dùng chỉnh bố cục sau. Một site có thể có nhiều sơ đồ chi tiết (vật lý, L2, L3).
- **Lý do:** khách nhiều đơn vị × nhiều site; một sơ đồ cho cả đơn vị sẽ quá rối, kỹ sư cần nhìn tổng quan rồi đi sâu.
- **Chi tiết triển khai (P1-13):** quyền sơ đồ theo phạm vi — tổ chức: vai trò cấp tổ chức; đơn vị: quyền trên đơn vị; site:
  quyền trên site (gồm chia sẻ). Node trỏ tới đối tượng người xem không thấy được trả về dạng "hidden ref" (chỉ id) và phải giữ
  nguyên khi lưu; không thêm được ref mới tới đối tượng không thấy. Link trong kho giữa hai đối tượng đang có trên sơ đồ luôn
  được vẽ (kho là nguồn sự thật); view chỉ lưu đường đi của cạnh. Lưu = một request (view + thay đổi kho), một transaction,
  khóa lạc quan theo version; sau khi lưu lịch sử undo bắt đầu lại (temp id thành id thật).

### ADR-029 — Phân quyền theo đơn vị và chia sẻ bản ghi (động, không cố định trong code)
*(Thay bởi ADR-032: quyền chỉ theo vai trò trong tổ chức; bỏ giao quyền theo đơn vị và chia sẻ bản ghi.)*
- **Quyết định:**
  - **Giao quyền theo đơn vị:** bảng `business_unit_members` (business_unit_id, user_id, role: `bu_admin` | `editor` | `viewer`).
    Một user có thể được giao nhiều đơn vị → thấy hợp của tất cả. Vai trò cấp tổ chức (owner/admin/editor/viewer) vẫn giữ:
    owner/admin tổ chức thấy mọi đơn vị. User chỉ có quyền đơn vị (không vai trò tổ chức) chỉ thấy đơn vị được giao.
  - **bu_admin** quản lý user của đơn vị mình: mời email mới hoặc user đã có, đặt vai trò trong đơn vị, gỡ; không đụng được
    đơn vị khác hay vai trò cấp tổ chức. Người được mời vào tổ chức chỉ với quyền trong đơn vị.
  - **Chia sẻ bản ghi:** bảng chung `resource_shares` (resource_type, resource_id, business_unit_id, access: `view` | `edit`,
    granted_by, granted_at). Áp cho **site** trước: site share cho đơn vị X → user của X thấy mọi thứ trong site (location,
    rack, thiết bị, sơ đồ của site) với quyền xem/sửa theo share. Site của tổ chức (dùng chung, vd IDC) chỉ hiện với đơn vị
    được share. Người cấp share: owner/admin tổ chức (bản ghi của tổ chức), bu_admin (bản ghi của đơn vị mình). Sơ đồ tổng quan,
    thiết bị lẻ dùng cùng bảng ở task sau.
  - **Bộ chọn đơn vị** trên topbar (sau tên tổ chức): "Tất cả đơn vị của tôi" hoặc một đơn vị; chỉ là bộ lọc hiển thị —
    quyền luôn kiểm ở server theo giao quyền + share; bản ghi ngoài quyền → 404.
  - Mọi cấp quyền, share, thu hồi đều ghi audit.
  - **Thay `site_scope`** của ADR-025: bỏ cột `memberships.site_scope` và phần API/giao diện tương ứng.
- **Thay đổi sau:** giao quyền theo đối tác hoặc đơn vị, partner_admin/unit_admin, share cho đối tác hoặc đơn vị — ADR-031.
- **Lý do:** đối tác/khách hàng của tổ chức tự quản người dùng của mình; tài nguyên dùng chung (IDC, cặp FortiGate trung tâm)
  phải hiện đúng cho những bên được chia sẻ, cấu hình được theo từng bản ghi thay vì quy tắc cố định.
- **Chốt:** người dùng xác nhận 2026-10-16.

### ADR-030 — Quy tắc đặt mã đơn vị và site
*(Thay bởi ADR-032: mã site tự sinh theo đường đi trên cây Danh mục.)*
- **Quyết định:** quy tắc **bắt buộc** (server từ chối mã sai), form **tự gợi ý** mã đúng quy tắc, người dùng sửa được trong khuôn khổ.
  - Mã đơn vị: 2–8 ký tự `A–Z`, `0–9`, bắt đầu bằng chữ, lưu chữ hoa, duy nhất trong tổ chức. Vd `FOOD`, `AGRI`, `VPM`.
  - Mã site: `<MÃ ĐƠN VỊ>-<mã địa điểm><STT 2 chữ số>`; mã địa điểm 2–4 chữ cái (gợi ý từ tỉnh/thành: Hưng Yên → `HY`,
    Hà Nội → `HN`, TP.HCM → `HCM`). Vd `AGRI-BD01`, `FOOD-HN01`. Site của tổ chức (dùng chung): tiền tố `SHARED-`, vd `SHARED-HCM01`.
    Duy nhất trong tổ chức. Đổi site sang đơn vị khác → phải đổi mã (hệ thống gợi ý mã mới).
- **Thay đổi sau:** tiền tố mã site là mã **đối tác**; mã đơn vị duy nhất trong đối tác — ADR-031.
- **Lý do:** nhìn mã biết ngay đơn vị và địa điểm; tránh trùng giữa các đơn vị cùng tỉnh; khớp cách khách đặt hostname.
- **Chốt:** người dùng xác nhận 2026-10-16.

### ADR-031 — Ba cấp Tổ chức → Đối tác → Đơn vị; phân quyền theo đối tác hoặc đơn vị
*(Thay bởi ADR-032: cây Danh mục nhiều cấp thay Đối tác → Đơn vị; quyền chỉ theo tổ chức.)*
- **Quyết định:**
  - Phân cấp: Tổ chức (khách hàng của bên vận hành, vd CJ) → **Đối tác** (vd CJ Foodville, CJ Agri Deheus) → **Đơn vị**
    (vd Deheus nhà máy, Deheus văn phòng) → Site → Location → Rack → Thiết bị. **Mọi đơn vị bắt buộc thuộc một đối tác**
    (đối tác chỉ có một đơn vị vẫn được). "Quan hệ với tổ chức" (công ty con / đối tác / khách hàng) chuyển lên cấp đối tác.
    Site thuộc một đơn vị, hoặc là site dùng chung của tổ chức (không đơn vị).
  - **Mã:** mã đối tác theo quy tắc mã đơn vị cũ của ADR-030 (2–8 ký tự `A–Z0–9`, bắt đầu bằng chữ, duy nhất trong tổ chức,
    cấm `SHARED`). Mã đơn vị 2–8 ký tự cùng quy tắc, **duy nhất trong đối tác**, hiển thị kèm đối tác (`AGRI / NM`).
    **Mã site = `<MÃ ĐỐI TÁC>-<địa điểm><NN>`** (vd `AGRI-BD01`; site dùng chung `SHARED-…`). Chuyển site giữa các đơn vị cùng
    đối tác không đổi mã; sang đối tác khác thì đổi mã; đổi mã đối tác đổi tiền tố mọi site của đối tác.
  - **Giao quyền hai cấp:** `partner_members` (partner_admin | editor | viewer) — có hiệu lực với mọi đơn vị của đối tác, kể cả
    đơn vị tạo sau; `business_unit_members` (unit_admin | editor | viewer) — chỉ đơn vị đó. User thấy **hợp** của mọi cấp được giao.
    Vai trò cấp tổ chức (owner/admin/editor/viewer) giữ nguyên: owner/admin tổ chức thấy mọi đối tác.
  - **partner_admin:** mời user (email mới hoặc có sẵn) và cấp quyền ở cấp đối tác hoặc từng đơn vị con; tạo/sửa đơn vị và site
    của đối tác; share site của đối tác. **unit_admin:** tương tự trong phạm vi một đơn vị. Không ai trong số này đụng được đối
    tác khác hay cài đặt tổ chức.
  - **Chia sẻ:** `resource_shares` (ADR-029) có đích là **đối tác hoặc đơn vị** (`target_type`): share site dùng chung cho đối tác →
    mọi đơn vị của đối tác thấy; share cho một đơn vị → chỉ đơn vị đó.
  - **Bộ chọn trên topbar:** "Tất cả" / một đối tác / một đơn vị (chỉ là bộ lọc; quyền kiểm ở server; ngoài quyền → 404).
- **Thay thế một phần:** ADR-026 (đơn vị nằm dưới đối tác; quan hệ chuyển lên đối tác), ADR-029 (giao quyền theo đơn vị → theo
  đối tác hoặc đơn vị; bu_admin → partner_admin / unit_admin), ADR-030 (tiền tố mã site = mã đối tác; mã đơn vị duy nhất trong đối tác).
- **Đặt tên:** module Phase 2 "Đối tác & hợp đồng" (SRS §8) đổi thành **"Nhà cung cấp & hợp đồng"** (bảng `vendors`) để "Đối tác"
  chỉ còn nghĩa là cấp trong cây tổ chức. Chuyển dữ liệu P1-07: mỗi đối tác sinh một đơn vị mặc định mã `MAIN`.
- **Lý do:** một đối tác của khách hàng (vd Deheus) có nhiều công ty/bộ phận; IT của đối tác cần quản lý tất cả cùng lúc, còn
  từng bộ phận chỉ cần thấy phần của mình.
- **Chốt:** người dùng xác nhận 2026-10-16.
- **Chi tiết triển khai (P1-07c, 2026-10-16):**
  - Vai trò tổ chức mới **`member`**: thuộc tổ chức nhưng không có quyền chung — chỉ thấy theo giao quyền đối tác/đơn vị và
    share. Người được partner_admin/unit_admin mời vào nhận vai trò này; owner/admin/editor/viewer tổ chức giữ quyền toàn tổ chức
    như trước (editor tổ chức sửa mọi site nhưng không quản lý người dùng đối tác/đơn vị).
  - Mức quyền trên một đơn vị = cao nhất giữa vai trò tổ chức, quyền ở đối tác và quyền ở đơn vị (xem < sửa < admin).
    Admin (owner/admin tổ chức, partner_admin, unit_admin) mới được xóa site và quản lý share của site.
  - Share cho **xem**; share **sửa** chỉ cho người là editor trở lên ở bên nhận. Share không bao giờ cho xóa, chia sẻ lại,
    hay chuyển site sang đơn vị khác (chuyển site cần quyền sửa trực tiếp ở cả đơn vị cũ và mới).
  - partner_admin sửa được thông tin đối tác của mình, tạo/xóa đơn vị của đối tác; tạo/xóa đối tác chỉ owner/admin tổ chức.
    unit_admin sửa đơn vị và quản lý người dùng của đơn vị.
  - User `member` không xem được danh sách thành viên tổ chức (tránh lộ người dùng của đối tác khác).
  - Gỡ thành viên khỏi tổ chức xóa mọi quyền đối tác/đơn vị của người đó; thu hồi quyền cuối cùng thì vẫn là `member`
    nhưng không thấy gì.

### ADR-032 — Cây Danh mục nhiều cấp; site gắn vào bất kỳ danh mục nào; quyền chỉ theo tổ chức; sơ đồ thuộc tổ chức
- **Bối cảnh:** "Tổ chức → Đối tác → Đơn vị → Site" (ADR-031) cứng nhắc: công ty tự quản mạng nội bộ chỉ cần "Công ty → Site";
  MSP bảo trì cho khách mà khách lại bảo trì cho khách của họ cần nhiều cấp hơn. Người dùng chốt 2026-10-16.
- **Quyết định:**
  - **Danh mục** (`categories`): **một bảng cây** cha–con trong tổ chức (`parent_id` null = ngay dưới tổ chức), sâu tùy ý.
    Mỗi danh mục có **tên** tự do và **mã** (2–12 ký tự `A–Z0–9`, bắt đầu bằng chữ, duy nhất giữa các danh mục anh em),
    ghi chú, người liên hệ. Chỉ để phân chia quản lý thiết bị — không gắn quyền, không gắn sơ đồ.
  - **Site** là một địa điểm vật lý rõ ràng, thuộc đúng **một** danh mục hoặc gắn thẳng vào tổ chức (`category_id` null).
    Một danh mục có thể vừa có danh mục con vừa có site. **Bỏ khái niệm "site dùng chung"**: dùng chung là chuyện của
    thiết bị (vd firewall ở IDC phục vụ nhiều site) — thể hiện bằng link, không cần cơ chế quyền riêng.
  - **Mã site tự sinh** theo đường đi: `<MÃ TỔ CHỨC>-<mã danh mục>-…-<mã riêng của site>`, viết hoa, vd tổ chức `CJ` →
    danh mục `CJFEED` → site `HCM` = `CJ-CJFEED-HCM`. Tổ chức có thêm **mã** (bắt buộc). Site tự đặt phần cuối (`HCM`, `HCM02`…).
    Mã đầy đủ duy nhất trong tổ chức, được lưu sẵn để tìm kiếm. **Đổi mã tổ chức/danh mục, hoặc chuyển site/danh mục sang nhánh
    khác** → API trả danh sách site bị đổi mã (cũ → mới) để người dùng **xác nhận** rồi mới áp dụng; trùng mã → từ chối.
    Hostname thiết bị do người dùng đặt, không tự đổi theo.
  - **Quyền chỉ theo tổ chức:** thành viên tổ chức thấy **toàn bộ** dữ liệu của tổ chức; vai trò owner / admin / editor / viewer
    giữ nguyên (sửa / chỉ xem / quản lý người dùng). Bỏ `partner_members`, `business_unit_members`, `resource_shares`, vai trò
    `member` (member hiện có → viewer), bộ lọc hiển thị theo đối tác/đơn vị trong SQL, khái niệm "hidden ref" trên sơ đồ.
    Bộ chọn trên topbar thành **chọn một nhánh của cây Danh mục** — chỉ để lọc.
  - **Thiết bị, nhóm đầu cuối, cụm** chỉ gắn **site** (danh mục suy ra từ site); bỏ `business_unit_id`.
  - **Sơ đồ thuộc tổ chức**, không có phạm vi; đặt thiết bị của bất kỳ site nào. Người vẽ nhóm vài thiết bị thành **khung nhóm**
    gắn với một site hoặc location (vd khung "HCM" chứa 2 router + 1 switch), tên khung lấy theo site/location. Thiết bị **mới tạo**
    thả vào khung nhận site/location của khung; thiết bị đã có nằm trong khung nhưng site thật khác → **cảnh báo** (không tự sửa kho).
    Node "site" và drill-down sơ đồ tổng quan (ADR-028) không làm ở Phase 1.
  - **Chuyển dữ liệu:** mỗi đối tác → một danh mục (mã = mã đối tác); đơn vị của nó → danh mục con, trừ khi đối tác chỉ có đơn vị
    mặc định `MAIN` (gộp vào danh mục đối tác). Site dùng chung (`SHARED-…`) → gắn thẳng vào tổ chức. Mã riêng của site = mã cũ bỏ
    tiền tố đối tác (`AGRI-BD01` → `BD01`). Sơ đồ có phạm vi → sơ đồ của tổ chức.
- **Thay thế:** ADR-026, ADR-029, ADR-030, ADR-031; một phần ADR-025 và ADR-028.
- **Lý do:** mọi loại khách (công ty nội bộ, khách của MSP, khách nhiều tầng) dùng được cùng một mô hình; một khái niệm (danh mục)
  thay cho ba (đối tác, đơn vị, site dùng chung); phân quyền đơn giản.
- **Đánh đổi:** không còn giới hạn "người IT nhà máy chỉ thấy nhà máy" — nếu cần thì tách thành tổ chức riêng.

### ADR-033 — Loại thiết bị và loại dây theo thực tế mạng; hostname tự đặt; xóa khỏi kho phải xác nhận
- **Bối cảnh:** rà soát nghiệp vụ khi làm P1-15 (agent kỹ sư mạng) thấy mô hình dây lệch thực tế (DAC xếp vào quang, LAG xếp vào
  logical, MPLS là kiểu nét) và thiếu loại thiết bị/dây hay gặp. Người dùng chốt 2026-10-17.
- **Quyết định — loại thiết bị** (thêm 4): `provider_cloud` (đám mây Internet / MPLS của nhà mạng — đầu bên kia đường WAN; không
  phải tài sản: luôn `managed=false`, **không** kiểm tra trùng hostname, không chọn cổng ở đầu này), `wireless_bridge` (cầu
  Wi-Fi điểm–điểm giữa các tòa nhà/nhà xưởng), `console_server` (quản trị ngoài băng), `olt` (gom nhiều ONT qua cổng PON).
  `poe_switch` giữ lại cho dễ chọn. Mỗi loại có icon riêng (router không còn trùng hình switch). Media cổng thêm `PON`, `xDSL`,
  `Cellular`.
- **Quyết định — loại dây** (`links.kind`), rà soát nghiệp vụ lần 2 (agent kỹ sư mạng) tinh chỉnh luật cổng:

  | kind | Gồm | Đầu là nhóm đầu cuối | Cổng hợp lệ (media khai báo) | Một dây/cổng |
  | --- | --- | --- | --- | --- |
  | `ethernet` | Cat5e/6/6A, **DAC** (đồng twinax đầu SFP) | được | RJ45, họ SFP | có |
  | `fiber` | OM3/4/5, OS2, **AOC**; `fiberMode` sm/mm, `connector` LC/SC/MPO/ST | được | họ SFP, PON | có, trừ cổng PON |
  | `wireless` | Wi-Fi, cầu P2P/P2MP | được | Radio | **không** (một radio nhiều kết nối) |
  | `stack` | cáp stack, HA heartbeat | không | RJ45, họ SFP | có; hai đầu đã thuộc cụm thì phải cùng cụm |
  | `power` | UPS/PDU → thiết bị | không | chỉ ổ cắm ở đầu UPS/PDU; đầu thiết bị không chọn cổng | có |
  | `dsl` | DSL, coax | không | xDSL, RJ45 | có |
  | `cellular` | 4G/5G, vệ tinh | không | Cellular | **không** |
  | `console`, `serial` | như cũ | không | Console/Serial, RJ45 | có |
  | `logical` | VPN/IPsec, GRE | được (như trước) | interface ảo hoặc **cổng vật lý** mà VPN gắn vào (FortiGate wan1); **không LAG** | không |

  - Mọi loại: interface `lag` không nối dây trực tiếp — **LAG** = các dây vật lý giữa cổng thành viên. Media trống = chưa biết,
    luôn chấp nhận; chỉ báo lỗi 400 khi chắc chắn không cắm được. SM–MM lệch, đầu nối lệch, tốc độ lệch, QSFP→SFP breakout,
    DAC > 7 m, đồng > 100 m, serial/console vào RJ45/SFP… là **cảnh báo** của validation (P1-20).
  - **Dịch vụ WAN** (`service`): `internet_broadband` (FTTH/xDSL dùng chung), `internet_dedicated` (Internet trực tiếp, IP tĩnh,
    SLA), `mpls`, `leased_line` (kênh thuê riêng), `metro` (Metro Ethernet), `mobile` (4G/5G), `other` — cạnh nhà cung cấp,
    circuit ID, băng thông; MPLS không còn là kiểu nét.
  - Chuyển dữ liệu (migration 000021): `fiber` + medium `DAC` → `ethernet`; medium SM/MM/OMx → `fiberMode`; `logical` + medium
    `MPLS` → `service = mpls`; dây logical cũ nối interface LAG giữ nguyên nhưng sửa lại phải theo luật mới.
- **Quyết định — hostname:** người dùng **tự đặt** (ô để trống); dưới ô có **gợi ý theo đường dẫn mã site**
  (`<mã site bỏ mã tổ chức>-<loại><số>`, vd `AGRI-BD01-FW01`), bấm để dùng. Kiểm tra theo luật kho (chữ/số đầu, rồi chữ, số,
  `.`, `_`, `-`); `_`/`.` và tên Windows > 15 ký tự chỉ cảnh báo. Không làm cài đặt quy ước riêng cho tổ chức.
- **Quyết định — xóa khỏi kho** (Shift+Delete hoặc menu) luôn có **hộp xác nhận** liệt kê thiết bị và dây bị xóa theo; Delete chỉ
  gỡ khỏi sơ đồ.
- **Lý do:** sơ đồ phản ánh đúng cách kỹ sư lắp mạng (bắt lỗi cắm DAC vào cổng RJ45, SM–MM lệch, thiếu dây nguồn khi mất điện).
- **Đánh đổi:** thêm cột và luật kiểm tra; dây LAG cũ phải vẽ lại thành dây vật lý của từng cổng thành viên.

### ADR-034 — IPAM trong panel sơ đồ ghi thẳng vào IPAM (không qua lưu sơ đồ)
- **Bối cảnh:** P1-18 cho gán VLAN cho cổng, gán IP cho interface, lấy IP trống, tạo VLAN/subnet ngay trên panel của sơ đồ. Quy tắc
  editor (CLAUDE.md) là mọi thay đổi đi qua command, hoàn tác bằng Ctrl+Z và lưu cùng sơ đồ. Người dùng chốt 2026-10-17.
- **Quyết định:**
  - Thay đổi **IPAM và interface** (mode/VLAN của cổng, IP, VLAN mới, subnet mới) từ panel gọi **ngay** API REST sẵn có của kho
    (như trang thiết bị), **không** là command của sơ đồ, không vào Ctrl+Z, không chờ nút Lưu. Mỗi lần ghi có thông báo kèm nút
    **"Hoàn tác"** chạy thao tác ngược (xóa IP vừa thêm, trả mode/VLAN cũ…).
  - Panel ghi rõ "Lưu thẳng vào IPAM". Thiết bị **chưa lưu** (tạo trong editor) thì phần IPAM tắt, kèm hướng dẫn lưu sơ đồ trước.
  - Mỗi lần ghi interface/IP làm tăng `version` của thiết bị: nếu sơ đồ đang giữ một sửa thiết bị chưa lưu, editor cập nhật version
    đó (không tạo bước hoàn tác) để lần lưu sơ đồ không bị báo xung đột.
  - IP quản trị hiển thị trên thẻ thiết bị được làm mới từ máy chủ sau khi ghi (không thuộc lịch sử hoàn tác).
  - **Chọn interface quản trị** vẫn là trường của thiết bị → đi qua sửa nhanh thiết bị (command, lưu cùng sơ đồ).
  - Panel cảnh báo (không chặn): IP trùng với thiết bị khác cùng VRF (bỏ qua thành viên cùng cụm), IP là địa chỉ mạng/broadcast,
    IP nằm ngoài mọi subnet đã khai báo, cổng access mà VLAN chưa có trong IPAM. Validation P1-20 kiểm lại khi lưu.
- **Lý do:** VLAN/subnet/IP là dữ liệu dùng chung của tổ chức (ADR-014), không thuộc một sơ đồ; "IP trống kế tiếp" chỉ đúng khi IP
  vừa gán đã được ghi; một xung đột IP không được làm hỏng cả lần lưu bố cục.
- **Đánh đổi:** hai kiểu hoàn tác trên cùng màn hình (Ctrl+Z cho sơ đồ, nút "Hoàn tác" cho IPAM) — panel ghi rõ để người dùng không nhầm.

### ADR-035 — Thư viện thiết bị có sẵn (catalog) đóng gói trong mã nguồn
- **Bối cảnh:** thiết bị nhập từ Excel hoặc thêm tay mà tổ chức chưa có template thì không có cổng vật lý, không nối dây được
  (P1-21). Người dùng không chuyên mạng không tự khai được tên cổng đúng theo hãng. Người dùng chốt 2026-10-17.
- **Quyết định:**
  - Có **thư viện thiết bị có sẵn**: các dòng phổ biến (đợt đầu: Cisco, Fortinet, TP-Link, Ubiquiti, MikroTik, Aruba, Huawei,
    Juniper, Sophos, Palo Alto, DrayTek, Ruijie, vài ONT nhà mạng) với loại thiết bị, part number/tên gọi khác, số U và **nhóm cổng
    đúng tên CLI của hãng** (cùng định dạng template, `{m}` = số thành viên stack).
  - Lưu là **file JSON trong mã nguồn** (`backend/internal/catalog/data/*.json`), nhúng vào binary, **chỉ đọc**, cập nhật theo phiên
    bản phần mềm. Không phải dữ liệu của tổ chức nào nên **không có `organization_id`** (giống danh sách loại thiết bị) — không phải
    ngoại lệ của quy tắc tenant vì không có bảng nào.
  - *(Sửa cùng ngày theo người dùng — bản đầu chép mục thư viện thành template tổ chức khi dùng, gây khó hiểu vì "không thấy".)*
    Mục thư viện là **template hệ thống**, dùng **trực tiếp**: thiết bị tạo từ template hệ thống được sinh cổng và điền hãng/model/
    part number/số U, lưu `devices.catalog_id`; **không chép** gì vào tổ chức.
  - Trang Template có hai phần: **Template hệ thống** (chỉ xem, tìm theo hãng/model, xem nhóm cổng, nhãn "chưa đối chiếu") và
    **Template tự tạo** (của tổ chức). "Sao chép để sửa" tạo template tự tạo từ một template hệ thống (audit `template.create`).
  - **Tự nhận theo model:** form thêm thiết bị, hộp thêm thiết bị trên sơ đồ, nhập Excel và tab Cổng của thiết bị chọn sẵn template
    khớp model / part number — template tự tạo được ưu tiên, sau đó mới tới template hệ thống. Người dùng vẫn đổi được.
  - Áp template cho thiết bị đã có (apply-template) nhận cả template hệ thống.
  - Mỗi mục có `verified` + `source` (datasheet hãng); mục chưa đối chiếu hiện "cần kiểm tra".
- **Lý do:** đúng tên cổng ngay từ đầu (khớp CLI, khớp LLDP/SNMP ở Phase 3), không bắt người dùng tự gõ; dữ liệu tham chiếu không
  cần sửa theo từng tổ chức nên file trong mã nguồn là đơn giản và kiểm soát được (review qua git).
- **Đánh đổi:** model mới phải chờ bản phần mềm sau (tạm thời tự tạo template); dữ liệu soạn từ datasheet có thể sai sót — giảm bằng
  cờ `verified` và việc template chép ra vẫn sửa được.

### ADR-036 — Thiết bị đầu cuối vẽ trên sơ đồ là "nhóm đầu cuối", không vào kho
- **Bối cảnh:** sơ đồ cần biểu diễn PC, camera, điện thoại IP… nhưng không quản lý từng máy trong danh sách thiết bị. Người dùng
  chốt 2026-10-17: một biểu tượng **đại diện** cho các máy giống nhau (vd camera cắm cổng 1–24 của switch PoE, cùng một dải IP),
  cấu hình được ngay trên sơ đồ.
- **Quyết định:**
  - Thư viện sơ đồ có mục **"Đầu cuối (không vào kho)"**: PC, laptop, máy in, điện thoại IP, họp trực tuyến, camera, chấm công,
    IoT, khác. Kéo vào → **nhóm đầu cuối** (bảng `endpoint_groups` sẵn có) ở dạng nháp, tạo khi lưu sơ đồ (thao tác
    `createEndpointGroup` / `updateEndpointGroup` của lần lưu, có hoàn tác). Máy chủ, NAS, máy ảo vẫn là thiết bị trong kho.
  - Muốn quản lý từng máy thì tích "Quản lý từng máy trong kho" → tạo thiết bị như cũ.
  - **Panel nhóm:** tên, loại, số lượng, site, dải IP (chọn, hoặc tạo dải mới trong subnet của site — ghi IPAM ngay như ADR-034),
    ghi chú, danh sách cổng đang cắm.
  - **Nối dải cổng:** nối nhóm với thiết bị chọn "từ cổng … đến cổng …" → mỗi cổng một link (cổng switch được đánh dấu đã dùng
    đúng thực tế, quy tắc "một cổng một dây" giữ nguyên); một bước hoàn tác.
  - **Hiển thị:** các dây của một nhóm tới cùng một thiết bị vẽ thành **một cạnh**, nhãn dải cổng "Gi1/0/1–24 (24)"; xóa cạnh đó xóa
    cả nhóm dây. Nút nhóm có biểu tượng đúng loại và "×số lượng".
- **Lý do:** sơ đồ chuẩn chỉ cần đại diện; dữ liệu vẫn đủ để biết cổng nào đã dùng, dải IP nào thuộc camera; không làm phình danh
  sách thiết bị.
- **Đánh đổi:** nhiều link cho một nhóm (mỗi cổng một link) — chấp nhận để giữ đúng trạng thái cổng; sửa thuộc tính dây của cả nhóm
  dây một lần để sau.

### ADR-037 — File .ntb.json v2: một sơ đồ cùng mọi thứ nó dùng; nhập luôn tạo id mới
- **Bối cảnh:** P1-22 cần xuất/nhập sơ đồ kèm dữ liệu kho để chuyển sang tổ chức hoặc máy khác. `schema/ntb.schema.json` cũ là mô hình
  thời prototype (project/pages), lệch xa dữ liệu hiện tại. Người dùng chốt 2026-10-17.
- **Quyết định:**
  - **Schema v2** (`schemaVersion` "2.0.0") ở `schema/ntb.schema.json`, tên trường theo `api/openapi.yaml`: sơ đồ (view: node, cạnh,
    khung/chữ/mũi tên, portStyle, labelTemplate), site (mã + tên), cụm, thiết bị, cổng, IP, subnet, dải IP, nhóm đầu cuối, dây.
    **Không có bí mật.** Schema cũ chuyển sang `schema/legacy/` (chỉ prototype `/editor` dùng). Backend nhúng một bản sao, có test bảo
    đảm trùng bản gốc; file nhập được kiểm tra bằng santhosh-tekuri/jsonschema (đã có trong Stack).
  - **Phạm vi:** một sơ đồ và mọi đối tượng trên nó (cùng cổng, IP, dây giữa chúng, cụm, nhóm, dải IP của nhóm, subnet chứa IP).
  - **Xuất** do backend dựng (`GET …/diagrams/{id}/ntb`), audit `export.diagram_ntb`.
  - **Nhập** (`POST …/ntb-imports/preview` rồi `POST …/ntb-imports`): một transaction, **luôn tạo id mới**, tổ chức lấy từ route.
    Người dùng ghép từng site trong file với site đích (cùng mã/tên được chọn sẵn). Thiết bị cùng hostname đã có ở site đích: **mặc
    định dùng thiết bị có sẵn**, có thể chọn cập nhật theo file / tạo mới / bỏ qua; thành viên cụm ghép theo hostname + số thứ tự.
    Cụm/nhóm cùng tên, dây cùng hai đầu đã có thì dùng lại (nhập lần 2 không nhân bản). Mọi đối tượng ghi qua cùng hàm ghi của form
    (luật + audit); thêm một mục audit `import.ntb`.
  - Dải IP của nhóm chỉ gắn khi đã có dải y hệt trong IPAM của tổ chức đích (không tự tạo subnet/dải) — có cảnh báo để gắn lại.
- **Lý do:** dữ liệu chuyển đi đầy đủ mà không lộ bí mật; nhập an toàn với tenant (không id nào từ file được dùng để ghi đè).
- **Đánh đổi:** location/rack của thiết bị không đi theo file; subnet/dải IP không tự tạo khi nhập.

### ADR-038 — Chặn trùng S/N và trùng IP khi ghi; vai trò IP "VIP" cho VRRP/HSRP
- **Bối cảnh:** ADR-034 / P1-20 chỉ cảnh báo khi trùng IP hoặc trùng serial. Người dùng chốt 2026-10-17: phải chặn cả hai.
  Nhưng có những bản trùng IP là đúng thiết kế, nên không thể chặn máy móc.
- **Quyết định:**
  - **S/N:** API từ chối nếu một thiết bị khác còn trong kho (chưa xóa, chưa thanh lý) có cùng S/N. So sánh bỏ khoảng trắng, không phân biệt hoa/thường.
    Không tính giá trị giữ chỗ (`-`, N/A, none, unknown, TBD, 0). Kiểm tra khi tạo, khi đổi S/N, hoặc khi đưa thiết bị thanh lý trở lại dùng.
  - **IP:** API từ chối nếu địa chỉ (host) đã có chủ khác trong cùng VRF. "Chủ" là interface hoặc IP NAT của thiết bị, IP chung của cụm,
    hoặc thành viên nhóm đầu cuối. Các trường hợp được phép:
    - cùng thiết bị, hoặc cùng cụm (cụm và các thành viên là một chủ, ADR-027);
    - một bản có vai trò NAT/public (nhiều máy dùng chung một IP WAN là bình thường);
    - **cả hai bản đều có vai trò `vip`**: IP gateway ảo của nhóm VRRP/HSRP, khai trên mỗi router của nhóm;
    - thiết bị ở trạng thái dự kiến / dự phòng / RMA (máy thay thế chuẩn bị sẵn cùng cấu hình) hoặc đã thanh lý. Trường hợp này vẫn hiện cảnh báo;
    - IPv6 link-local.
  - Chỉ kiểm tra khi địa chỉ, VRF hoặc vai trò thay đổi, để sửa mô tả của một vụ trùng cũ vẫn được.
    Mỗi lần kiểm tra khóa giá trị đó (advisory lock theo giao dịch), nên hai lần ghi đồng thời không cùng lọt.
  - Áp dụng ở mọi đường ghi: API thiết bị/IP/cụm/thành viên nhóm, đặt IP quản trị, nhập Excel và nhập .ntb.json.
    Khi nhập, dòng bị trùng IP vẫn tạo thiết bị nhưng không gắn IP và có cảnh báo; trùng S/N thì dòng đó báo lỗi.
  - Thêm vai trò IP `vip` (migration 000023, OpenAPI, schema .ntb.json). Kiểm tra trên sơ đồ và dashboard không còn báo trùng khi hai bản đều là VIP.
- **Lý do:** dữ liệu kho dùng để đối chiếu với thực tế, nên trùng S/N hay trùng IP gần như luôn là nhập sai.
  Các ngoại lệ ở trên là những trường hợp kỹ sư mạng làm hằng ngày, cần được khai đúng thay vì bị chặn.
- **Đánh đổi:** chuyển một thành viên nhóm thành thiết bị không kiểm tra lại IP (địa chỉ chỉ đổi chủ). Dữ liệu trùng có từ trước vẫn còn
  và được dashboard / kiểm tra sơ đồ báo ra để sửa.

### ADR-039 — Sơ đồ mẫu: thiết kế sinh sẵn thành thiết bị "Dự kiến" trong kho, qua đường nhập .ntb.json
- **Bối cảnh:** người dùng muốn bắt đầu từ mẫu thiết kế chuẩn (2026-10-17): văn phòng ≤ 50 user, ≤ 100 user, có tùy chọn HA, firewall VPN,
  và mẫu nhiều chi nhánh (mỗi chi nhánh ~50 user). Người dùng chốt: thiết bị là thiết bị "dự kiến" thật trong kho;
  "HA" nghĩa là dự phòng (không phải HAProxy); model chọn theo bộ hãng.
- **Quyết định:**
  - Ba kịch bản:
    - văn phòng nhỏ (≤ 60 user): gateway định tuyến VLAN, SW01 nhận trunk, các switch khác treo vào SW01;
    - văn phòng vừa (core + access, phòng server);
    - trụ sở + 1–20 chi nhánh: chi nhánh là văn phòng nhỏ, có VPN site-to-site về firewall trụ sở.
  - Tùy chọn: HA (cặp firewall, đường Internet thứ hai, core stack — chỉ bộ Fortinet), VPN cho nhân viên ở xa, IP Phone, camera, Wi-Fi khách.
  - Bốn bộ hãng: Fortinet + Cisco, Fortinet + Aruba, TP-Link Omada (thêm controller OC200), Ubiquiti UniFi.
    - Fortinet định tuyến VLAN trên core; riêng Wi-Fi khách định tuyến trên firewall để khách không vào được mạng trong.
    - TP-Link / UniFi định tuyến trên gateway (router-on-a-stick), core chỉ gom switch.
  - Quy mô:
    - 1 AP / 25 user; camera user/6; máy in user/25;
    - switch dùng 80% số cổng; PC cắm qua cổng PC của IP Phone;
    - không dùng cổng quản trị riêng (Gi0/0, mgmt) để nối dây.
  - Quy hoạch IP:
    - mỗi site một khối 10.x.0.0/16 chưa dùng (khóa theo tổ chức khi chọn);
    - VLAN 10/20/30/40/50/60, mỗi VLAN một /24 (/23 khi trên 180 user), gateway .1;
    - DHCP .50–.250, máy in IP tĩnh .11–.40;
    - nối firewall–core /30; VPN site-to-site /30 trong 10.<trụ sở>.254.0/24; dải VPN client .100–.199.
  - Cách ghi: một giao dịch duy nhất.
    1. Tạo site (mã trùng thì thử mã kế tiếp).
    2. Tạo VLAN, subnet, dải IP qua các hàm ghi sẵn có của IPAM.
    3. Dựng file .ntb.json bằng bộ dựng của P1-25 và nhập bằng đường nhập .ntb (ADR-037), để mọi luật (chặn trùng IP / S/N, một cổng một dây, audit) đều áp dụng.
    4. Ghi một dòng audit `design_template.apply`.
    
    Xem trước chạy y như vậy rồi rollback, nên kết quả xem trước luôn khớp với lúc tạo thật.
  - Hostname ngắn theo mã site (VP-FW01); nếu đã có thiết bị dùng tiền tố đó thì dùng mã site đầy đủ. Tên sơ đồ mặc định tự thêm số khi trùng.
  - Lời khuyên triển khai (DHCP relay khi core định tuyến; modem nhà mạng với cặp HA; cần NVR cho camera) nằm ở mục "Lưu ý", không phải cảnh báo.
- **Lý do:** thiết kế và kho là một. Khi lắp đặt chỉ cần điền S/N và chuyển sang Đang dùng, không phải nhập lại. Dùng chung đường nhập
  đã kiểm chứng nên không có đường ghi dữ liệu thứ hai cần bảo trì.
- **Đánh đổi:** model cố định theo bộ hãng (đổi model thì sửa từng thiết bị sau); chưa tính công suất PoE; stack core vẽ bằng dây trên cổng
  SFP vì danh mục chưa có cổng stack chuyên dụng; cặp HA nối thẳng modem (có ghi lưu ý).

### ADR-040 — Sơ đồ tổng quan: node site sống theo kho, cạnh giữa site tự suy ra, đi sâu bằng double-click
- **Bối cảnh:** P2-21 làm phần drill-down của ADR-028 (người dùng chọn làm 2026-10-18). Một agent đóng vai kỹ sư mạng góp ý thiết kế:
  sơ đồ tổng quan vẽ tay sẽ nhanh chóng lỗi thời, nên phải lấy dữ liệu sống từ kho.
- **Quyết định:**
  - Sơ đồ tổng quan (layer `overview`) chỉ lưu **vị trí** của các node `site`.
    - Thẻ site hiển thị: mã + tên + loại site, các đường WAN tới nhà mạng, gateway (`FortiGate 60F ×2 HA`), số thiết bị/nhóm, viền nét đứt khi chủ yếu là thiết bị dự kiến.
    - Thẻ được tính lại mỗi lần mở qua `GET /site-graph`.
  - **Cạnh site ↔ site được suy ra, không lưu:**
    - Gộp mọi link giữa thiết bị của hai site khác nhau (bỏ provider cloud): một cạnh cho mỗi cặp, mỗi link đếm một lần.
    - Nhãn là dịch vụ chiếm đa số + băng thông, thêm "+N" cho các link còn lại. Server trả mã dịch vụ, giao diện dịch theo ngôn ngữ.
    - Nét liền = kênh riêng / MPLS / cáp; nét đứt = VPN; nét chấm = không dây / 4G. Cạnh chỉ để xem: không chọn, không sửa, không xóa.
  - Không vẽ đám mây Internet riêng cho từng site; đường ISP hiện thành chip trên thẻ site.
  - **Tự sinh tổng quan** (Toàn tổ chức hoặc một danh mục):
    - Site trung tâm được gợi ý theo thứ tự: nhiều site nối tới nhất → IDC → tên "trụ sở/HQ"; người dùng sửa được, chọn được nhiều.
    - Site trung tâm đặt ở trên, các site khác xếp lưới trong khung theo danh mục.
    - "Thêm site còn thiếu" chỉ thêm site mới (trong các danh mục đang vẽ), giữ nguyên vị trí cũ, một bước hoàn tác.
  - **Đi sâu:** double-click node site.
    - Site có 1 sơ đồ chi tiết → mở luôn và zoom vào khung của site.
    - Có nhiều sơ đồ → chọn trong danh sách.
    - Chưa có sơ đồ → "Tạo trống" hoặc "Sinh từ kho" (thiết bị của site xếp theo tầng trong khung, dây tự hiện).
    
    Sơ đồ chi tiết mở với `?from=<tổng quan>` để breadcrumb quay lại được. Node trỏ tới sơ đồ khác cũng mở được bằng double-click.
  - Sơ đồ được tạo với viewport mặc định (0,0,1) sẽ mở ở chế độ vừa màn hình.
- **Lý do:** sơ đồ tổng quan vẽ tay sẽ lỗi thời; lấy từ kho thì luôn đúng. Gộp cạnh theo cặp site tránh vẽ trùng; chip ISP
  thay cho hàng chục đám mây.
- **Để sau:**
  - các site nối qua một đám mây MPLS / Metro chung (sẽ vẽ một node mây, các site treo vào; hiện chưa ra cạnh);
  - lưu phạm vi danh mục của sơ đồ tổng quan ("thêm site còn thiếu" đang suy phạm vi từ các site đã vẽ);
  - gộp danh mục thành một node khi có trên 50 site; bật/tắt đám mây Internet; cờ đường chính/dự phòng; SD-WAN overlay;
  ẩn cạnh giữa các chi nhánh trong mô hình full mesh; số vấn đề trên thẻ site; màu trạng thái thật (Phase 3).


### ADR-041 — Thư viện model đối chiếu với NetBox; ảnh thật của thiết bị xem qua popup
- **Bối cảnh:** P2-12, người dùng chốt ngày 2026-10-18.
  - Người dùng muốn xem ảnh thật của router / firewall / switch, nhưng không để sơ đồ nặng thêm.
  - Catalog ADR-035 (362 model) còn 115 mục "chưa đối chiếu".
  - Kho NetBox devicetype-library (cộng đồng, giấy phép CC0) có hơn 12.000 model, gồm cổng và ảnh mặt trước / mặt sau chụp thẳng.
- **Quyết định:**
  - **Nguồn dữ liệu là NetBox, không lấy ảnh quảng cáo trên web hãng** (có bản quyền).
    - Mỗi ảnh ghi nguồn (trang NetBox) trong `catalog/images/SOURCES.json`.
    - Model nào không có ảnh trong NetBox thì chưa có ảnh, trừ khi có ảnh **model anh em cùng vỏ máy** (chỉ khác uplink / PoE, ví dụ
      C1300-48P-4G dùng ảnh C1300-48P-4X). Khi đó popup ghi rõ "ảnh model tương tự …" (`similarTo`, bổ sung 2026-10-18 theo
      người dùng). Không dùng ảnh khác vỏ máy hoặc khác số cổng.
    - Ảnh do người dùng tải lên sẽ làm cùng phần lưu file đính kèm (P2-04).
  - **Ảnh đóng gói trong binary** cùng catalog.
    - Tên file là `<catalog id>.front.jpg` / `.rear.jpg`.
    - Ảnh được chuyển một lần sang JPEG, rộng tối đa 1200 px, không phóng to ảnh nhỏ.
    - Ảnh được phục vụ qua `GET /orgs/{orgId}/device-catalog/images/{file}`: cần là thành viên tổ chức, tên file phải đúng mẫu, cache `private`.
    - Loader kiểm tra mỗi ảnh khớp một model và có nguồn; sai thì không khởi động được.
  - **Ảnh chỉ tải khi người dùng mở:**
    - Trên sơ đồ, nút máy ảnh chỉ hiện khi rê chuột hoặc chọn node, và khi zoom từ 50 % trở lên.
    - Panel thiết bị, trang thiết bị và danh sách template hệ thống có nút "Xem ảnh thật".
    - Model được xác định theo `catalogId`, nếu không có thì theo model / part number (giống tự nhận template).
  - **Đối chiếu dữ liệu với NetBox:**
    - So số cổng theo loại (RJ45 / SFP / SFP+…).
    - Mục khớp và tên cổng đúng thì được đánh dấu đã đối chiếu, `source` trỏ tới NetBox.
    - Mục lệch được kỹ sư mạng (agent) xét từng cái: sửa theo datasheet hoặc giữ nguyên.
    - Model mới chuyển từ NetBox sang định dạng nhóm cổng của mình.
  - YAML của NetBox được chuyển sang JSON bằng script ngoài repo, chạy một lần mỗi đợt cập nhật. Backend và frontend không thêm thư viện.
- **Lý do:** ảnh thật giúp nhận diện thiết bị ngoài hiện trường. Nguồn CC0 tránh rủi ro bản quyền. Tải khi cần thì sơ đồ lớn không chậm.
  NetBox là nguồn đối chiếu độc lập cho tên cổng.
- **Đánh đổi:**
  - Repo nặng thêm khoảng 10–15 MB ảnh.
  - Độ phủ ảnh không đều: Cisco / Aruba nhiều, Fortinet / TP-Link ít.
  - Ảnh trong NetBox do cộng đồng đóng góp, có thể đã lấy từ hãng. Rủi ro này thấp hơn tự lấy ảnh từ web hãng, nhưng không bằng không.
- **Để sau:** người dùng tải ảnh riêng cho model / thiết bị (cùng P2-04); sơ đồ tủ rack dùng ảnh mặt trước; chế độ hiển thị "Ảnh thật"
  trên sơ đồ khi phóng to.

### ADR-042 — Ngày ngừng bán / hết hỗ trợ trong thư viện model, tự điền cho thiết bị
- **Bối cảnh:** P2-22, người dùng duyệt 2026-10-18.
  - Thiết bị đã có hai trường ngày `eol_date` / `eos_date`, nhưng không ai tự tra được ngày của hãng.
  - Dashboard đã đếm ngày hết hỗ trợ, nhưng hầu hết thiết bị để trống.
- **Quyết định:**
  - **Hai mốc theo thông báo End-of-Life chính thức của hãng:**
    - *Ngừng bán* (End-of-Sale, ngày cuối còn đặt mua) ghi vào `eol_date`;
    - *Hết hỗ trợ* (End-of-Support; Cisco gọi là LDoS) ghi vào `eos_date`.
    - Nhãn trên giao diện đổi thành "Ngừng bán (End-of-Sale)" / "Hết hỗ trợ (End-of-Support)" cho khỏi nhầm.
  - **Dữ liệu lưu ở `catalog/lifecycle.json`**, tách khỏi dữ liệu cổng vì hãng ra thông báo theo lịch riêng.
    - Mỗi mục có link thông báo của hãng (https).
    - Hãng chưa công bố thì để trống, không đoán hay suy ra từ đời máy.
    - Loader kiểm tra: đúng định dạng YYYY-MM-DD, ngày ngừng bán không sau ngày hết hỗ trợ, id tồn tại.
  - **Tự điền khi tạo thiết bị**, ở server, nên áp cho mọi đường tạo: form, nhập Excel, nhập .ntb, sơ đồ mẫu.
    - Chỉ điền ô người dùng để trống.
    - Lấy theo model thiết bị được tạo từ; nếu không có thì theo model / part number, cùng quy tắc so khớp với giao diện.
  - **Thiết bị đã có:** nút "Điền ngày hết hỗ trợ" gọi `POST /devices/fill-lifecycle`.
    - Xem trước rồi mới ghi.
    - Chỉ ghi ô trống, không bao giờ ghi đè ngày người dùng đã nhập.
    - Chỉ thiết bị người dùng có quyền sửa; mỗi thiết bị một dòng audit `device.update`.
  - **Báo cáo:**
    - danh sách thiết bị lọc `support=expired|soon` (đã hết / hết trong 12 tháng);
    - dashboard có link sang danh sách đó;
    - luật kiểm tra sơ đồ "thiết bị đang dùng đã hết hỗ trợ" (Warning, SRS §7).
- **Lý do:** ngày hết hỗ trợ quyết định khi nào phải thay thiết bị (không còn bản vá bảo mật). Lấy từ nguồn chính thức, có link, thì kiểm chứng được. Không ghi đè thì giữ được thông tin người dùng có (hợp đồng gia hạn, ngày riêng theo SKU vùng).
- **Đánh đổi:**
  - Dữ liệu cập nhật theo bản phần mềm.
  - Một số SKU theo vùng (Cisco -IN, -BR) có ngày khác; người dùng tự sửa.
  - Huawei, Aruba 2530 chưa có vì chưa tải được nguồn hoặc chưa xác nhận được ngày.
- **Để sau:** email cảnh báo theo mốc (P2-05); báo cáo Excel thiết bị hết hỗ trợ (P2-11).

### ADR-043 — Cảnh báo hết hạn: SMTP chung cho hệ thống, email tổng hợp mỗi sáng, chuông trong ứng dụng
- **Bối cảnh:** P2-05, người dùng chốt 2026-10-18.
  - Chỉ một số thiết bị có license; không muốn bị spam.
  - Người dùng chấp nhận ba đề xuất: SMTP chung trước; email tổng hợp mỗi sáng, chỉ khi có gì mới; người nhận là owner + admin cộng email thêm.
- **Quyết định:**
  - **Một máy chủ SMTP cho cả hệ thống**, quản trị hệ thống chỉnh ở Hệ thống › Gửi email (bảng `smtp_settings` một dòng).
    - Đây là cấu hình hệ thống, giống bảng `users`, nên không có `organization_id`.
    - Mật khẩu mã hóa envelope (keyring của `NTB_MASTER_KEY`, AAD riêng). Không bao giờ trả về qua API (chỉ `passwordSet`), không vào audit, không log.
    - Kiểu mã hóa: STARTTLS (bắt buộc khi đã chọn, không tự hạ xuống), TLS, hoặc không mã hóa (chỉ cho relay nội bộ). Không gửi mật khẩu qua kết nối không mã hóa.
    - Có nút gửi thử. Ô "Địa chỉ truy cập hệ thống" dùng để đặt link trong email.
    - SMTP riêng theo tổ chức để sau.
  - **Cài đặt theo tổ chức** (owner / admin):
    - bật / tắt; loại cảnh báo: hết bảo hành / hết license / hãng ngừng hỗ trợ;
    - mốc báo trước: mặc định 90/60/30/7, tối đa 6 mốc;
    - người nhận: owner + admin (bỏ chọn được) cộng tối đa 20 email thêm.
  - **Chỉ thiết bị có ngày tương ứng, đang dùng hoặc dự phòng, không bị tắt cảnh báo** mới được báo.
    - Ô trống thì không báo, nên switch không có license không bị làm phiền.
    - Có nút "Tắt cảnh báo" cho từng thiết bị, có audit.
  - **Mỗi mốc báo một lần** (bảng `notifications`, unique theo thiết bị + loại + ngày + mốc).
    - Thiết bị mới thêm đã gần hạn chỉ nhận mốc hiện tại, không nhận dồn các mốc trước.
    - Quá hạn thì báo thêm một lần "đã hết hạn".
    - Gia hạn (đổi ngày) thì bắt đầu chu kỳ mới.
  - **Job chạy mỗi giờ** trong process API, có advisory lock để không chạy trùng.
    - Từ 7 giờ sáng (giờ máy chủ) mỗi tổ chức nhận tối đa **một email tổng hợp mỗi ngày**, gồm những mốc mới.
    - Gửi lỗi thì giữ lại, thử lần sau.
    - Chưa cấu hình SMTP thì chỉ có thông báo trong ứng dụng, và không dồn email cũ khi bật SMTP sau.
  - **Chuông** hiện 50 thông báo mới nhất, chỉ của thiết bị người dùng được xem; đếm chưa đọc theo từng người.
  - Gửi mail bằng `net/smtp` + `crypto/tls` có sẵn trong Go, không thêm thư viện.
- **Lý do:** cài đặt tự host thường chỉ có một máy chủ mail. Email tổng hợp và báo mỗi mốc một lần tránh làm phiền. Dựa vào ô ngày có hay không là cách tự nhiên nhất để chỉ báo thiết bị có license.
- **Đánh đổi:**
  - Mỗi thiết bị chỉ có một ô "Hết license", trong khi thực tế thường có nhiều gói (FortiCare / FortiGuard, SmartNet / DNA): tạm ghi ngày gần nhất.
  - Giờ gửi theo giờ máy chủ (đặt `TZ`).
- **Để sau:**
  - cảnh báo theo dòng hợp đồng / gói dịch vụ (P2-04), tài khoản cloud (P2-03), credential quá hạn đổi (P2-02);
  - SMTP riêng theo tổ chức;
  - người nhận theo site / danh mục;
  - dọn thông báo cũ.

### ADR-044 — Nhà cung cấp & hợp đồng: mỗi hợp đồng một ngày hết hạn, áp cho thiết bị / link; file lưu trong Postgres
- **Bối cảnh:** P2-04 (SRS §8), người dùng duyệt 2026-10-18 qua "ok task tiếp theo".
  - Một thiết bị thường có nhiều gói với ngày khác nhau (FortiCare / FortiGuard, SmartNet / DNA); ô "Hết license" không đủ.
  - SRS yêu cầu "từ thiết bị hoặc link WAN bấm ra ngay hotline, liên hệ và hợp đồng liên quan".
- **Quyết định:**
  - **Nhà cung cấp** (`vendors`, theo tổ chức):
    - loại: hãng / nhà phân phối / ISP / bảo trì / khách hàng / khác;
    - tên không trùng trong tổ chức; mã số thuế, website, hotline, email, cổng hỗ trợ;
    - website và cổng hỗ trợ chỉ nhận http(s);
    - có nhiều **người liên hệ**.
  - **Hợp đồng = một dịch vụ với một ngày hết hạn.**
    - Thuộc một nhà cung cấp; loại: hỗ trợ hãng / bảo hành / license / ISP / bảo trì / khác; số hợp đồng, ngày bắt đầu / kết thúc, SLA.
    - **Áp cho nhiều thiết bị và link** (`contract_items`); FortiCare và FortiGuard của cùng một máy là hai hợp đồng.
    - Thiết bị / link phải thuộc cùng tổ chức. Sửa hợp đồng là thay toàn bộ danh sách áp dụng.
  - Thiết bị có **"mua từ" (supplier)**, chỉnh qua endpoint riêng, để mọi đường cập nhật thiết bị khác không vô tình xóa mất.
    - Ô "hãng" của thiết bị vẫn là tên hãng sản xuất in trên máy.
  - **File đính kèm hợp đồng lưu trong Postgres (bytea).**
    - Tối đa 10 MB mỗi file, 20 file mỗi hợp đồng.
    - Chỉ nhận PDF / ảnh / Office / TXT / CSV. Kiểm tra cả phần mở rộng lẫn nội dung thật (chữ ký OLE cho .doc / .xls).
    - Loại file lưu theo bảng cho phép, không tin client. Tên file bỏ phần đường dẫn và ký tự điều khiển.
    - Luôn tải xuống dạng `attachment`, `application/octet-stream`, `nosniff`, không mở trong origin của ứng dụng.
    - Backup DB là có luôn file. Lưu file ra ổ đĩa / S3 để sau, nếu dung lượng lớn.
  - Quyền: thành viên nào cũng xem; biên tập viên trở lên được sửa; mọi thao tác ghi có audit (audit file chỉ ghi tên, kích thước, sha256).
  - **Cảnh báo hợp đồng sắp hết hạn** nối vào ADR-043 (loại `contract`, mặc định bật, mỗi mốc báo một lần, link tới trang hợp đồng).
  - Tab "Hợp đồng & bảo hành" của thiết bị hiện nhà cung cấp "mua từ" và mọi hợp đồng áp cho thiết bị, kèm hotline / cổng hỗ trợ / người liên hệ.
- **Lý do:** một hợp đồng một ngày hết hạn khớp cách hãng bán gói, nên cảnh báo đúng từng gói. File trong DB đơn giản cho bản tự cài đặt và chung một bản backup.
- **Đánh đổi:**
  - DB lớn dần theo số file.
  - Ô "Hết license" cũ của thiết bị vẫn còn, có thể trùng với hợp đồng license; khi đã dùng hợp đồng thì nên bỏ trống ô đó.
- **Để sau:**
  - nhập nhà cung cấp / hợp đồng từ Excel;
  - chi phí và gia hạn;
  - liên kết nhà cung cấp với `links.provider` (đang là chữ);
  - ảnh thiết bị do người dùng tải lên (P2-12) dùng chung chỗ lưu file.

### ADR-045 — Kho mật khẩu: mật khẩu thiết bị và tài khoản cloud, xem cần quyền + MFA 5 phút, xoay master key bằng CLI
- **Bối cảnh:** P2-02 + P2-03 làm chung (người dùng chốt 2026-10-18).
  - Kho ngoài (Bitwarden / Vaultwarden, HashiCorp Vault) của ADR-018 để nâng cấp sau.
  - Đợt này chỉ lưu mã hóa trong hệ thống.
- **Quyết định:**
  - **Mật khẩu thiết bị** (`credentials`):
    - tên (không trùng trong tổ chức), loại (SSH / Telnet / Web / console / enable / SNMP community / API token / khác), tài khoản;
    - mật khẩu giữ nguyên từng ký tự, không cắt khoảng trắng;
    - chu kỳ đổi và ngày đổi gần nhất: nhập mật khẩu mới thì ngày đổi tự là hôm nay;
    - gắn nhiều thiết bị, mỗi thiết bị có mục đích.
  - **Tài khoản cloud** (`cloud_accounts`):
    - nền tảng (FortiCloud, Meraki, UniFi, Omada, Aruba Central, Hik-Connect, khác), địa chỉ portal (chỉ http(s)), tài khoản, mật khẩu;
    - **người giữ MFA**, gói dịch vụ, ngày hết hạn, nhà cung cấp;
    - thiết bị được quản lý.
  - **Mã hóa:**
    - envelope AES-256-GCM (ADR-018), AAD gắn với id bản ghi (`credential:<id>`, `cloud_account:<id>`), id do server sinh trước khi ghi;
    - ciphertext chép sang dòng khác thì không mở được;
    - query danh sách / chi tiết không bao giờ đọc cột bí mật;
    - xóa bản ghi là xóa luôn bí mật.
  - **Quyền:**
    - thành viên xem được tên, loại, tài khoản, thiết bị (không có mật khẩu);
    - thêm / sửa / xóa cần owner, admin hoặc `credential.manage`;
    - **xem / copy** cần owner, admin hoặc `credential.reveal`, **và MFA trong 5 phút gần nhất**. Nếu chưa, API trả 428; giao diện hỏi mã MFA (dùng lại `/auth/mfa/verify`) rồi thử lại.
    - Mỗi lần xem / copy ghi audit `credential.reveal` / `credential.copy` (ai, khi nào, mục nào, IP), không có mật khẩu.
    - Mật khẩu hiện ra tự ẩn sau 30 giây; clipboard được xóa sau 30 giây (trong giới hạn trình duyệt cho phép).
  - **Cảnh báo** (ADR-043): mật khẩu tới hạn đổi (ngày đổi + chu kỳ), tài khoản cloud hết hạn.
  - **Xoay master key:**
    - `ntb rotate-master-key` đọc khóa cũ (`NTB_MASTER_KEY` + `NTB_MASTER_KEY_VERSION`) và khóa mới (`NTB_NEW_MASTER_KEY`);
    - bọc lại khóa dữ liệu của mọi bí mật (mật khẩu, tài khoản cloud, MFA seed, mật khẩu SMTP) trong **một giao dịch**, version tăng 1;
    - không giải mã bí mật. Có bí mật nào không mở được bằng khóa cũ thì dừng, không đổi gì;
    - sau đó đặt khóa mới và version mới rồi khởi động lại API.
- **Lý do:** kho mật khẩu là mục tiêu tấn công số một. Quyền riêng, MFA gần đây và audit từng lần xem là mức tối thiểu. AAD theo bản ghi chặn việc tráo ciphertext. Xoay khóa không cần giải mã nên an toàn và nhanh.
- **Đánh đổi:**
  - Phải dừng API khi xoay khóa.
  - Clipboard chỉ xóa được khi trang còn được focus.
  - SNMPv3 (có auth và priv) tạm ghi một bí mật cùng ghi chú.
- **Để sau:**
  - tham chiếu kho ngoài (Bitwarden / Vaultwarden / HashiCorp Vault);
  - SNMPv3 đủ trường;
  - cảnh báo "một mật khẩu dùng cho quá nhiều thiết bị" (thuộc P2-10);
  - lịch sử mật khẩu cũ.

### ADR-046 — Rà soát bảo mật nền tảng (P2-01): header, khóa ngoại cùng tổ chức, khóa tài khoản, RLS để sau
- **Bối cảnh:** rà soát toàn bộ nền tảng trước khi dùng cho nhiều khách hàng.
  - Ba bản rà soát song song: web (header, XSS, phụ thuộc), xác thực / phân quyền, cách ly tổ chức.
  - Kết quả: 309 query đều lọc theo tổ chức; không có handler thiếu kiểm tra quyền; không có lỗ XSS; `govulncheck` sạch; `npm audit --omit=dev` = 0.
- **Quyết định:**
  - **Header:**
    - nginx: CSP chặt (`script-src 'self'`; chỉ `style-src` có `'unsafe-inline'` vì thư viện vẽ sơ đồ ghi style trực tiếp), `frame-ancestors 'none'`, HSTS, nosniff, Referrer-Policy, Permissions-Policy, COOP / CORP; `server_tokens off`;
    - API: mọi phản hồi `Cache-Control: no-store`, nosniff, CSP `default-src 'none'`.
    - Đã kiểm tra trên bản build production: không có vi phạm CSP ở dashboard, kho mật khẩu, nhà cung cấp, màn vẽ, xuất PNG.
  - **Giới hạn request:** body tối đa 4 MiB (import / file hợp đồng 26 MiB), vượt thì trả 413; header phải tới trong 10 giây, cả request / phản hồi tối đa 5 phút (đủ cho file 25 MB qua VPN chậm).
  - **Log không chứa token:** link mời / đặt lại mật khẩu bị cắt trong log nginx và log API.
  - **Khóa ngoại cùng tổ chức** (migration 027): mọi tham chiếu giữa bảng nghiệp vụ dùng khóa ghép `(id, organization_id)`. Dù code có lỗi, DB cũng không cho dòng của tổ chức A trỏ sang tổ chức B. Join theo id còn lại được thêm điều kiện tổ chức.
  - **Khóa tài khoản:**
    - sai mã MFA tính như sai mật khẩu; đủ số lần thì khóa. Khóa vì sai **mã MFA** thì đăng xuất mọi phiên; khóa vì sai **mật khẩu** chỉ chặn đăng nhập mới (để người biết email không đá chủ tài khoản ra được);
    - tài khoản có MFA: đăng nhập đúng mật khẩu **không** xóa bộ đếm, chỉ nhập đúng mã MFA mới xóa (đăng nhập lại không giúp đoán mã tiếp);
    - đang bị khóa thì không đếm thêm, hết khóa thì đếm lại từ đầu;
    - bật / tắt MFA có giới hạn riêng 5 lần / phút, không chung với lần nhập mã khi đăng nhập.
  - **Link mời / đặt lại mật khẩu:** giới hạn theo IP, mật khẩu từ 12 đến 1024 ký tự (chặn hash chuỗi khổng lồ).
  - **MFA bắt buộc** thêm cho người có quyền `credential.reveal`, `credential.manage`, `user.manage`.
  - **Owner cuối cùng:** chỉ tính owner còn hoạt động (đã kích hoạt, không bị khóa); khóa mọi dòng owner theo một thứ tự khi đếm, để hai owner hạ quyền nhau cùng lúc phải chờ nhau (không mất owner, không deadlock).
  - **Import `.ntb.json`:** site đích phải là site còn sống của tổ chức, nếu không thì trả 400.
  - **Link mời** (người dùng chốt 2026-10-18): vẫn hiện để người quản lý copy và gửi qua kênh bất kỳ (Zalo, Teams, email…), không bắt buộc gửi email. Link dùng một lần, có hạn, chỉ cho tài khoản chưa kích hoạt.
  - **Không tự nâng quyền** (người dùng chốt 2026-10-18):
    - không ai tự nâng vai trò hoặc thêm quyền cho chính mình; tự hạ thì được (vẫn giữ luật owner cuối cùng);
    - dưới owner, không ai cấp vai trò cao hơn vai trò của chính mình, hay sửa / gỡ người có vai trò cao hơn (viewer có `user.manage` không biến ai thành editor được);
    - nâng quyền luôn đến từ cấp trên: owner, hoặc admin hệ thống.
  - **Cấu hình triển khai:**
    - `POSTGRES_PASSWORD` bắt buộc;
    - `NTB_TRUSTED_PROXIES` chỉnh được (thêm đúng địa chỉ reverse proxy TLS phía trước, không bao giờ cả dải mạng);
    - `NTB_COOKIE_SECURE=true` ép cookie Secure khi chỉ truy cập qua HTTPS.
- **Lý do:** cách ly tổ chức phải đúng ở cả hai tầng, code và DB. Header và giới hạn kích thước là phòng thủ rẻ, không đổi trải nghiệm.
- **Đánh đổi:**
  - `style-src 'unsafe-inline'` vẫn còn.
  - Không đặt `limit_req` ở nginx: sau reverse proxy mọi người dùng chung một IP. Giới hạn do API làm theo IP thật.
- **Để sau / cần chốt:**
  - **Postgres RLS** (ADR-016): khoảng 4–6 ngày, cần tách role DB không phải superuser. Đề xuất làm trước khi chạy production cho nhiều khách hàng.
  - Xác nhận lại MFA (step-up) cho thao tác admin hệ thống: reset MFA, tạo link đặt lại mật khẩu, khóa tài khoản.

### ADR-047 — Lớp theo trang, L2 là chế độ xem, L3 suy ra từ IPAM, segment cho mạng dùng chung nhiều site (P2-08)
- **Bối cảnh:** P2-08 cần nhiều trang, lớp L1 / L2 / L3, segment và connector ra ngoài trang.
  - Hiện `diagrams.layer` chỉ là nhãn: vẽ L2 / L3 không khác L1.
  - Dây có một đầu không nằm trên sơ đồ bị ẩn hẳn, nên sơ đồ tầng không cho thấy uplink về core.
  - Người dùng chốt theo đề xuất ngày 2026-10-18.
- **Quyết định:**
  - **Lớp là thuộc tính của trang** trong một sơ đồ (`view.pages[].layer` ∈ `physical | l2 | l3`). Không còn mỗi lớp một sơ đồ.
    - L1 và L2 dùng chung bố cục: **L2 là chế độ xem** (lăng kính) bật / tắt ở toolbar.
      - Không đổi dữ liệu, không vào lịch sử hoàn tác.
      - Chỉ đổi cách vẽ dây và badge: màu VLAN, trunk / access / routed, gộp LAG, lọc theo VLAN, chú giải, chấm lệch VLAN.
      - Tất cả suy ra từ kho (cổng, VLAN của IPAM).
    - **L3 là trang riêng**, sinh từ IP + subnet: subnet là thanh ngang, thiết bị gắn suy ra từ IP. Chỉ lưu vị trí.
    - Sơ đồ cũ = một trang ngầm, không migrate JSONB. `diagrams.layer` giữ nghĩa: `overview` = tổng quan; còn lại = lớp của trang đầu.
  - **Một thiết bị được nằm trên nhiều trang** của cùng sơ đồ (vd core làm mốc ở mỗi trang tầng).
    - Có badge "cũng ở trang …".
    - Dây vẽ trên mọi trang có đủ hai đầu.
  - **Dây có một đầu không nằm trên trang luôn hiện connector / cuống dây**, kể cả sơ đồ cũ. Mặc định bật, tắt được.
    - Connector tự suy ra (trang khác của sơ đồ này → sơ đồ khác → chưa có trên sơ đồ nào); người dùng chỉ kéo vị trí.
  - **Segment** = đối tượng kho mới (`segments`, không gắn site) cho mạng dùng chung ≥ 3 bên: MPLS L3VPN, Metro / VPLS, LAN dùng chung.
    - Link được kết thúc ở segment, không chọn cổng.
    - Internet riêng của từng site vẫn là `provider_cloud` (ADR-033).
    - Không tự chuyển dữ liệu cũ.
  - **Thứ tự làm:** chế độ xem L2 → nhiều trang → connector ngoài trang → trang L3 → segment.
  - **Bổ sung khi làm (2026-10-18):**
    - phím: `1` / `2` chọn lớp, `PgUp` / `PgDn` chuyển trang, chỉ khi đang ở màn vẽ (Alt+số và Ctrl+PgUp/PgDn là phím của trình duyệt);
    - khi có từ hai trang trở lên, mọi node / dây / chú thích đều ghi `pageId`; dây tự thêm / bỏ theo trang có đủ hai đầu;
    - viewport lưu cùng sơ đồ là của trang đầu, các trang khác nhớ theo trình duyệt;
    - `diagrams.layer` giữ nguyên ý nghĩa cũ (không tự đồng bộ theo trang đầu); trang không tên của sơ đồ cũ mang lớp của sơ đồ;
    - `.ntb.json` 2.1.0 có `pages` / `pageId`; file 2.0.0 vẫn nhập được.
    - segment tạo / sửa thẳng vào kho từ màn vẽ (như IPAM ở panel, ADR-034), không đi qua nháp của sơ đồ; xóa được khi không còn dây nối vào;
    - dây vào segment: chỉ từ thiết bị, loại Ethernet / quang / không dây / DSL / 4G-5G / logical, không chọn cổng ở đầu segment;
    - `.ntb.json` chưa mang segment, dây vào segment, thanh subnet và vị trí connector (nối lại / bổ sung sau khi nhập).
- **Lý do:**
  - L2 của một site gần như trùng topology L1: vẽ riêng chỉ sinh hai bản lệch nhau.
  - L3 có tập node khác hẳn nên cần bố cục riêng.
  - Trang trong một sơ đồ giữ một lần lưu, một lịch sử hoàn tác, một file `.ntb.json`, và connector giữa các trang tự tính được.
  - Segment tránh n² cạnh site ↔ site trên sơ đồ tổng quan.
- **Đánh đổi:**
  - STP root không hiện được: kho không có priority. Phase 3 đọc qua SNMP.
  - Không có bảng định tuyến / OSPF / BGP trên L3.
  - Sơ đồ tổng quan giữ một trang ở P2-08.

### ADR-048 — IPAM đầy đủ (P2-09): nhập IP plan từ Excel không ghi đè, bảng IP plan trên sơ đồ, cảnh báo chồng lấn / DHCP
- **Bối cảnh:**
  - Khách thường có sẵn file Excel quy hoạch IP; file thường cũ hơn thực tế.
  - SRS §5, §7, §12 yêu cầu:
    - nhập subnet / dải từ Excel;
    - bảng IP plan đặt lên sơ đồ;
    - cảnh báo subnet chồng lấn, dải chồng nhau, IP tĩnh trong DHCP.
- **Quyết định:**
  - **Nhập Excel** (`POST /ipam-imports`, xem trước bằng `dryRun`):
    - **Cột:** nhận theo tên tiếng Việt / tiếng Anh, bỏ dấu, không phân biệt hoa thường.
    - **Ô:** hiểu các cách viết thường gặp:
      - mạng + mask tách riêng (kể cả 255.255.255.0);
      - VLAN dạng "VLAN 10 - Văn phòng";
      - dải trong một ô, kể cả viết tắt ".100-.200".
    - **Một dòng** có thể có VLAN, subnet, dải. Dải không có cột subnet thì vào subnet cụ thể nhất (cùng VRF) chứa nó.
    - **Khớp cái đã có:**
      - VLAN theo site + số; không có ở site thì dùng VLAN toàn tổ chức; không có thì tạo;
      - subnet theo VRF + CIDR;
      - dải theo đúng địa chỉ đầu / cuối.
    - **Không ghi đè:** chỉ điền chỗ IPAM còn trống (gateway, mô tả, VLAN, site). Chỗ file ghi khác IPAM thì giữ IPAM và báo trong kết quả dòng. Dải trùng biên mà khác loại cũng chỉ báo.
    - **Dòng lỗi** được hoàn tác riêng (savepoint) và bỏ qua; các dòng đúng vẫn vào.
    - Mọi ghi dùng chung kiểm tra và audit với form tay.
  - **Bảng IP plan:**
    - chú thích kiểu `ipPlan` gắn một site (server kiểm tra site thuộc tổ chức);
    - nội dung đọc trực tiếp từ IPAM: VLAN, subnet, gateway, các dải, mức dùng; xếp theo VLAN rồi subnet;
    - bỏ khối quy hoạch; tối đa 30 dòng rồi "+N".
  - **Chồng lấn subnet:**
    - CIDR chỉ có lồng nhau hoặc tách rời, và chỉ xét cùng VRF;
    - nằm trong **khối quy hoạch** (không gateway / VLAN / dải) là bình thường, chỉ ghi chú ⊂;
    - nằm trong subnet **đang dùng thật** thì cảnh báo ⚠ (thường do gõ sai mask).
  - **IP tĩnh trong dải DHCP:**
    - tính IP interface primary / secondary và IP cụm; không tính thành viên nhóm đầu cuối (máy DHCP), NAT / public, loopback / tunnel;
    - **gateway trong dải DHCP** là cảnh báo riêng;
    - hiện ở panel Problems của sơ đồ và trang subnet.
  - **Dải chồng nhau** vẫn bị API chặn; ghi dải được khóa theo subnet để hai ghi cùng lúc không cùng lọt.
- **Lý do:** file Excel là nguồn dữ liệu phụ, IPAM là nguồn sự thật — ghi đè im lặng sẽ làm sai dữ liệu đang đúng. Phân biệt khối quy hoạch với chồng lấn thật để không báo nhầm khi chia supernet.
- **Đánh đổi / để sau:**
  - Chưa có chế độ "ghi đè theo file".
  - Chưa so dải giữa subnet cha và con.
  - Chưa có khái niệm "reservation" DHCP.
  - IP quản trị cụm luôn coi là VRF mặc định.
  - Bảng IP plan chỉ theo một site.

### ADR-049 — Kiểm tra Phase 2 (P2-10): lệch VLAN / duplex, VLAN cô lập, thiếu thông tin tài sản, mật khẩu dùng chung
- **Bối cảnh:** SRS §7 các luật Phase 2. Kiểm tra vẫn chạy trong Web Worker từ ngữ cảnh server gửi, không chặn lưu.
- **Quyết định:**
  - **Lệch VLAN trên dây:** dùng chung logic với chế độ xem L2 (ADR-047). Chỉ so khi cả hai đầu là switchport; thành viên LAG lấy cấu hình của cổng LAG; mỗi cặp LAG chỉ báo một lần.
    - Cảnh báo: access khác VLAN; native khác nhau; access nối trunk mà VLAN ≠ native; LAG một đầu.
    - Ghi chú: native chỉ ghi một đầu; danh sách VLAN cho phép khác nhau. "Dải VLAN khác nhau" là ghi chú chứ không phải cảnh báo, vì một đầu giới hạn hơn là cấu hình bình thường.
  - **"VLAN thiếu trong trunk"** hiểu là **VLAN bị cô lập**: VLAN của các cổng access (có dây) trên một thiết bị mà không trunk nào có dây của thiết bị đó mang đi. Chỉ báo khi mọi trunk đều ghi danh sách cho phép.
  - **Duplex:** hai đầu khác nhau là cảnh báo (auto ↔ ép cố định là trường hợp kinh điển). Bỏ qua cổng SFP và 10G trở lên (luôn full).
  - **Thiếu thông tin:** thiết bị đang dùng, có quản lý, không phải đám mây ISP / VM / patch panel, mà thiếu S/N hoặc part number. Thiếu location chỉ báo khi site đã khai location.
  - **Mật khẩu dùng chung:** từ **5 thiết bị** trở lên là cảnh báo, mỗi mật khẩu một dòng. SNMP community được miễn (dùng chung là bình thường). Trang Kho mật khẩu đánh dấu ⚠.
- **Để sau:** ngưỡng chỉnh theo tổ chức; kiểm tra phía backend khi lưu / nhập.
