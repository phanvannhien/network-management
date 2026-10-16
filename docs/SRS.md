# Network Topology Builder — Đặc tả yêu cầu (SRS v2.0)

Cập nhật 2026-10-16. Thay đổi lớn so với v1.2: chuyển từ công cụ vẽ sơ đồ thành **hệ thống quản lý hạ tầng mạng**
(kho thiết bị, Site/Location, IPAM, sơ đồ, đối tác, kho mật khẩu, đa tổ chức). Backend + database có từ MVP.
Quyết định kiến trúc: `docs/DECISIONS.md`. Task: `docs/PLAN.md`.

---

## §1. Tổng quan

Hệ thống self-hosted giúp kỹ sư mạng và nhà tích hợp quản lý toàn bộ hạ tầng mạng: biết có thiết bị gì, ở đâu, IP gì,
nối với nhau thế nào, mua của ai, còn bảo hành không, đăng nhập bằng tài khoản nào, và (Phase 3) đang chạy hay không.

**Hai mô hình sử dụng (ADR-016):**
- **Nội bộ:** một doanh nghiệp, một tổ chức, nhiều site/chi nhánh.
- **Nhà tích hợp / MSP:** nhiều tổ chức khách hàng trên cùng một hệ thống; nhân viên MSP làm việc ở nhiều tổ chức,
  người của khách hàng chỉ thấy tổ chức mình.

**Người dùng:** kỹ sư mạng / sysadmin; nhân viên MSP; presales / tư vấn; quản lý / khách hàng (chỉ xem).

**Nguyên tắc dữ liệu (ADR-015):** database là nguồn sự thật. Thiết bị, interface, IP, link tồn tại độc lập; sơ đồ là góc nhìn
lên dữ liệu đó. Sửa IP ở sơ đồ hay ở danh sách thiết bị đều là sửa cùng một bản ghi.

## §2. Giao diện tổng & điều hướng (ADR-020)

**Thanh trên cùng:** bộ chọn tổ chức (khi user thuộc nhiều tổ chức), tìm kiếm toàn cục (Ctrl+K: hostname, IP, MAC, S/N,
part number, tên site, đối tác), thông báo (sắp hết hạn, cảnh báo), menu tài khoản.

**Menu trái (thu gọn được):**

| Module | Nội dung | Phase |
| --- | --- | --- |
| Dashboard | Tổng số thiết bị theo site/loại, cảnh báo hết hạn, vấn đề validation, (P3) thiết bị down | 1 |
| Sơ đồ | Danh sách sơ đồ theo site, mở màn hình vẽ | 1 |
| Thiết bị | Bảng kho thiết bị, lọc/sắp xếp/cột tùy chọn, chi tiết thiết bị | 1 |
| IPAM | VLAN, Subnet, dải IP, mức sử dụng | 1 |
| Sites | Site → tòa nhà → tầng → phòng → rack | 1 |
| Đối tác | Nhà cung cấp, hãng, ISP, đơn vị bảo trì; liên hệ; hợp đồng | 2 |
| Kho mật khẩu & Cloud | Credential thiết bị, tài khoản cloud | 2 |
| Giám sát | Trạng thái live, SNMP profile | 3 |
| Báo cáo | Báo cáo dựng sẵn, export Excel/PDF | 2 |
| Quản trị | Người dùng, vai trò, link chia sẻ, audit log, cài đặt tổ chức, SSO, SMTP | 1 (cơ bản) / 2 |

**Màn hình vẽ:** menu trái tự thu gọn; canvas chiếm tối đa.
- **Thanh công cụ nổi phía trên** (kiểu Photoshop): Chọn, Pan, Nối dây (L), Text, Mũi tên, Zone/Group, Thư viện, Layer, Zoom, Undo/Redo, Lưu, Export.
- **Panel thư viện nổi** (kéo được, ẩn/hiện bằng phím tắt): tab "Thiết bị mới" (template theo nhóm, tìm kiếm, Favorites, Recently used)
  và tab "Trong kho chưa vẽ" (thiết bị của site đã có trong kho nhưng chưa có trên sơ đồ này).
