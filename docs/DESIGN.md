# Hệ thống thiết kế giao diện — Network Topology Builder

Trạng thái: **đã duyệt 2026-10-16** (ADR-024) kèm 10 chỉnh sửa của người dùng (đánh dấu ✎). Ảnh hiện trạng: `docs/ui-screens/before/` (1440px, Light + Dark).

---

## 1. Mục tiêu

Người dùng là **kỹ sư mạng / sysadmin / nhân viên MSP**. Họ mở app để tra cứu và sửa dữ liệu hạ tầng, thường cùng lúc với
SSH, Wireshark, console thiết bị. Vì vậy giao diện phải:

- **Nhìn nhiều dữ liệu cùng lúc**: bảng dày đặc, nhiều cột, không phải cuộn ngang/dọc vô ích.
- **Quét trạng thái nhanh**: up/down/cảnh báo nhận ra trong một liếc mắt — bằng icon + chữ + màu, không chỉ màu.
- **Gọn, không trang trí thừa**: không gradient, không ảnh minh họa, không bóng đổ lớn, không animation trang trí.
- **Dữ liệu kỹ thuật dễ đọc và dễ copy**: IP, MAC, S/N, tên cổng dùng font mono, có nút copy.
- **Chạy offline**: font, icon, mọi asset đóng gói trong app (self-hosted, ADR-001).

Không nhắm tới: giao diện "marketing SaaS", card lớn xếp lưới, màn hình chào mừng.

---

## 2. Hiện trạng — vấn đề cụ thể (ảnh `before/`)

| # | Trang / ảnh | Vấn đề |
|---|---|---|
| 1 | Toàn app | **Không có khung ứng dụng**: không menu, không breadcrumb, không biết đang ở tổ chức/module nào. Điều hướng bằng các link gạch chân đặt cuối trang (07). |
| 2 | 07 Trang tổ chức | Mọi thứ căn giữa màn hình như trang đích marketing; 2/3 màn hình trống. Thông tin kỹ thuật nội bộ ("API: ok · dev · DB ok") hiện ra như nội dung chính. |
| 3 | 07, 08 | Tiêu đề "Network Topology Builder" lặp ở mọi trang thay vì tên trang. Nút "Đăng xuất" màu xám nhạt trông như bị vô hiệu. |
| 4 | 10 Thành viên | Mỗi dòng cao ~57px vì 3 checkbox quyền xếp dọc → bảng 5 người chiếm nửa màn hình; cột "Quyền bổ sung" chiếm chỗ dù đa số trống. Select vai trò dùng control mặc định của trình duyệt, cao hơn chữ trong dòng. |
| 5 | 10, 11, 12 | **Hành động phá hủy ("Gỡ", "Xóa", "Vô hiệu hóa") là link chữ đỏ gạch chân**, đặt sát nhau, dễ bấm nhầm; không phân biệt hành động chính / phụ. |
| 6 | 10, 12 | **Trạng thái chỉ là chữ thường** ("MFA tắt", "Đã vô hiệu hóa", "Chờ kích hoạt") — không icon, không màu, không quét nhanh được. |
| 7 | 11, 12 | Bảng: không header dính, không sắp xếp, không tìm/lọc, không phân trang, không chọn nhiều. Cột hành động dồn 3 link xếp dọc (12) làm dòng cao bất thường. Số (cột "Thành viên", "Tổ chức") căn trái, không tabular. |
| 8 | 11 | Form "Tạo tổ chức" luôn mở chiếm 1/3 trang trên danh sách — hành động phụ đẩy dữ liệu chính xuống. Nút "Tạo" ghi không rõ ("Tạo tổ chức"). |
| 9 | 01–06 | Trang đăng nhập/MFA khá ổn nhưng không có tên sản phẩm, logo, phiên bản; khóa nhập tay MFA (04) bị cắt dòng giữa chuỗi. |
| 10 | Dark (mọi ảnh) | Nền đen tuyệt đối #0A0A0A, chữ phụ xám mờ; **hàng bảng không có phân cách thấy được** (12-dark); card đăng nhập gần như không tách nền. |
| 11 | 13 Editor | Nhãn tiếng Anh ("Snap to grid", "Fit", "Lock", "Core & Routing"); **minimap và nút zoom React Flow không theo Dark** (khối xám/trắng); **panel Problems đè lên nút zoom và minimap**; danh sách thiết bị dài không thu gọn được; panel thuộc tính trống chỉ có 1 dòng chữ. |
| 12 | 14 Đường dẫn sai | **Trang trắng hoàn toàn** — không có trang 404. |
| 13 | 09 Không tìm thấy | Có hướng dẫn nhưng không trong khung app; một link duy nhất. |
| 14 | Toàn app | Font Geist (sans) cho cả dữ liệu kỹ thuật; không có font mono cho IP/MAC/S/N (trừ khóa MFA dùng mono hệ thống). |
| 15 | Toàn app | Khoảng cách không theo thang: lề 6/8/12/16/24px trộn lẫn; chiều rộng nội dung đổi theo trang (720/848/900px) thay vì dùng hết màn hình. |
| 16 | Toàn app | Không có trạng thái loading (trang trắng/"Đang tải…" chữ thường), không toast sau khi lưu, lỗi hiển thị chữ đỏ rời rạc; không trạng thái focus rõ ràng trên link/nút. |
| 17 | Toàn app | Không có trang trống có hướng dẫn (vd tổ chức chưa có thành viên khác, chưa có thiết bị). |

