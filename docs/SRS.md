# Network Topology Builder — Đặc tả yêu cầu (SRS v1.2)

Cập nhật 2026-10-15. Thay đổi so với v1.1: backend Go + PostgreSQL thuần, triển khai self-hosted bằng Docker Compose,
thêm §11 giám sát SNMP. Quyết định kiến trúc chi tiết: `docs/DECISIONS.md`. Task: `docs/PLAN.md`.

---

## §1. Tổng quan

Ứng dụng web self-hosted cho kỹ sư mạng: kéo thả thiết bị, nối dây port → port, khai báo thông số,
kiểm tra lỗi thiết kế, xuất sơ đồ làm tài liệu kỹ thuật, và (Phase 3) hiển thị trạng thái thật qua SNMP.

**Người dùng:** kỹ sư mạng / sysadmin (vẽ, cấu hình, giám sát); presales / tư vấn (hồ sơ thiết kế, BOQ); quản lý / khách hàng (chỉ xem).

**Phạm vi MVP (Phase 1):** thư viện thiết bị, canvas (zoom/pan/snap/multi-select/undo-redo), nối dây port → port,
panel thuộc tính, label, validation cơ bản, Save/Load JSON, autosave, export PNG/SVG, Dark/Light. Chạy hoàn toàn trong trình duyệt.

**Sau MVP:** backend Go + Postgres, đăng nhập, phiên bản, VLAN/IPAM, multi-page, PDF/Excel (Phase 2);
SNMP live (Phase 3); cộng tác realtime, import, phân tích, desktop app (Phase 4).

## §2. Thư viện thiết bị

| Nhóm | Thiết bị |
| --- | --- |
| Core & Routing | Router, L3 Switch, Load Balancer, Wireless Controller |
| Access & Switching | L2 Switch, PoE Switch, Hub, Access Point, Media Converter, Patch Panel |
| Security | Firewall, IDS/IPS, VPN Gateway, WAF, NAC, Proxy |
| End Devices | PC, Laptop, Server, IP Camera, NVR/DVR, Printer, NAS, IP Phone, IoT, VM |
| Cloud & WAN | Cloud, Internet Gateway, Modem, ISP, MPLS cloud, SD-WAN edge, ONT/OLT |
| Khác | Text note, Zone, Rack, UPS/PDU |

- **Device template:** icon, vendor/model mặc định, port layout (vd 24×RJ45 Gi1/0/1–24 + 4×SFP+ Te1/1/1–4). Người dùng lưu thiết bị đã cấu hình thành template riêng.
- **Model library theo hãng (Phase 2):** Cisco, Juniper, Fortinet, Aruba, MikroTik, Ubiquiti, Hikvision, Dahua… chọn model → tự sinh port list.
- **Tùy biến:** custom icon SVG/PNG ≤ 200 KB nhúng trong file dự án; tìm kiếm, Favorites, Recently used.
- **Group:** Zone/Area (khung tự do), Subnet (gắn CIDR, kiểm tra IP thành viên), Rack (42U, thiết bị chiếm số U). Lồng nhau, thu gọn được.

## §3. Canvas

- Zoom 10–400% (Ctrl + cuộn / pinch), pan (Space + kéo, chuột giữa), Fit to screen, minimap.
- Grid snap bật/tắt, lưới 10/20/40 px, smart guides, Align & Distribute.
- Chọn: click, Shift + click, rubber-band, Ctrl+A. Duplicate, lock, sửa hàng loạt thuộc tính.
- Copy/paste giữ link giữa các thiết bị được copy cùng nhau, tự đổi hostname trùng.
- Undo/redo ≥ 100 bước, gộp thao tác kéo liên tục.
- Layer: Physical (L1), Logical L2 (màu VLAN, trunk/access), Logical L3 (subnet, IP). Bật/tắt từng loại label.
- Multi-page/site, off-page connector (Phase 2). Auto-layout phân tầng Core → Distribution → Access. Tìm thiết bị theo hostname/IP.