- **Thêm nhanh:** nhấn `/` hoặc double-click canvas → ô tìm kiếm → Enter để đặt thiết bị.
- **Panel thuộc tính** bên phải; **panel Problems** phía dưới (thu gọn được).

## §3. Tổ chức, Site, Location

- **Organization:** tên, loại (internal/customer), logo, ghi chú, cấu hình riêng (SMTP nhận cảnh báo, chu kỳ SNMP).
- **Site:** mã site, tên, địa chỉ, múi giờ, người liên hệ tại chỗ, ghi chú.
- **Location:** cây phân cấp trong site: tòa nhà → tầng → phòng/tủ. Không dùng ô gõ tự do để tránh "Tầng 3"/"T3"/"Floor 3".
- **Rack:** thuộc location, số U (mặc định 42), view mặt trước với thiết bị chiếm U.

## §4. Kho thiết bị

### 4.1 Thuộc tính thiết bị

| Nhóm | Trường |
| --- | --- |
| Nhận dạng | Hostname (bắt buộc, duy nhất trong tổ chức), loại, hãng, model, **Part Number**, **Serial Number**, asset tag, firmware/OS version |
| Vị trí | **Site**, **Location**, rack + vị trí U + chiều cao U |
| Quản trị | Interface quản trị (IP quản trị suy ra từ đây), IP NAT/public, gateway, DNS, `poll_address` |
| Mua sắm | Nhà cung cấp (→ Đối tác), ngày mua, số PO/hóa đơn |
| Hỗ trợ | Hợp đồng support (→ Hợp đồng), ngày hết bảo hành, ngày hết license, ngày End-of-Life/End-of-Support của hãng |
| Truy cập | Credential đăng nhập (SSH/HTTPS/console/enable… → Kho mật khẩu), tài khoản cloud quản lý (→ Tài khoản cloud) |
| Vận hành | Vai trò (core/distribution/access/edge…), trạng thái vòng đời, `managed` (của mình / bên ngoài), người phụ trách, ghi chú |
| Giám sát (P3) | Bật giám sát, SNMP profile, poller, thiết bị phụ thuộc |
| Mở rộng | Tag, custom fields (khai báo theo tổ chức: tên, kiểu, bắt buộc hay không) |

**Trạng thái vòng đời:** planned (dự kiến) → active (đang dùng) → spare (dự phòng/trong kho) → rma (đang bảo hành) → retired (đã thanh lý).

**Danh sách thiết bị:** bảng lọc theo site/location/loại/hãng/trạng thái/tag, chọn cột hiển thị, sửa hàng loạt, export Excel.
Trang chi tiết thiết bị có tab: Tổng quan · Interfaces · IP · Kết nối · Truy cập · Hợp đồng & bảo hành · Sơ đồ có thiết bị này · Lịch sử thay đổi.

### 4.2 Interface (ADR-012)

Loại: physical | svi | loopback | tunnel | subinterface | lag. Template thiết bị sinh cổng physical; người dùng thêm interface ảo.

Thuộc tính: tên, loại, media (RJ45/SFP/SFP+/SFP28/QSFP/Serial/Radio/Console), tốc độ/duplex, mode (access/trunk/routed/hybrid),
access VLAN, allowed VLANs, native VLAN, PoE, LAG cha, mô tả, admin status, (P3) ifIndex. Một interface có nhiều IP (CIDR, IPv4/IPv6, VRF).

### 4.3 Thư viện & template

| Nhóm | Thiết bị |
| --- | --- |
| Core & Routing | Router, L3 Switch, Load Balancer, Wireless Controller |
| Access & Switching | L2 Switch, PoE Switch, Hub, Access Point, Media Converter, Patch Panel |
| Security | Firewall, IDS/IPS, VPN Gateway, WAF, NAC, Proxy |
| End Devices | PC, Laptop, Server, IP Camera, NVR/DVR, Printer, NAS, IP Phone, PBX, Access Control, Video conference, IoT, VM |
| Cloud & WAN | Cloud, Internet, Modem, ISP, MPLS cloud, SD-WAN edge, ONT/OLT |
| Khác | Endpoint group, Segment/Bus (P2), Zone, Rack, UPS/PDU, Text, Mũi tên |