---

## 3. Màu sắc

Màu nhấn lấy từ **vỏ cáp quang multimode OM3/OM4 (aqua)** — màu quen mắt trong tủ rack, khác hẳn tím-xanh gradient của SaaS.
Nền Dark là xám-xanh đậm (giống console NOC), không đen tuyệt đối, để viền và phân cấp vẫn nhìn thấy.

### 3.1 Màu nền / chữ / viền / nhấn

| Token | Dùng cho | Light | Dark |
|---|---|---|---|
| `--bg` | Nền ứng dụng (ngoài bảng/panel) | `#F6F7F9` | `#0E1217` |
| `--surface` | Bảng, panel, form, sidebar | `#FFFFFF` | `#151A21` |
| `--surface-2` | Header bảng, hover dòng, ô readonly | `#EEF1F4` | `#1C232C` |
| `--border` | Viền panel, đường kẻ bảng (trang trí) | `#D9DEE4` | `#2A333D` |
| `--border-control` | Viền input/select/checkbox (≥ 3:1, WCAG 1.4.11) | `#838C96` | `#66717E` |
| `--text` | Chữ chính | `#161B22` | `#E6EAEF` |
| `--text-muted` | Nhãn, chữ phụ, header bảng | `#57606A` | `#9AA4AF` |
| `--accent` | Nút chính, link, focus ring, dòng đang chọn | `#0B6F79` | `#2CC5D2` |
| `--accent-fg` | Chữ trên nền accent | `#FFFFFF` | `#0B1215` |

### 3.2 Màu trạng thái (cố định toàn app, kể cả sơ đồ)

Trạng thái **luôn = icon + chữ + màu**. Không bao giờ chỉ dùng chấm màu.

| Trạng thái | Light | Dark | Icon (lucide) | Chữ | Ghi chú hiển thị |
|---|---|---|---|---|---|
| up | `#17732F` | `#3FB950` | `circle-check` | "Up" / "Hoạt động" | link liền |
| down | `#C4202B` | `#F85149` | `circle-x` | "Down" | link liền, dày hơn |
| warning | `#8A5C00` | `#D29922` | `triangle-alert` | "Cảnh báo" | |
| unknown | `#5F6770` | `#8B949E` | `circle-help` | "Không rõ" | cha unreachable (ADR-011) |
| planned | `#5F6770` | `#9AA4AF` | `circle-dashed` | "Dự kiến" | **viền/nét đứt**, nền trong suốt |
| not monitored | `--text-muted` | `--text-muted` | `circle-minus` | "Không giám sát" | không màu nền |

Badge trạng thái: nền = màu trạng thái 10% trộn **đục** với `surface` (cả Light/Dark — axe-core Bước 2 cho thấy nền trong suốt 12%/18% tụt dưới 4.5:1 trên dòng hover/đang chọn), chữ + icon = màu trạng thái; bo 4px; cao 20px. Dòng đang chọn: accent 6% + vạch accent 2px bên trái.
Màu lỗi form/hành động phá hủy dùng `down`, cảnh báo dùng `warning`, thành công dùng `up`.

### 3.3 Tương phản (đã tính, WCAG 2.1)