| Thao tác | Phím |
| --- | --- |
| Undo / Redo | Ctrl+Z / Ctrl+Shift+Z |
| Copy / Paste / Duplicate | Ctrl+C / Ctrl+V / Ctrl+D |
| Xóa | Delete / Backspace |
| Chọn tất cả | Ctrl+A |
| Group / Ungroup | Ctrl+G / Ctrl+Shift+G |
| Fit to screen | Shift+1 |
| Chế độ nối dây | L |
| Lưu | Ctrl+S |
| Tìm thiết bị | Ctrl+F |
| Bảng phím tắt | ? |

## §4. Kết nối

Link luôn nối **port → port**.

| Loại | Biến thể | Kiểu nét | Cổng hợp lệ |
| --- | --- | --- | --- |
| Ethernet | Cat5e, Cat6, Cat6A | Liền | RJ45 |
| Fiber | SM, MM (OM3/OM4), DAC | Liền, dày | SFP, SFP+, SFP28, QSFP |
| Wireless | Wi-Fi 5/6/7, bridge P2P | Đứt + biểu tượng sóng | Radio |
| Serial | V.35, RS-232 | Zigzag | Serial |
| Logical | VPN/IPsec, GRE, MPLS, LAG | Đứt | Không chiếm cổng vật lý |
| Console | Console/OOB | Chấm | Console |

- Kéo dây: hover hiện handle → kéo tới thiết bị đích → popup chọn cổng trống hợp lệ (cổng đã dùng/sai loại bị làm mờ) → không chọn thì tự gán cổng trống đầu tiên cùng loại. Kéo lại đầu dây để đổi cổng.
- Hình dạng: thẳng, orthogonal, cong; điểm uốn thủ công; link song song tự tách.
- Hiển thị tốc độ (100M–100G, độ dày nét tăng theo tốc độ) và trạng thái Up (xanh) / Down (đỏ) / Admin down–Planned (xám, nét đứt). Màu luôn đi kèm icon/kiểu nét.
- Trạng thái vòng đời thiết bị/link: Existing / Planned / To be removed.
- Trạng thái link do người dùng khai báo (Design mode) hoặc lấy từ SNMP (Live mode, §11).

## §5. Thuộc tính

Ba cấp: **Device → Interface → Link**. IP và VLAN gắn ở interface; device có Management IP để hiển thị.

**Device:** hostname (bắt buộc, duy nhất), loại, hãng, model, serial, OS/firmware; management IP, gateway, DNS, VLAN quản trị;
site, tầng/phòng, rack + U; vai trò, vòng đời, ghi chú; bảo hành, công suất (W), PoE budget, custom fields; (Phase 3) SNMP profile.

**Interface:** tên, loại vật lý, tốc độ/duplex, mode (access/trunk/routed/hybrid), access VLAN, allowed VLANs, native VLAN,
IP (CIDR, nhiều IP, sub-interface), PoE, LAG, mô tả, admin status; (Phase 3) ifIndex.

**Link:** loại cáp, tốc độ, chiều dài (m), cable ID, trạng thái, bandwidth thuê, nhà cung cấp + circuit ID, ghi chú.

**Hiển thị:** label template dưới icon (`{hostname}\n{mgmtIp}`); tên cổng hai đầu link + tốc độ ở giữa; ẩn label phụ khi zoom < 50%;
hover → tooltip; click → sidebar phải (General / Interfaces / Links / Notes). Tab Interfaces dạng bảng + mặt trước thiết bị.

**Quản lý tập trung:** panel VLAN (ID, tên, màu, subnet) và Subnet/IPAM (CIDR, gateway, DHCP range, % dùng, gợi ý IP trống).

## §6. Validation

Chạy trong Web Worker, debounce 300 ms. Kết quả ở panel Problems; click → zoom tới đối tượng; badge trên node.