Template: icon, hãng/model mặc định, part number, port layout. Model library theo hãng (Cisco, Juniper, Fortinet, Aruba, MikroTik,
Ubiquiti, TP-Link, Hikvision, Dahua…) ở Phase 2; người dùng tự tạo template; custom icon SVG/PNG ≤ 200 KB.

### 4.4 Nhóm thiết bị đầu cuối (ADR-013, ADR-014)

`endpoint_group`: loại, tên, site, dải IP (→ ip_range), số lượng dự kiến; thành viên: tên, IP, MAC, cổng switch đang cắm, ghi chú.
Hiển thị một icon với badge "đã dùng/tổng" (vd 3/20). Thành viên có thể tách thành thiết bị riêng.

## §5. IPAM (ADR-014)

- **VLAN:** ID, tên, màu, site/phạm vi, subnet gắn kèm. Màu VLAN dùng chung cho mọi sơ đồ.
- **Subnet:** CIDR, gateway, VRF, site, VLAN, mô tả.
- **Dải IP (quy hoạch):** start, end, loại (dhcp/static/reserved), mục đích, VLAN. Bảng IP plan sinh tự động, đặt được lên sơ đồ.
- **Ba cấp IP:** quy hoạch (dải) → khai báo (IP của interface, IP của thành viên nhóm) → thực tế (P3, ARP + bảng MAC qua SNMP).
- Mức sử dụng subnet/dải (tính toán), gợi ý IP trống tiếp theo, tìm IP thuộc thiết bị nào.
- Switch hiển thị các dải/VLAN nó phục vụ (suy ra từ link tới nhóm thiết bị).

## §6. Sơ đồ (editor)

### 6.1 Canvas
- Zoom 10–400%, pan (Space + kéo, chuột giữa), Fit to screen, minimap; grid snap 10/20/40 px, smart guides, Align & Distribute.
- Chọn: click, Shift + click, rubber-band, Ctrl+A; duplicate, lock, sửa hàng loạt; copy/paste giữ link nội bộ, tự đổi hostname trùng.
- Undo/redo ≥ 100 bước (gộp thao tác kéo). Auto-layout phân tầng. Tìm thiết bị trên sơ đồ (Ctrl+F).
- Layer: Physical / Logical L2 / Logical L3 (P2). Nhiều trang + off-page connector (P2).
- Một sơ đồ thuộc một site (hoặc nhiều site cho sơ đồ WAN/VPN). Một thiết bị có thể nằm trên nhiều sơ đồ.

### 6.2 Kết nối

| Loại | Biến thể | Kiểu nét | Đầu mút hợp lệ |
| --- | --- | --- | --- |
| Ethernet | Cat5e, Cat6, Cat6A | Liền | Cổng RJ45 |
| Fiber | SM, MM (OM3/OM4), DAC | Liền, dày | SFP, SFP+, SFP28, QSFP |
| Wireless | Wi-Fi 5/6/7, bridge P2P | Đứt + biểu tượng sóng | Radio |
| Serial | V.35, RS-232 | Zigzag | Serial |
| Logical | VPN/IPsec, GRE, MPLS, LAG | Đứt | Interface tunnel / không chiếm cổng vật lý |
| Console | Console/OOB | Chấm | Console |

- Link nối port → port khi biết cổng; nối thiết bị → thiết bị (chưa gán cổng) cho sơ đồ mức logic, gán cổng sau (ADR-013).
- Đầu mút có thể là device, endpoint group hoặc segment.
- Kéo dây: popup chọn cổng trống hợp lệ (cổng đã dùng/sai loại làm mờ); kéo lại đầu dây để đổi cổng.
- Hình dạng: thẳng, orthogonal, cong; điểm uốn; link song song tự tách.
- Thuộc tính link: loại cáp, tốc độ, chiều dài, cable ID, trạng thái, vòng đời; với WAN: nhà cung cấp (→ Đối tác), circuit ID, băng thông, hợp đồng.
- Hiển thị tốc độ (độ dày nét) và trạng thái Up/Down/Planned; màu luôn kèm icon/kiểu nét.