- Chữ thường: mọi tổ hợp chữ/trạng thái trên `bg`, `surface`, `surface-2`: **≥ 5.06:1 (Light), ≥ 4.72:1 (Dark)** → đạt AA (4.5:1).
- `accent-fg` trên `accent`: 5.89:1 (Light), 9.02:1 (Dark).
- `border-control`: ≥ 3.01:1 trên mọi nền → đạt 1.4.11. `--border` (1.35:1) chỉ dùng cho đường kẻ trang trí, không cho control.
- Focus ring: viền 2px `accent` + khe 2px `surface` (≥ 5.5:1).

Bước 2 sẽ kiểm tra lại bằng công cụ trên ảnh chụp thật (axe-core qua Playwright).

---

## 4. Typography

| Vai trò | Font | Cỡ / dòng | Ghi chú |
|---|---|---|---|
| Bảng, danh sách, menu, thanh lọc | **IBM Plex Sans** (400, 500, 600) | **13px / 20px** ✎ | hỗ trợ đủ tiếng Việt |
| Form, trang đăng nhập/MFA, đoạn giải thích | Plex Sans 400 | **14px / 22px** ✎ | dễ đọc khi nhập liệu |
| Dữ liệu kỹ thuật | **IBM Plex Mono** (400, 500) | 12.5px / 20px | **chỉ** IP, MAC, S/N, part number, tên cổng, VLAN ID ✎ |
| Hostname / tên đối tượng trong bảng | Plex Sans **500** | 13px | là link mở trang chi tiết, không dùng mono ✎ |
| Tiêu đề trang | Plex Sans 600 | 18px / 28px | chỉ một H1/trang |
| Tiêu đề khối | Plex Sans 600 | 14px / 20px | |
| Nhãn / header bảng | Plex Sans 500 | 12px / 16px | `--text-muted`, không viết hoa toàn bộ |
| Chú thích | Plex Sans 400 | 12px / 16px | |

- Font đóng gói bằng `@fontsource/ibm-plex-sans` + `@fontsource/ibm-plex-mono` (chỉ subset latin + latin-ext + vietnamese,
  chỉ các weight trên). **Không tải Google Fonts.** Gỡ Geist.
- Số trong bảng, số liệu, ngày giờ: `font-variant-numeric: tabular-nums`; cột số căn phải.
- Không viết hoa toàn bộ (kể cả nhãn nhóm) — tiếng Việt viết hoa toàn bộ khó đọc dấu.

---

## 5. Mật độ, khoảng cách, hình khối

- **Thang khoảng cách 4px**: 4 · 8 · 12 · 16 · 24 · 32. Không dùng giá trị khác.
- **Mật độ** (người dùng chọn, lưu theo user, mặc định "Gọn"):

  | | Gọn (mặc định) | Thoáng |
  |---|---|---|
  | Dòng bảng | 32px | 40px |
  | Input / select / nút | 28px | 32px |
  | Padding ô bảng | 4×8px | 8×12px |

  Cài đặt bằng `data-density` trên `<html>` + CSS variables (`--row-h`, `--control-h`, `--cell-px`, `--cell-py`).
- **Bo góc**: 4px control/badge, 6px panel/dialog. Không bo tròn lớn.
- **Viền thay vì bóng**: phân cấp bằng khoảng trắng + viền 1px. Bóng đổ chỉ cho popover/dialog/menu nổi (1 mức).
- **Không animation trang trí**. Chỉ chuyển trạng thái ≤ 120ms cho hover/mở popover; tôn trọng `prefers-reduced-motion`.
- **Chiều rộng**: nội dung dùng toàn bộ chiều rộng còn lại sau sidebar (min 1280px theo SRS §14); form đơn tối đa 640px.
- **Icon**: lucide, 16px trong dòng/nút, 20px trên sidebar; stroke 1.75.

---

## 6. Khung ứng dụng (AppShell)

```
┌────────────┬─────────────────────────────────────────────────────────────────────────────┐
│ ◇ NTB      │ Văn phòng mẫu ▾  ›  Thiết bị  ›  SW-ACC-01      [⌘K Tìm hostname, IP, S/N…] 🔔 NQ▾│ 44px
│            ├─────────────────────────────────────────────────────────────────────────────┤
│ ▣ Dashboard│                                                                             │
│ ⧉ Sơ đồ    │                                                                             │
│ ▤ Thiết bị │                         (nội dung trang)                                    │
│ ⌗ IPAM     │                                                                             │
│ ⌂ Sites    │                                                                             │
│ ── ── ──   │                                                                             │
│ ⚙ Quản trị │                                                                             │
│            │                                                                             │
│ « Thu gọn  │                                                                             │
└────────────┴─────────────────────────────────────────────────────────────────────────────┘
  220px (thu gọn: 48px chỉ icon + tooltip; màn vẽ tự thu gọn — ADR-020)
```