| Quy tắc | Mức | Phase |
| --- | --- | --- |
| IP sai định dạng / là network hoặc broadcast | Error | 1 |
| Trùng IP trong cùng VRF | Error | 1 |
| Trùng hostname | Error | 1 |
| Một cổng vật lý có > 1 link | Error | 1 |
| Nối sai loại cổng (RJ45 ↔ SFP) | Warning | 1 |
| Gateway không thuộc subnet của host | Warning | 1 |
| Hai đầu link L3 khác subnet | Warning | 1 |
| Thiết bị không có link | Info | 1 |
| Access VLAN hai đầu khác nhau; VLAN thiếu trong trunk | Warning | 2 |
| Speed/duplex mismatch | Warning | 2 |
| Subnet chồng lấn | Warning | 2 |
| Thiết kế khác thực tế SNMP (cổng down, sai cổng theo LLDP) | Warning | 3 |
| Vượt PoE budget; vòng lặp L2 | Warning / Info | 4 |

## §7. Data model (file `.ntb.json`)

Schema chuẩn: `schema/ntb.schema.json`. Tách dữ liệu mạng khỏi dữ liệu hiển thị. ID là UUID. `schemaVersion` bắt buộc.

```json
{
  "schemaVersion": "1.0.0",
  "project": { "id": "uuid", "name": "HQ Network", "author": "", "createdAt": "ISO-8601", "updatedAt": "ISO-8601" },
  "vlans":   [ { "id": "uuid", "vlanId": 10, "name": "STAFF", "color": "#3B82F6", "subnetIds": ["uuid"] } ],
  "subnets": [ { "id": "uuid", "cidr": "192.168.10.0/24", "gateway": "192.168.10.1", "vrf": "default" } ],
  "devices": [
    {
      "id": "uuid", "type": "l2_switch", "hostname": "SW-ACC-01",
      "vendor": "Cisco", "model": "C9200-24P", "role": "access", "lifecycle": "existing",
      "mgmtIp": "10.0.0.11/24", "site": "HQ",
      "rack": { "rackId": "uuid", "unit": 12, "height": 1 },
      "customFields": { "assetTag": "A-0012" },
      "monitoring": { "enabled": false, "snmpProfileId": null },
      "interfaces": [
        { "id": "uuid", "name": "Gi1/0/1", "media": "rj45", "speed": "1G", "mode": "access",
          "accessVlan": 10, "allowedVlans": [], "ipAddresses": [], "poe": true,
          "lagId": null, "adminUp": true, "ifIndex": null }
      ]
    }
  ],
  "links": [
    { "id": "uuid", "kind": "physical", "medium": "cat6", "speed": "1G", "status": "up",
      "a": { "deviceId": "uuid", "interfaceId": "uuid" },
      "b": { "deviceId": "uuid", "interfaceId": "uuid" },
      "lengthM": 15, "cableId": "C-101", "notes": "" }
  ],
  "groups": [ { "id": "uuid", "kind": "zone", "name": "DMZ", "memberIds": ["uuid"], "parentId": null } ],
  "assets": [ { "id": "uuid", "kind": "icon", "mime": "image/svg+xml", "data": "base64..." } ],
  "pages": [
    { "id": "uuid", "name": "HQ - Physical", "layer": "physical",
      "nodes": [ { "refId": "device-uuid", "x": 120, "y": 80, "iconAssetId": null, "locked": false } ],
      "edges": [ { "refId": "link-uuid", "routing": "orthogonal", "waypoints": [] } ],
      "viewport": { "x": 0, "y": 0, "zoom": 1 },
      "labelTemplate": "{hostname}\n{mgmtIp}" }
  ]
}
```

Quy ước: xóa device thì xóa link gắn với nó; file khác `schemaVersion` chạy migration tuần tự; validate trước khi load.
**Không** lưu credential SNMP hay mật khẩu thiết bị trong file — chỉ lưu `snmpProfileId`.