### 6.3 Hiển thị
- Label template dưới icon (`{hostname}\n{mgmtIp}`, có thể thêm `{model}`, `{site}`…); màu nền label theo thiết bị/loại.
- Tên cổng hai đầu link + tốc độ; ẩn label phụ khi zoom < 50%; tooltip khi hover.
- Thiết bị `managed=false` hiển thị viền nét đứt.
- Annotation: text (màu, cỡ chữ), mũi tên, zone có nền màu; bảng IP plan / legend đặt lên sơ đồ.
- Click thiết bị → panel thuộc tính (sửa nhanh) + nút mở trang chi tiết đầy đủ.

### 6.4 Phím tắt

| Thao tác | Phím |
| --- | --- |
| Undo / Redo | Ctrl+Z / Ctrl+Shift+Z |
| Copy / Paste / Duplicate | Ctrl+C / Ctrl+V / Ctrl+D |
| Xóa khỏi sơ đồ / xóa khỏi kho | Delete / Shift+Delete (có xác nhận) |
| Chọn tất cả | Ctrl+A |
| Group / Ungroup | Ctrl+G / Ctrl+Shift+G |
| Fit to screen | Shift+1 |
| Nối dây | L |
| Thêm nhanh thiết bị | / |
| Ẩn/hiện thư viện | B |
| Lưu | Ctrl+S |
| Tìm trên sơ đồ / toàn cục | Ctrl+F / Ctrl+K |
| Bảng phím tắt | ? |

Lưu ý: xóa một node khỏi sơ đồ KHÔNG xóa thiết bị khỏi kho; xóa khỏi kho là thao tác riêng.

## §7. Validation

Chạy trong Web Worker khi đang vẽ (debounce 300 ms) và chạy ở backend khi lưu/import. Kết quả ở panel Problems và trang thiết bị;
click → zoom tới đối tượng; badge trên node.

| Quy tắc | Mức | Phase |
| --- | --- | --- |
| IP sai định dạng / là network hoặc broadcast | Error | 1 |
| Trùng IP trong cùng VRF (mọi interface + IP NAT/public + thành viên nhóm) | Error | 1 |
| Trùng hostname trong tổ chức; trùng serial number | Error | 1 |
| Một cổng vật lý có > 1 link | Error | 1 |
| Link vật lý nối vào interface ảo | Error | 1 |
| Nối sai loại cổng (RJ45 ↔ SFP) | Warning | 1 |
| Gateway không thuộc subnet của host | Warning | 1 |
| Hai đầu link L3 khác subnet | Warning | 1 |
| IP thành viên nằm ngoài dải của nhóm | Warning | 1 |
| Thiết bị không có link; link chưa gán cổng; có IP nhưng chưa chọn interface quản trị; dải IP đã đầy | Info | 1 |
| Access VLAN hai đầu khác nhau; VLAN thiếu trong trunk; speed/duplex mismatch | Warning | 2 |
| Subnet chồng lấn; dải IP chồng nhau; IP tĩnh nằm trong dải DHCP | Warning | 2 |
| Thiết bị active nhưng thiếu S/N, part number, site hoặc location | Info | 2 |
| Nhiều thiết bị dùng chung một credential | Warning | 2 |
| Lệch thiết kế ↔ thực tế (cổng down, sai cổng theo LLDP, IP chạy thật chưa khai báo) | Warning | 3 |
| Vượt PoE budget; vòng lặp L2 | Warning / Info | 4 |

## §8. Đối tác & hợp đồng (Phase 2)