- Topbar: **tên tổ chức hiện tại luôn hiện**, kể cả khi user chỉ có 1 tổ chức (bấm để đổi khi có > 1) ✎; breadcrumb, Ctrl+K,
  thông báo, menu tài khoản (hồ sơ, MFA, giao diện Light/Dark/System, mật độ, đăng xuất).
- **Avatar tổ chức** ✎: 2 chữ viết tắt (chữ đầu 2 từ đầu, vd "Văn phòng mẫu" → "VP"), nền chọn cố định theo id tổ chức từ bảng
  8 màu tránh màu trạng thái (xanh lá/đỏ/hổ phách): teal `#0B6F79`, blue `#2458A6`, indigo `#4A4FB0`, plum `#8A3F7E`,
  rust `#A1461D`, slate `#4A5868`, olive `#5B6620`, cocoa `#7A5230` — chữ trắng ≥ 5.89:1; ở Dark thêm viền 1px `border-control`.
- **Khu vực hệ thống** (`/admin/*`, system admin) ✎: dải 4px + nhãn "Hệ thống" nền `#7A3E00` chữ trắng (8.34:1) ở đầu topbar,
  thay avatar tổ chức bằng icon khiên; breadcrumb bắt đầu bằng "Hệ thống". Không thể nhầm với trang của một tổ chức.
- **Badge môi trường** ✎: chỉ hiện khi API báo `environment ≠ production` (vd nhãn "Development" viền hổ phách) cạnh logo.
  Tình trạng API/DB không hiện trên trang nghiệp vụ; chuyển vào trang Hệ thống › Tình trạng (Bước 3).
- **Cảnh báo phiên sắp hết hạn** ✎: 2 phút trước `expiresAt` hiện thông báo dính đầu trang "Phiên sẽ hết hạn sau 1:59" +
  nút "Gia hạn phiên"; hết hạn → chuyển trang đăng nhập, giữ `next`. Phiên đã chạm giới hạn tuyệt đối 7 ngày thì nút đổi thành
  "Đăng nhập lại".
- **Màn hình < 1440px** ✎: sidebar tự thu gọn thành icon (48px, tooltip); người dùng vẫn mở rộng tạm được.
- Module chưa làm thì ẩn khỏi menu (PLAN P1-06). Mục "Quản trị" chỉ hiện với owner/admin/system admin.
- Trang lỗi 404 / không có quyền / mất kết nối nằm trong khung, có nút quay lại.

---

## 7. Wireframe 4 kiểu trang