## §8. Yêu cầu phi chức năng

**Hiệu năng** (laptop Core i5 / 16 GB, Chrome mới):

| Chỉ tiêu | Mục tiêu |
| --- | --- |
| Quy mô mượt | 500 thiết bị + 1.000 link, kéo thả ≥ 50 FPS |
| Quy mô tối đa | 2.000 thiết bị + 4.000 link (ẩn label khi zoom xa) |
| Mở file 500 thiết bị | < 2 s |
| Phản hồi click/chọn | < 100 ms |
| Export PNG 500 thiết bị | < 5 s |
| SNMP poll 200 thiết bị | xong trong 1 chu kỳ 60 s |

**Lưu trữ:** autosave IndexedDB; Save/Load/Import/Export JSON; (Phase 2) lưu server, lịch sử phiên bản, khôi phục, optimistic lock.
Dự án mẫu: SMB office, Campus 3-tier, DC leaf-spine, CCTV.

**Export:** PNG, SVG, JSON (Phase 1); PDF A4/A3 có title block, CSV/Excel IP plan / port map / BOQ / VLAN (Phase 2);
Design Document tổng hợp (Phase 4). Mọi bản ảnh/PDF có legend.

**UI/UX:** Dark/Light/System; tiếng Việt + Anh; WCAG AA; trạng thái không chỉ bằng màu; dùng được bằng bàn phím;
Chrome/Edge/Firefox/Safari 2 bản mới nhất; màn hình ≥ 1280 px (tablet chỉ xem).

**Bảo mật:** đăng nhập email/password (argon2id), session cookie HttpOnly + SameSite; vai trò owner/editor/viewer;
rate limit đăng nhập; HTTPS qua reverse proxy; credential SNMP mã hóa AES-GCM, key ở env; audit log; không có telemetry ra ngoài.

**Triển khai:** Docker Compose gồm `web` (Nginx), `api` (Go, gồm poller SNMP), `db` (Postgres 16). Backup `pg_dump` hằng ngày.
Chạy được trong mạng không có Internet.

## §9. Kiến trúc & tech stack

```
Trình duyệt ── React SPA (Palette · Canvas · Sidebar · Problems)
                 │  command → Zustand store (Network model + View model + History)
                 │  Web Worker: validation      Export: PNG/SVG/PDF/Excel
                 │  IndexedDB: autosave
                 ▼  HTTPS /api  (+ SSE /live)
Nginx ── Go binary `ntb`
           ├─ HTTP API (chi): auth, projects, versions, snmp profiles
           └─ SNMP poller (goroutine pool, gosnmp) ──► thiết bị mạng (UDP 161)
                 │
                 ▼ pgx + sqlc
          PostgreSQL 16 (users, projects, versions JSONB, status, metrics, audit)
```

| Thành phần | Lựa chọn |
| --- | --- |
| Frontend | React 18 + TypeScript + Vite |
| Canvas | @xyflow/react (xem lại nếu không đạt 2.000 node — Konva/PixiJS) |
| State | Zustand + Immer |
| UI | shadcn/ui + Tailwind CSS |
| Validate schema | ajv (FE), thư viện JSON Schema cho Go (BE) |
| IP | ipaddr.js (FE), net/netip (BE) |
| Lưu cục bộ | Dexie (IndexedDB) |
| Export | html-to-image, SVG native, jsPDF + svg2pdf.js, SheetJS |
| Backend | Go, chi, pgx v5, sqlc, golang-migrate, slog |
| SNMP | gosnmp |
| Database | PostgreSQL 16 |
| Live push | Server-Sent Events |
| Test | Vitest, Playwright, go test, snmpsim |
| Deploy | Docker Compose + Nginx |

## §10. Roadmap & nghiệm thu