- **Đối tác:** loại (hãng, nhà cung cấp, ISP, bảo trì, khách hàng, khác), tên, mã số thuế, website, hotline/portal support, ghi chú.
- **Liên hệ:** tên, chức vụ, điện thoại, email, ghi chú (thuộc đối tác).
- **Hợp đồng:** đối tác, loại (support/bảo hành hãng, license, ISP, bảo trì), số hợp đồng, ngày bắt đầu/kết thúc, SLA, file đính kèm,
  thiết bị/link được áp dụng.
- Từ thiết bị hoặc link WAN bấm ra ngay hotline, liên hệ và hợp đồng liên quan.

## §9. Kho mật khẩu & tài khoản cloud (Phase 2, ADR-018)

**Credential:** tên, loại (ssh, telnet, https/web, console, enable, snmp, api), username, bí mật, kiểu lưu:
- **local:** mã hóa envelope AES-256-GCM, master key ở env.
- **external:** tham chiếu kho ngoài (Bitwarden/Vaultwarden, HashiCorp Vault, khác) + item ID/path + URL mở nhanh.

Gắn credential với một hoặc nhiều thiết bị (kèm mục đích). Chu kỳ đổi mật khẩu đề xuất và ngày đổi gần nhất.

**Tài khoản cloud:** nhà cung cấp (FortiCloud, TP-Link Omada, UniFi, Meraki, Aruba Central, Hikvision Hik-Connect, khác), URL portal,
username, credential (local/external), người giữ thiết bị MFA, gói dịch vụ, ngày hết hạn, đối tác liên quan; danh sách thiết bị được quản lý bởi tài khoản.

**An toàn:**
- Bí mật mặc định che; "Hiện"/"Copy" cần quyền `credential.reveal` + MFA trong 5 phút gần nhất; mỗi lần ghi audit (ai, khi nào, credential nào, IP).
- Clipboard tự xóa sau 30 giây. Bí mật không có trong API danh sách, export, log, audit log, link chia sẻ.
- Cảnh báo: credential quá hạn đổi; một credential dùng cho nhiều thiết bị.

## §10. Người dùng, phân quyền, chia sẻ, audit (ADR-019)

- **Đăng nhập:** email/password (argon2id), session cookie HttpOnly + SameSite; TOTP MFA (bắt buộc với owner/admin và người có quyền xem mật khẩu);
  khóa tạm sau nhiều lần sai; đặt lại mật khẩu qua email (khi có SMTP). SSO OIDC (Entra ID, Google Workspace, Keycloak) ở Phase 2.
- **Vai trò theo tổ chức:** owner (toàn quyền, quản lý thanh toán/cài đặt), admin (quản lý user, dữ liệu), editor (sửa dữ liệu), viewer (chỉ xem).
  Quyền bổ sung: `credential.reveal`, `credential.manage`, `user.manage`. Giới hạn phạm vi theo site (tùy chọn).
- **System admin:** quản trị toàn hệ thống (tạo tổ chức, sao lưu, cài đặt chung); dành cho bên vận hành hệ thống/MSP.
- **Link chia sẻ chỉ xem (P2):** cho một sơ đồ, token có hạn, tùy chọn mật khẩu, tùy chọn ẩn IP; thu hồi được.
- **Audit log:** mọi thao tác ghi (trước/sau), đăng nhập, xem mật khẩu, export; lọc theo người/thời gian/đối tượng; giữ tối thiểu 1 năm.

## §11. Giám sát SNMP (Phase 3)

**Credential profile:** SNMP v2c và v3 (auth SHA/SHA-256, priv AES-128/256), lưu trong kho mật khẩu.

**Gắn thiết bị:** bật giám sát, profile, poller dùng `poll_address` (fallback IP quản trị). "Test SNMP" đọc sysName/sysDescr và hiển thị địa chỉ đã dùng.
Interface tự map ifIndex qua ifName/ifDescr (gồm interface ảo: Vlan, Loopback, tunnel), sửa tay được.