### a) Trang danh sách (vd Thiết bị)

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│ Thiết bị  1.284                                          [⇩ Xuất Excel] [⇧ Nhập] [+ Thêm thiết bị]│ PageHeader
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│ [🔍 Hostname, IP, S/N…      ] [Site: Tất cả ▾] [Loại ▾] [Trạng thái ▾] [+ Lọc]  Bộ lọc: [HQ-core ▾] ☆ │ FilterBar
│ Đang lọc: Site = HQ ✕  Trạng thái = Down ✕   Xóa lọc                               [⚙ Cột] [≡ Gọn]│
├──┬──────────────┬───────────────┬────────────┬──────────────┬─────────────┬──────────┬───────┤
│☐ │ Hostname ▲   │ IP quản trị   │ Loại       │ Model        │ Site › Vị trí│ Trạng thái│       │ header dính
├──┼──────────────┼───────────────┼────────────┼──────────────┼─────────────┼──────────┼───────┤
│☐ │ FW-HQ-01     │ 10.72.114.1   │ Firewall   │ FortiGate 60F│ HQ › Rack A │ ✔ Up     │  ⋯    │ 32px
│☑ │ SW-ACC-01    │ 10.72.114.2   │ L2 Switch  │ C9200-24P    │ HQ › Tầng 3 │ ✖ Down   │  ⋯    │
│☑ │ SW-ACC-02    │ 10.72.114.3   │ PoE Switch │ C9200-24P    │ HQ › Tầng 3 │ ◌ Dự kiến│  ⋯    │
│  …                                                                                            │
├──┴──────────────┴───────────────┴────────────┴──────────────┴─────────────┴──────────┴───────┤
│ ▌ Đã chọn 2  [Sửa hàng loạt] [Gán site] [Xuất] [Xóa khỏi kho]                     Bỏ chọn     │ thanh hành động (chỉ khi chọn)
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│ 1–50 / 1.284              Số dòng: [50 ▾]                         ‹ 1 2 3 … 26 ›             │ phân trang server
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```
- IP mono, hostname Plex Sans 500 là link ✎; hover hiện nút copy cho giá trị kỹ thuật. ⋯ = menu hành động dòng.
- **Bảng rộng hơn khung**: cuộn ngang **trong khung bảng** (không cuộn cả trang), **ghim cột checkbox + hostname** bên trái, header dính khi cuộn dọc ✎.
- Cấu hình cột (ẩn/hiện, thứ tự, độ rộng) và bộ lọc đã lưu: lưu theo user.

### b) Trang chi tiết thiết bị

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│ Thiết bị › SW-ACC-01                                                                          │ breadcrumb
│ [▤] SW-ACC-01  ✖ Down · since 09:42      HQ › Tòa A › Tầng 3 › Rack A2 (U12)                 │
│     L2 Switch · Access · Đang dùng            [Mở trên sơ đồ] [Sửa] [⋯]                        │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│ Model         C9200-24P-E       Part number  C9200-24P-E ⧉   S/N         FOC2312X0AB ⧉       │ KeyValue dải 3–4 cột
│ IP quản trị   10.72.114.2/24 ⧉  Firmware     IOS-XE 17.9.4   Bảo hành    ⚠ hết 30/11/2026     │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│ Tổng quan | Interfaces 28 | IP 3 | Kết nối 4 | Truy cập | Hợp đồng & bảo hành | Sơ đồ 2 | Lịch sử│ tabs
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│ (Interfaces) bảng: Tên cổng | Loại | Media | Tốc độ | Mode | VLAN | Kết nối tới | Trạng thái   │
│  Gi1/0/1  physical  RJ45  1G  access  20   PC-KT-03 › eth0          ✔ Up                       │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

### c) Dashboard

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│ Dashboard · Văn phòng mẫu                                               Cập nhật 10:05 [↻]    │
├───────────────┬───────────────┬───────────────┬───────────────┬───────────────┬─────────────┤
│ Thiết bị 1.284│ ✖ Down 3      │ ⚠ Cảnh báo 12 │ Hết BH ≤30d 4 │ Thiếu S/N 27  │ Subnet ≥90% 2│ hàng số liệu nhỏ, 1 dòng
├───────────────┴───────────────┴──────────┬────┴───────────────┴───────────────┴─────────────┤
│ Thiết bị theo site                        │ Vấn đề cần xử lý                          Xem tất cả│
│ Site      Tổng  Up   Down  Dự kiến        │ ✖ Trùng IP 10.72.114.25 (PRN-01, CAM-05)   Mở  │
│ HQ        812   790  2     20             │ ⚠ Gateway sai subnet: VLAN 30              Mở  │
│ ĐN        310   309  1     0              │ ⚠ Sai loại cổng: SW-03 Gi1/1/1 ↔ FW port2  Mở  │
│ ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬ (thanh ngang mảnh)          │ ⓘ 14 thiết bị chưa có link                 Mở  │
├───────────────────────────────────────────┼───────────────────────────────────────────────┤
│ Sắp hết hạn (90 ngày)                      │ (Phase 3) Thiết bị down gần đây               │
│ Loại      Đối tượng       Ngày      Còn    │                                               │
│ Bảo hành  FW-HQ-01        30/11/26   45d   │                                               │
└───────────────────────────────────────────┴───────────────────────────────────────────────┘
```
Không dùng card to giống nhau xếp lưới; mỗi khối là bảng nhỏ có link "Xem tất cả" tới trang danh sách đã lọc sẵn.