| Phase | Nội dung | Gate |
| --- | --- | --- |
| 0 | Khung repo, lint/test, schema, Compose dev | `make check` pass, app chạy trong Docker |
| 1 — MVP | Frontend-only: vẽ, nối, khai báo, validate, lưu, export ảnh | Checklist bên dưới |
| 2 — Pro | Backend Go, auth, phiên bản, VLAN/IPAM, multi-page, PDF/Excel | PDF đúng mẫu, review bảo mật |
| 3 — SNMP | Profile, mapping ifIndex, poller, SSE, UI live, LLDP | Poll 200 thiết bị/60 s, trạng thái đúng với snmpsim |
| 4 | Realtime, import, phân tích, desktop | — |

**Checklist nghiệm thu MVP**
- [ ] Kéo thả đủ các nhóm thiết bị; mỗi loại có port list mặc định
- [ ] Nối dây port → port; không thể nối 2 link vào 1 cổng vật lý
- [ ] Zoom 10–400%, pan, grid snap, multi-select, copy/paste giữ link, undo/redo ≥ 100 bước
- [ ] Sửa hostname / IP / VLAN trong sidebar → label cập nhật ngay
- [ ] Phát hiện trùng IP, trùng hostname, gateway sai subnet, sai loại cổng
- [ ] 500 thiết bị + 1.000 link: kéo ≥ 50 FPS, mở file < 2 s
- [ ] Save → Load JSON cho kết quả giống hệt; autosave khôi phục sau khi đóng tab
- [ ] Export PNG (1x–4x) và SVG có legend
- [ ] Dark/Light đạt tương phản WCAG AA

**Câu hỏi còn mở:** quy mô sơ đồ lớn nhất thực tế; danh sách hãng/model ưu tiên; quy mô team và deadline MVP;
số thiết bị cần giám sát SNMP và chu kỳ mong muốn.

## §11. Giám sát SNMP (Phase 3)

Mục tiêu: sơ đồ có chế độ **Live** hiển thị trạng thái thật của thiết bị và đường link, đối chiếu với thiết kế.

**Credential profile:** SNMP v2c (community) và v3 (user, auth SHA/SHA-256, priv AES-128/256). Lưu mã hóa; API không bao giờ trả secret.

**Gắn thiết bị:** device → management IP + profile. "Test SNMP" đọc sysName/sysDescr. Interface tự map ifIndex qua ifName/ifDescr, sửa tay được.

**OID đọc:**

| Mục đích | OID / MIB |
| --- | --- |
| Nhận dạng, uptime | sysName, sysDescr, sysUpTime (SNMPv2-MIB) |
| Danh sách cổng | ifName, ifDescr, ifAlias (IF-MIB) |
| Trạng thái cổng | ifOperStatus, ifAdminStatus |
| Tốc độ | ifHighSpeed |
| Lưu lượng | ifHCInOctets, ifHCOutOctets (64-bit) |
| Lỗi | ifInErrors, ifOutErrors |
| Láng giềng (tùy chọn) | LLDP-MIB lldpRemTable |

**Poller:** goroutine pool, chu kỳ mặc định 60 s (cấu hình theo dự án), timeout 2 s, retry 1, giới hạn request đồng thời;
dùng BULKWALK cho bảng. Utilization = Δoctets × 8 / Δt / ifHighSpeed. Thiết bị không trả lời 3 chu kỳ liên tiếp → unreachable.

**Lưu trữ:** `device_status`, `interface_status` (mới nhất); `interface_metrics` time series giữ 7 ngày, job dọn định kỳ.

**Giao diện Live:** công tắc Design ↔ Live; link màu theo ifOperStatus thật; % utilization trên link (ngưỡng 70% vàng, 90% đỏ);
badge unreachable; "last seen"; panel Problems thêm cảnh báo lệch thiết kế ↔ thực tế.

**An toàn:** chỉ đọc, không SET; không poll khi chưa bật `monitoring.enabled`; backend cần route tới mạng quản trị
(cấu hình mạng Docker phù hợp, có thể dùng `network_mode: host`).