| Mục đích | OID / MIB |
| --- | --- |
| Nhận dạng, uptime | sysName, sysDescr, sysUpTime (SNMPv2-MIB) |
| Serial, part number (đối chiếu kho) | ENTITY-MIB entPhysicalSerialNum, entPhysicalModelName |
| Danh sách cổng | ifName, ifDescr, ifAlias (IF-MIB) |
| Trạng thái, tốc độ | ifOperStatus, ifAdminStatus, ifHighSpeed |
| Lưu lượng, lỗi | ifHCInOctets, ifHCOutOctets, ifInErrors, ifOutErrors |
| ARP (IP ↔ MAC) | IP-MIB ipNetToPhysicalTable (fallback ipNetToMediaTable) |
| Bảng MAC theo cổng | Q-BRIDGE-MIB dot1qTpFdbTable (fallback BRIDGE-MIB dot1dTpFdbTable), dot1dBasePortIfIndex |
| Láng giềng | LLDP-MIB lldpRemTable |

**Poller:** goroutine pool, chu kỳ mặc định 60 s (theo tổ chức), timeout 2 s, retry 1, giới hạn đồng thời; BULKWALK cho bảng.
Utilization = Δoctets × 8 / Δt / ifHighSpeed. Không trả lời 3 chu kỳ → unreachable.

**Nhiều site / VPN (ADR-011):** poller trung tâm cần route tới subnet quản trị từng site. `depends_on_device_id`: cha unreachable → con "unknown".
Trạng thái: up / down / unreachable / unknown / not monitored. Dải quản trị trùng giữa các site → NAT + `poll_address`, hoặc remote poller (P4).

**Lưu trữ:** device_status, interface_status (mới nhất); interface_metrics (giữ 7 ngày); quan sát ARP/MAC (mới nhất + lần thấy cuối).

**Giao diện:** công tắc Design ↔ Live trên sơ đồ; màu link theo trạng thái thật; % utilization (70% vàng, 90% đỏ); badge unreachable; last seen;
panel "IP thực tế" so với khai báo; Dashboard có danh sách thiết bị down.

**An toàn:** chỉ đọc; không poll thiết bị chưa bật giám sát.

## §12. Import, export, báo cáo, cảnh báo

**Import (Phase 1):** Excel/CSV thiết bị (site, location, hostname, loại, hãng, model, part number, S/N, IP quản trị, ngày bảo hành…)
với bước ánh xạ cột, xem trước, báo lỗi từng dòng, chế độ tạo mới/cập nhật theo hostname hoặc S/N. File mẫu Excel tải về được.
Import subnet/dải IP từ Excel (P2). Import `.ntb.json` (P1). Import draw.io (P4).

**Export:** PNG/SVG sơ đồ có legend (P1); `.ntb.json` một site/sơ đồ, không có bí mật (P1); Excel danh sách thiết bị (P1);
PDF sơ đồ A4/A3 có title block (P2); Excel IP plan, port map, BOQ, VLAN (P2); Design Document tổng hợp (P4).

**Báo cáo (P2):** thiết bị theo site/loại/hãng; thiết bị sắp hết bảo hành/license/EoL (30/60/90 ngày); IP plan; thiết bị thiếu thông tin; hợp đồng sắp hết hạn.

**Cảnh báo hết hạn (P2):** bảo hành, license, gói cloud, hợp đồng, credential quá hạn đổi → thông báo trong app + email (SMTP tự cấu hình) theo mốc 90/60/30/7 ngày.

## §13. Data model

PostgreSQL, dữ liệu quan hệ. Mọi bảng nghiệp vụ có `id` (UUID), `organization_id`, `created_at`, `updated_at`, `version` (optimistic lock).