### d) Trang cài đặt / quản trị

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│ Quản trị                                                                                      │
├────────────────┬────────────────────────────────────────────────────────────────────────────┤
│ Tổ chức        │ Thành viên  6                                     [+ Mời thành viên]         │
│ › Thành viên   │ [🔍 Tên, email   ] [Vai trò ▾] [Trạng thái ▾]                                 │
│ Audit log      │ Người dùng          Vai trò   Quyền bổ sung      MFA      Trạng thái        ⋯  │
│ Bảo mật        │ Trần Kỹ Sư          Editor    Xem mật khẩu        ✔ Bật    ✔ Hoạt động      ⋯  │
│ ── Hệ thống ── │ moi@vanphongmau.vn  Viewer    —                   — Tắt    ◌ Chờ kích hoạt  ⋯  │
│ Tất cả tổ chức │                                                                             │
│ Người dùng     │ (form cài đặt dạng: nhãn trái 200px | control phải, tối đa 640px,           │
│                │  nhóm bằng tiêu đề + viền mảnh, nút "Lưu thay đổi" cố định cuối form)        │
└────────────────┴────────────────────────────────────────────────────────────────────────────┘
```
Sửa vai trò/quyền mở **sheet bên phải** (không sửa inline bằng 3 checkbox mỗi dòng). Mời thành viên mở dialog.

---

## 8. Nguyên tắc

1. **Bảng là thành phần chính.** Không chẻ dữ liệu dạng danh sách vào nhiều card. Card chỉ dùng cho khối số liệu nhỏ.
2. **Phân cấp bằng khoảng trắng + viền mảnh**, bo góc nhỏ, hạn chế bóng.
3. **Hành động**: mỗi trang tối đa 1 nút chính (accent). Hành động phá hủy là nút viền đỏ / mục đỏ trong menu ⋯, luôn có
   **ConfirmDialog** ghi rõ hậu quả; không đặt link đỏ cạnh nhau.
4. **Chữ trên giao diện**: tiếng Việt, viết hoa đầu câu ("Thêm thiết bị", không "THÊM THIẾT BỊ" / "Thêm Thiết Bị").
   Nút ghi rõ hành động + đối tượng ("Lưu thay đổi", "Mời thành viên", "Xóa khỏi kho"), không "OK"/"Submit".
   Thuật ngữ kỹ thuật giữ nguyên tiếng Anh khi đó là cách kỹ sư nói (VLAN, trunk, uplink, firmware, Owner/Admin).
5. **Thông báo lỗi** nói rõ sai gì + cách sửa ("IP 10.72.114.300 không hợp lệ — mỗi octet từ 0 đến 255"), đặt ngay dưới
   trường lỗi; lỗi chung ở đầu form. Thành công → toast ngắn ("Đã lưu SW-ACC-01").
6. **Trang trống** có 1 câu giải thích + nút hành động chính ("Chưa có thiết bị. [Thêm thiết bị] hoặc [Nhập từ Excel]").
7. **Loading**: skeleton theo hình dạng bảng/khối, không spinner toàn trang; giữ dữ liệu cũ khi đang tải lại.
8. **Bàn phím**: mọi thao tác dùng được bằng bàn phím; focus ring luôn thấy; Ctrl+K tìm toàn cục; phím tắt có trong menu.
9. **Dữ liệu kỹ thuật**: mono + tabular; IP kèm prefix; hover có nút copy; giá trị trống hiện "—" màu muted.
10. **Ngày giờ**: `dd/MM/yyyy HH:mm` theo múi giờ site; thời gian tương đối ("5 phút trước") kèm tooltip giờ tuyệt đối.

---

## 8b. Bổ sung đã duyệt ✎

**Xác nhận phá hủy 2 mức**
- Mức 1 — `ConfirmDialog`: hành động thường (gỡ thành viên, vô hiệu hóa user, xóa 1 thiết bị khỏi sơ đồ). Nút xác nhận đỏ ghi rõ
  hành động ("Gỡ khỏi tổ chức"), nút hủy được focus mặc định.
- Mức 2 — gõ lại tên: hành động nặng/khó hoàn tác (xóa tổ chức, xóa site, xóa hàng loạt khỏi kho). Nút xác nhận chỉ bật khi gõ
  đúng tên (vd tên tổ chức, hoặc "Xóa 12 thiết bị"); dialog liệt kê hậu quả.

**Trang xác thực (đăng nhập, MFA, kích hoạt)**
- Tên sản phẩm + phiên bản (từ `/api/healthz`) ở đầu card; badge môi trường nếu không phải production.
- Đăng nhập: nút hiện/ẩn mật khẩu (icon mắt, có aria-label); link "Quên mật khẩu?" → trang hướng dẫn liên hệ quản trị viên
  (chưa có SMTP — system admin cấp link đặt lại, P2-05 mới gửi email).
- Ô mã MFA: `inputmode="numeric"`, `autocomplete="one-time-code"`, chỉ nhận số, **tự gửi khi đủ 6 số**, font mono cỡ lớn.
- Thiết lập MFA: khóa nhập tay chia nhóm 4 ký tự (`ABCD EFGH …`, mono) + nút copy. Sau khi bật **bắt buộc bước mã khôi phục**:
  danh sách mono, nút "Sao chép" và "Tải file .txt", checkbox "Tôi đã lưu mã khôi phục ở nơi an toàn" — nút "Tiếp tục" chỉ bật khi đã tick.

**SecretField** (mật khẩu thiết bị, tài khoản cloud — dùng từ P2-02; trình bày trước ở /dev/ui với dữ liệu giả)
- Mặc định `••••••••`; nút "Hiện" và "Copy".
- Nếu lần xác thực MFA gần nhất > 5 phút: mở dialog nhập mã MFA (ô mã như trên) trước khi hiện/copy (ADR-018).
- Đã hiện: tự che lại sau 30 giây, có đếm ngược trên nút ("Che (25)"). Copy: toast "Đã copy — clipboard tự xóa sau 30 giây",
  sau 30 giây ghi đè clipboard bằng chuỗi rỗng.
- Không bao giờ đưa giá trị bí mật vào URL, title, log hay thuộc tính `aria-label`.

**Editor sơ đồ** (làm ở Bước 3)
- Minimap, Controls, panel, nền lưới của React Flow dùng token màu (Light/Dark); panel Problems không đè Controls/minimap.
- Mọi nhãn qua i18n (react-i18next) — bỏ "Snap to grid", "Fit", "Lock", tên nhóm thiết bị tiếng Anh viết hoa.

## 9. Thư viện đề xuất

| Thư viện | Lý do | Ghi chú |
|---|---|---|
| `@tanstack/react-table` | Data table headless: sắp xếp, chọn nhiều, ẩn/hiện/sắp cột, phân trang server; không áp style | khớp TanStack Query đã dùng |
| `cmdk` | Ctrl+K command palette (qua shadcn `command`) | |
| `sonner` | Toast (qua shadcn `sonner`) | |
| `recharts` | Biểu đồ nhỏ trên dashboard (qua shadcn `chart`) — thanh ngang mảnh, sparkline P3 | chỉ dùng nơi bảng không đủ |
| `@fontsource/ibm-plex-sans`, `@fontsource/ibm-plex-mono` | Font đóng gói, chạy không Internet | thay `@fontsource-variable/geist` (gỡ) |
| `lucide-react` | Icon | **đã có** |
| `@axe-core/playwright` (dev) | Kiểm tra WCAG AA tự động trên trang thật ở Bước 2 | chỉ dev |
| `react-i18next` + `i18next` | Nhãn vi/en (đã có trong Stack, cài từ Bước 2 để component mới dùng ngay) | |

Thành phần shadcn/ui (copy vào `src/components/ui`, preset Base UI hiện tại): sidebar, breadcrumb, dropdown-menu, dialog,
sheet, select, tabs, tooltip, popover, command, badge, skeleton, table, checkbox, input, label, button, separator.
Lấy **cấu trúc** từ block chính thức (sidebar-07 thu gọn thành icon, data table, dashboard) — màu và font theo tài liệu này.

---

## 10. ADR-024 — Hệ thống thiết kế giao diện (đã ghi vào DECISIONS.md)

- **Quyết định:** giao diện theo `docs/DESIGN.md`: AppShell sidebar thu gọn; bảng là thành phần chính; token màu riêng
  (accent aqua OM3, nền NOC tối) cho Light/Dark; màu trạng thái cố định + icon + chữ; IBM Plex Sans/Mono đóng gói qua
  @fontsource (không Google Fonts); mật độ Gọn/Thoáng; component dùng chung trong `src/components/`.
  Thêm thư viện: @tanstack/react-table, cmdk, sonner, recharts, @fontsource/ibm-plex-sans, @fontsource/ibm-plex-mono,
  @axe-core/playwright (dev); gỡ @fontsource-variable/geist.
- **Lý do:** người dùng là kỹ sư mạng cần mật độ thông tin cao, quét trạng thái nhanh; app chạy trong mạng không Internet.
- **Ràng buộc:** mọi trang mới dùng component dùng chung; không màu/kích thước viết cứng ngoài token; đạt WCAG AA.