| Nhóm | Bảng chính |
| --- | --- |
| Hệ thống & người dùng | organizations, users, memberships (user, org, role, permissions, site_scope), sessions, mfa_totp, sso_providers (P2), share_links (P2), audit_log |
| Vị trí | sites, locations (parent_id, kind: building/floor/room), racks |
| Kho | device_types/templates, devices, interfaces, ip_addresses (interface_id hoặc device_id, address, vrf, role: primary/secondary/nat/public), custom_field_defs, tags |
| IPAM | vlans, subnets, ip_ranges |
| Sơ đồ logic | endpoint_groups, endpoint_members, segments (P2), links (a_kind, a_id, a_interface_id null được; b_…; kind, medium, speed, status…) |
| Sơ đồ hiển thị | diagrams (site_id, name, layer, view JSONB: nodes {refKind, refId, x, y, labelStyle, locked}, edges {linkId, routing, waypoints}, annotations, viewport, labelTemplate) |
| Đối tác (P2) | partners, partner_contacts, contracts, contract_items (device/link) |
| Kho mật khẩu (P2) | credentials (storage: local/external, ciphertext, wrapped_dek, external_provider, external_ref), device_credentials, cloud_accounts, device_cloud_accounts |
| Cảnh báo (P2) | notifications, notification_rules |
| Giám sát (P3) | snmp_profiles, device_status, interface_status, interface_metrics, arp_observations, fdb_observations |

**File `.ntb.json`** (export/import, `schema/ntb.schema.json`): gói một site hoặc sơ đồ gồm thiết bị, interface, IP, VLAN, subnet, dải, nhóm, link, sơ đồ;
không có bí mật (chỉ tên credential nếu chọn); có `schemaVersion`.

## §14. Yêu cầu phi chức năng

**Hiệu năng:**

| Chỉ tiêu | Mục tiêu |
| --- | --- |
| Sơ đồ 500 thiết bị + 1.000 link | kéo thả ≥ 50 FPS; mở < 2 s |
| Sơ đồ tối đa | 2.000 thiết bị + 4.000 link |
| Kho thiết bị | 50.000 thiết bị / hệ thống; bảng danh sách phân trang server, lọc < 500 ms |
| Tìm kiếm toàn cục | < 300 ms |
| Phản hồi click/chọn | < 100 ms |
| Import Excel 5.000 dòng | < 30 s, có tiến trình |
| SNMP poll 200 thiết bị | xong trong 1 chu kỳ 60 s |

**Bảo mật:** HTTPS qua reverse proxy; header bảo mật (CSP, HSTS…); CSRF cho cookie session; rate limit đăng nhập và API;
cách ly dữ liệu giữa tổ chức (test bắt buộc); bí mật mã hóa, master key chỉ ở env/secret file; audit log; không telemetry;
review bảo mật trước khi bật kho mật khẩu.

**Vận hành:** Docker Compose (`web`, `api`, `db`); backup `pg_dump` hằng ngày + hướng dẫn khôi phục (backup DB không chứa master key — phải giữ riêng);
chạy được trong mạng không có Internet; healthcheck; log JSON; tài liệu cài đặt/nâng cấp.

**UI/UX:** Dark/Light/System; tiếng Việt + Anh; WCAG AA; trạng thái không chỉ bằng màu; dùng được bằng bàn phím;
Chrome/Edge/Firefox/Safari 2 bản mới nhất; màn hình ≥ 1280 px (tablet chỉ xem).

## §15. Kiến trúc & stack

```
Trình duyệt ── React SPA
   App shell (menu module, org switcher, Ctrl+K) · Modules (Thiết bị, IPAM, Sites, Đối tác, Kho mật khẩu, Quản trị)
   Editor sơ đồ (Zustand + commands + React Flow + Web Worker validation)
   TanStack Query ◄── client sinh từ api/openapi.yaml
        │ HTTPS /api  (+ SSE /api/live ở P3)
Nginx ──┤
        ▼
Go binary `ntb`
   ├─ HTTP API (chi + oapi-codegen): auth/MFA/RBAC, tenant middleware, inventory, ipam, diagrams,
   │  import/export, partners, vault, audit, notify
   └─ (P3) SNMP poller (goroutine pool, gosnmp) ──► thiết bị (UDP 161)
        │ pgx + sqlc
        ▼
PostgreSQL 16
```

| Thành phần | Lựa chọn |
| --- | --- |
| Frontend | React 19, TypeScript, Vite, react-router, TanStack Query, Zustand + Immer, shadcn/ui + Tailwind |
| Canvas | @xyflow/react |
| Hợp đồng API | OpenAPI 3.1 → oapi-codegen (Go), openapi-typescript/openapi-fetch (TS) |
| Backend | Go, chi, pgx v5, sqlc, golang-migrate, slog |
| Bảo mật | argon2id, TOTP (pquerna/otp), AES-256-GCM envelope, OIDC (coreos/go-oidc, P2) |
| Import/Export | SheetJS, html-to-image, jsPDF + svg2pdf.js (P2), JSON Schema (ajv / santhosh-tekuri/jsonschema) |
| SNMP | gosnmp (P3) |
| Test | Vitest, Playwright, go test, Postgres trong Docker cho test tích hợp, snmpsim (P3) |
| Deploy | Docker Compose + Nginx |

## §16. Roadmap & nghiệm thu

| Phase | Nội dung | Gate |
| --- | --- | --- |
| 0 | Khung repo, Compose (web+api+db), OpenAPI + sinh code, migration, lint/test | `make check` pass, đăng nhập được trong Docker |
| 1 — MVP | Auth + MFA cơ bản, tổ chức + vai trò, Sites/Location/Rack, kho thiết bị + interface + IP, IPAM cơ bản, editor sơ đồ gắn kho, validation, import Excel thiết bị, export PNG/SVG/JSON/Excel, audit log, tìm kiếm toàn cục, dashboard cơ bản | Checklist bên dưới |
| 2 — Enterprise | Kho mật khẩu & cloud, Đối tác & hợp đồng, cảnh báo hết hạn + email, link chia sẻ, SSO OIDC, báo cáo PDF/Excel, multi-page, layer, segment, IPAM đầy đủ, model library | Review bảo mật kho mật khẩu & phân quyền đạt |
| 3 — Giám sát | SNMP profile, poller, ifIndex, SSE, UI live, ARP/MAC, LLDP, phụ thuộc site | Poll 200 thiết bị/60 s, đúng với snmpsim |
| 4 | Backup cấu hình qua SSH (chỉ đọc), remote poller, cộng tác realtime, API token công khai, import draw.io, desktop | — |

**Checklist nghiệm thu MVP**
- [ ] Tạo 2 tổ chức; user tổ chức A không thấy bất kỳ dữ liệu nào của tổ chức B (test tự động + kiểm tra tay)
- [ ] Owner/admin bật MFA; viewer không sửa được gì (kiểm tra ở API, không chỉ ở giao diện)
- [ ] Tạo site → location → rack; thêm thiết bị đủ Site, Location, Hostname, Part Number, S/N
- [ ] Import file Excel 500 thiết bị, có báo lỗi từng dòng
- [ ] Vẽ lại được sơ đồ mẫu văn phòng (FortiGate, VPN tới 3 site đối tác, 5 switch, nhóm IP Phone 3/20, chú thích)
- [ ] Sửa IP ở danh sách thiết bị → sơ đồ cập nhật; sửa trên sơ đồ → danh sách cập nhật
- [ ] Phát hiện trùng IP, trùng hostname/S/N, gateway sai subnet, sai loại cổng, IP ngoài dải
- [ ] Sơ đồ 500 thiết bị + 1.000 link: kéo ≥ 50 FPS, mở < 2 s
- [ ] Mọi thao tác ghi có trong audit log
- [ ] Export PNG/SVG có legend; export Excel danh sách thiết bị; export/import `.ntb.json` không mất dữ liệu
- [ ] Ctrl+K tìm được theo IP, S/N, hostname
- [ ] Dark/Light đạt WCAG AA

**Câu hỏi còn mở:** quy mô sơ đồ lớn nhất; số tổ chức/thiết bị dự kiến; hãng/model ưu tiên cho model library;
SSO doanh nghiệp nào cần trước; team và deadline MVP; có cần đa ngôn ngữ ngoài Việt/Anh.
