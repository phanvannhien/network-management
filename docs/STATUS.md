# Nhật ký trạng thái

Mục mới nhất ở trên cùng. Claude Code ghi vào đây sau mỗi task (mẫu trong `CLAUDE.md`).
Khi cần bàn bạc trên claude.ai, dán mục mới nhất (hoặc cả file) vào chat.

---

## 2026-10-16 — P1-07 Sites / Location / Rack
- Đã làm:
  - **ADR-025** (đã chốt): tổ chức (khách hàng) → nhiều site → cây location → rack; mỗi site nhiều thiết bị (P1-08) và nhiều
    sơ đồ (P1-13); **mỗi sơ đồ thuộc đúng một site** (sửa SRS §6.1: sơ đồ WAN đặt ở site chính); `site_scope` chỉ áp cho
    editor/viewer; xóa site = xóa mềm, chỉ owner/admin.
  - Migration 000007: `sites` (mã duy nhất trong tổ chức với site còn sống — xóa mềm giải phóng mã; múi giờ IANA; liên hệ
    tại chỗ), `locations` (building/floor/room, `parent_id`, tên duy nhất giữa anh em không phân biệt hoa thường), `racks`
    (1–60U, mặc định 42U, tên duy nhất trong location). **Khóa ngoại kép** `(site_id, organization_id)` /
    `(parent_id, site_id)` / `(location_id, site_id)` nên DB tự chặn gắn dữ liệu chéo tổ chức hoặc chéo site.
  - API (OpenAPI trước): CRUD `/orgs/{orgId}/sites`, `…/sites/{siteId}/locations`, `…/sites/{siteId}/racks`; optimistic lock;
    cây location ép cấp (tòa nhà ngay dưới site; tầng dưới tòa nhà/site; phòng dưới tầng/tòa nhà/site); xóa location còn
    con/rack → 409 có số lượng; xóa rack còn thiết bị → 409 (FK từ P1-08). Audit trước/sau cho mọi thao tác ghi.
  - **site_scope**: `PATCH members` nhận `siteScope {all, siteIds}` (chỉ owner/admin; id phải là site còn sống của tổ chức);
    `Member.siteScope` trả về. Thành viên bị giới hạn: danh sách chỉ có site trong phạm vi, site khác (và location/rack của
    nó) → 404, không tạo được site mới. `tenant.Membership.SiteFilter()` để P1-08/P1-13 dùng lại.
  - Giao diện: menu **Sites**; danh sách site (mã, tên, địa chỉ, liên hệ, số location/rack); trang site với tab Location
    (cây, thêm đúng loại con, đổi tên/xóa tại chỗ), Rack (danh sách + mặt trước rack đánh số U từ dưới lên, ô trống tới P1-08),
    Thông tin, Thiết bị/Sơ đồ (khung chờ P1-08/P1-13); xóa site phải gõ mã; sheet Thành viên có "Giới hạn site", bảng thành
    viên có cột phạm vi; Ctrl+K tìm site.
- Test / cách kiểm tra: `make check` pass (backend + 151 test frontend).
  - Backend: chéo tổ chức cho mọi endpoint (đọc 404, ghi qua đường dẫn org B và org A đều 404, dữ liệu B không đổi);
    vai trò (viewer chỉ xem, editor tạo/sửa, chỉ owner/admin xóa site), validation (mã trùng không phân biệt hoa thường 409,
    múi giờ/email/mã sai 400), xóa mềm + tái dùng mã, cây location (sai cấp, cha ở site khác, trùng tên anh em, xóa bị chặn),
    rack (location site khác, 61U), site_scope (user.manage không đặt được, id tổ chức khác 400, danh sách lọc, 404 ngoài
    phạm vi, không tạo site, owner bỏ qua scope, gỡ giới hạn). Mutation: bỏ scope / bỏ ràng buộc cây / bỏ lọc tổ chức trong
    GetSite → đều có test fail.
  - Frontend: tạo site, cây location chỉ cho loại con hợp lệ và gửi parentId, rack view 42U, viewer chỉ xem, xóa site gõ mã,
    đặt giới hạn site cho editor.
  - Ảnh `docs/ui-screens/after/36..41-*`; `a11y-report.md` 0 vấn đề (36 trang × 2 theme).
- Còn dở / lỗi đã biết:
  - Chưa khôi phục site đã xóa mềm qua giao diện (dữ liệu còn trong DB).
  - Cây location chưa kéo thả đổi cha / sắp xếp (đổi tên được; `sort_order` có sẵn trong API).
  - Nút "Thêm site" vẫn hiện cho editor bị giới hạn (server trả 403 kèm lý do) — API tổ chức chưa trả phạm vi của chính mình.
  - Cần `make migrate-up` (000007) trên DB dev.
- Câu hỏi cho người dùng: không.
- Đề xuất quyết định cần chốt: không (ADR-025 đã chốt).
- Task tiếp theo đề xuất: P1-08 Kho thiết bị (gắn site + location + rack/U, thay dữ liệu mẫu).

## 2026-10-16 — P1-06 App shell
- Đã làm (phần lớn khung đã có từ UI Bước 2–3; task này hoàn thiện phần còn lại theo SRS §2):
  - **Ngôn ngữ vi/en** trong menu tài khoản (tên ngôn ngữ ghi bằng chính ngôn ngữ đó), nhớ theo trình duyệt (`ntb-lang`),
    đồng bộ `<html lang>`. Chuỗi viết cứng còn lại (RequireAuth, RootRedirect, thông báo lỗi dự phòng của các hook) chuyển
    sang i18n (`errors.*`, `noOrg.*`).
  - **Ctrl+K** theo nhóm: Trang (chỉ trang được phép mở — Audit log chỉ owner/admin, mục Hệ thống chỉ system admin),
    Tổ chức khác (đổi tổ chức), Thành viên (mở trang Thành viên đã lọc sẵn qua `?q=`), Thiết bị (dữ liệu mẫu, ghi rõ tới P1-08;
    tìm theo hostname/IP/MAC/S/N/part number/site), Lệnh (đổi sáng/tối, đổi ngôn ngữ). Dữ liệu chỉ tải khi mở palette.
  - Đã có từ trước: menu trái theo SRS §2 (module chưa làm thì ẩn: IPAM, Sites, Đối tác, Kho mật khẩu, Giám sát, Báo cáo),
    thu gọn < 1440px, tên tổ chức luôn hiện + đổi tổ chức, thông báo (khung), Light/Dark/System, mật độ.
  - Sửa tham chiếu: dashboard đầy đủ là P1-24 (không phải P1-06).
- Test / cách kiểm tra: `make check` pass (145 test frontend): chuyển ngôn ngữ (menu đổi chữ, `lang`, localStorage), Ctrl+K
  tìm thành viên → trang Thành viên đã lọc, Ctrl+K đổi tổ chức, viewer không thấy Audit log/Hệ thống trong Ctrl+K.
  Ảnh `12-*`, `34-account-menu-*`, `35-devices-english-*`; axe-core 0 vấn đề.
- Còn dở / lỗi đã biết:
  - Thông báo lỗi do **backend** trả về vẫn là tiếng Việt khi chọn English (cần `Accept-Language` + bản dịch phía server —
    đề xuất làm khi có nhu cầu dùng tiếng Anh thật).
  - Định dạng ngày giờ/số vẫn theo vi-VN ở cả hai ngôn ngữ.
  - Tùy chọn giao diện/ngôn ngữ lưu theo trình duyệt, chưa lưu theo user phía server.
  - Thông báo (chuông) mới là khung trống — nội dung đến khi có cảnh báo hết hạn (P2) / trạng thái (P3).
- Câu hỏi cho người dùng: không.
- Đề xuất quyết định cần chốt: không.
- Task tiếp theo đề xuất: P1-07 Sites/Location/Rack.

## 2026-10-16 — P1-05 Audit log
- Đã làm:
  - API (OpenAPI trước): `GET /api/orgs/{orgId}/audit` (owner/admin) và `GET /api/admin/audit` (system admin, chỉ sự kiện
    không thuộc tổ chức — đăng nhập, MFA, tài khoản, quản trị người dùng; ADR-023). Phân trang server (page/pageSize ≤ 200,
    total), lọc `category` (tiền tố action, nhiều giá trị), `actorId`, `from`/`to`, `q` (action / đối tượng / email,
    ký tự `%` `_` được escape). Mới nhất trước. Migration 000006: index cho sự kiện hệ thống và theo người thực hiện.
  - Bổ sung trước/sau cho vô hiệu hóa / kích hoạt lại / reset MFA người dùng (các thao tác ghi khác đã có từ P1-03/04).
  - Màn hình Audit log (Quản trị › Audit log, chỉ owner/admin thấy mục menu) và Hệ thống › Audit log: DataTable,
    lọc nhóm / khoảng thời gian (24h, 7 ngày, 30 ngày, 12 tháng) / người thực hiện, tên thao tác tiếng Việt qua i18n
    (action lạ hiện tên gốc), sheet chi tiết có bảng Trường | Trước | Sau tô dòng thay đổi, IP, trình duyệt, request ID.
  - Sửa: sheet không nhận độ rộng tùy chỉnh (ảnh hưởng cả sheet Thành viên); hook chỉ gọi API khi cần (`enabled`).
- Test / cách kiểm tra:
  - Backend: chặn chéo tổ chức (A không đọc audit B, dòng của B không lọt vào A), editor/viewer 403, admin 200, lọc +
    phân trang + escape LIKE + 400 khi tham số sai, audit hệ thống chỉ cho system admin và không chứa dòng của tổ chức,
    system admin không phải thành viên → 404 với audit tổ chức, trước/sau của `user.disable`. Mutation: bỏ escape, bỏ kiểm
    tra quyền, bỏ lọc tổ chức → đều có test fail.
  - Frontend: danh sách + sheet diff, filter gửi `category`/`from` lên API, chỉ một khoảng thời gian một lúc, viewer bị
    chuyển về Dashboard, audit hệ thống. `make check` pass (142 test frontend).
  - Ảnh `docs/ui-screens/after/31..33-*`; `a11y-report.md` 0 vấn đề (28 trang × 2 theme).
- Còn dở / lỗi đã biết:
  - Audit export: chưa có export phía server — ghi `export.*` khi làm P1-22 (đã ghi vào PLAN).
  - Đổi "tổ chức dùng gần nhất" (`/activate`) là tùy chọn giao diện, không ghi audit.
  - `object_id` của người dùng lúc là email (sự kiện tài khoản/quản trị), lúc là UUID (thành viên) — giữ như dữ liệu đã ghi.
- Câu hỏi cho người dùng: không.
- Đề xuất quyết định cần chốt: không (quyền xem audit tổ chức = owner/admin, theo nhóm "Quản trị" của SRS §2).
- Task tiếp theo đề xuất: P1-06 App shell — phần lớn đã làm ở UI Bước 2–3; còn chuyển ngôn ngữ vi/en trong menu tài khoản
  và kết quả Ctrl+K từ API. Sau đó P1-07 Sites/Location/Rack.

## 2026-10-16 — UI Bước 3 · tách bundle theo route (kết thúc Bước 3)
- Đã làm: các trang module (Thiết bị, Thành viên, Quản trị, Tình trạng hệ thống) và editor tải lười (`React.lazy`);
  shell giữ nguyên khi trang con đang tải (Suspense + skeleton ở Outlet). Bundle chính 1.073 kB → 389 kB, editor 247 kB riêng.
  Dọn cảnh báo lint trong code mới (sort key ra module scope, map mức lỗi tách file).
- Test / cách kiểm tra: `make check` pass (138 test frontend). Chụp lại toàn bộ `docs/ui-screens/after/` (104 ảnh:
  26 màn × 1440/1280 × Light/Dark); `a11y-report.md`: 0 vấn đề trên 25 trang × 2 theme.
- Còn dở / lỗi đã biết: xem mục editor (thêm thiết bị bằng bàn phím, thông báo validation qua i18n). Cảnh báo
  only-export-components còn trong 3 file shadcn gốc (button/badge/tabs) — để nguyên theo mẫu shadcn.
- Câu hỏi cho người dùng: duyệt kết quả Bước 3.
- Đề xuất quyết định cần chốt: không.
- Task tiếp theo đề xuất: P1-05 Audit log (màn hình) — dùng DataTable + FilterBar mới.

## 2026-10-16 — UI Bước 3 · editor sơ đồ (token màu + i18n)
- Đã làm:
  - React Flow theo token Light/Dark qua biến `--xy-*` (nền lưới, cạnh, handle, minimap, controls, vùng chọn, attribution).
  - Mọi nhãn qua i18n, kể cả nhãn trợ năng của React Flow (`ariaLabelConfig`): toolbar (Về tổ chức, Bám lưới, Cỡ lưới,
    Vừa màn hình, Khóa), Palette (nhóm thiết bị, bỏ viết hoa toàn bộ), Sidebar thuộc tính (nhãn + giá trị vai trò/vòng đời/
    mode/trạng thái link), LinkDialog (dùng Dialog chung), Problems.
  - Problems: icon + chữ + màu theo mức (bỏ chấm màu và emoji), đặt **dưới** canvas nên không còn che Controls/minimap.
    Badge mức lỗi trên node cũng là icon.
  - Sửa lỗi có sẵn: minimap không vẽ node vì kích thước node không được giữ — nay lưu kích thước đo được ở state của canvas
    (không đổi model/command, không vào undo).
  - Script `scripts/editor-screenshots.mjs`.
- Test / cách kiểm tra: `make check` pass (test model/command editor không đổi). Ảnh `29-editor-*`, `30-editor-connect-*`;
  axe-core: 0 vấn đề.
- Còn dở / lỗi đã biết:
  - Thêm thiết bị bằng bàn phím chưa có (chỉ kéo thả); vùng Palette đã cuộn được bằng phím. Làm cùng "/" thêm nhanh (ADR-020, P1-13).
  - Thông báo kiểm tra (validation) sinh trong worker vẫn là tiếng Việt cứng — cần đổi rule trả về key + tham số; làm khi
    editor chuyển sang API (P1-13) để không đổi logic ở bước giao diện.
  - Tên loại thiết bị trong catalog (Router, L2 Switch…) giữ nguyên tiếng Anh (thuật ngữ).
- Câu hỏi cho người dùng: không.
- Đề xuất quyết định cần chốt: không.
- Task tiếp theo đề xuất: tách bundle theo route.

## 2026-10-16 — UI Bước 3 · trang tổ chức (Dashboard tạm)
- Đã làm: `/o/:orgId` thành Dashboard tạm theo thiết kế: panel Tổ chức (avatar, loại, vai trò, ghi chú; sửa qua dialog,
  409 vẫn giải thích như cũ), panel Tài khoản (MFA bật/tắt — ô mã dùng MfaCodeInput), Đi nhanh tới Thiết bị/Sơ đồ/Thành viên.
  Dashboard đầy đủ để P1-06. KeyValueList thêm `columns={1}` và `wrap`. Không đổi API.
- Test / cách kiểm tra: `make check` pass (test đổi tên tổ chức + 409, vai trò, link bật MFA). Ảnh `07-*`, `28-*`;
  axe-core + bàn phím: 0 vấn đề.
- Còn dở / lỗi đã biết: không.
- Câu hỏi cho người dùng: không.
- Đề xuất quyết định cần chốt: không.
- Task tiếp theo đề xuất: editor sơ đồ (token màu + i18n).

## 2026-10-16 — UI Bước 3 · module Quản trị người dùng + Tình trạng hệ thống
- Đã làm: trang Người dùng (khu vực Hệ thống) trên DataTable, lọc trạng thái/MFA, nhãn System admin cùng màu khu vực hệ thống,
  thao tác trong menu ⋯; vô hiệu hóa và reset MFA qua ConfirmDialog mức 1, link đặt lại mật khẩu trong `OneTimeLinkDialog`
  (ẩn "Vô hiệu hóa" với chính mình — chỉ là gợi ý UI). Trang mới **Hệ thống › Tình trạng hệ thống** (`/admin/health`):
  API, CSDL, phiên bản, môi trường, nút kiểm tra lại — thay cho dòng "API: ok" đã bỏ ở Bước 2. Menu Hệ thống thêm
  "Về tổ chức của tôi". Sửa định dạng giờ thành "09:42 16/10". Không đổi API.
- Test / cách kiểm tra: `make check` pass; test link đặt lại, xác nhận trước khi vô hiệu hóa, health bình thường và CSDL lỗi (503).
  Ảnh `docs/ui-screens/after/13-*, 26-*, 27-*`; axe-core + bàn phím: 0 vấn đề.
- Còn dở / lỗi đã biết: không.
- Câu hỏi cho người dùng: không.
- Đề xuất quyết định cần chốt: không.
- Task tiếp theo đề xuất: trang tổ chức (Tổng quan tạm).

## 2026-10-16 — UI Bước 3 · module Quản trị tổ chức
- Đã làm: trang Tất cả tổ chức (khu vực Hệ thống) — DataTable có avatar tổ chức, lọc theo loại, tạo qua dialog,
  xóa mềm qua ConfirmDialog **mức 2** (gõ đúng tên, liệt kê hậu quả: số thành viên mất quyền, link chia sẻ). Không đổi API.
- Test / cách kiểm tra: `make check` pass; test tạo tổ chức (body gửi đi) và test xóa phải gõ tên mới bật nút.
  Ảnh `docs/ui-screens/after/23..25-*`; axe-core + bàn phím: 0 vấn đề.
- Còn dở / lỗi đã biết: không.
- Câu hỏi cho người dùng: không.
- Đề xuất quyết định cần chốt: không.
- Task tiếp theo đề xuất: module Quản trị người dùng + Tình trạng hệ thống.

## 2026-10-16 — UI Bước 3 · module Thành viên
- Đã làm: trang Thành viên theo thiết kế mới — DataTable (phân trang/sắp xếp phía client qua `useLocalTable`), FilterBar
  (vai trò, trạng thái), mời qua dialog, sửa vai trò + quyền bổ sung trong sheet bên phải, gỡ/rời tổ chức qua ConfirmDialog
  mức 1, link mời một lần trong `OneTimeLinkDialog`. Thêm `NativeSelect`. Nhãn vai trò/quyền chuyển sang i18n.
  Overlay sheet bỏ hiệu ứng làm mờ. Không đổi logic nghiệp vụ hay API (quy tắc ai sửa được ai giữ nguyên).
- Test / cách kiểm tra: `make check` pass; test mời / đổi vai trò + quyền (gửi version) / xác nhận trước khi gỡ / viewer không
  thấy nút quản lý. Ảnh `docs/ui-screens/after/20..22-*`; axe-core + bàn phím: 0 vấn đề.
- Còn dở / lỗi đã biết: không.
- Câu hỏi cho người dùng: không.
- Đề xuất quyết định cần chốt: không.
- Task tiếp theo đề xuất: module Quản trị tổ chức.

## 2026-10-16 — UI Bước 2: nền tảng thiết kế (ADR-024) + trang mẫu
- Đã làm:
  - DESIGN.md cập nhật 10 chỉnh sửa đã duyệt (đánh dấu ✎, §8b); ghi ADR-024; Stack trong CLAUDE.md.
  - Thư viện: @tanstack/react-table (v9), cmdk, sonner, recharts (chưa dùng — cho Dashboard), IBM Plex Sans/Mono (@fontsource),
    react-i18next + i18next, @axe-core/playwright (dev); gỡ Geist. Component shadcn thêm qua CLI rồi chỉnh theo token.
  - API: `Health.environment` (env `NTB_ENV`, mặc định development; Compose mặc định production), `AuthSession.expiresAt`,
    `MfaStatus.verifiedAt` (để SecretField biết MFA quá 5 phút). Có test.
  - Token màu/chữ/mật độ trong `index.css` (Light/Dark/System, Gọn/Thoáng); `cn` cấu hình nhận cỡ chữ token.
  - i18n `src/i18n` (vi mặc định, en; key có kiểm tra kiểu). Component mới không còn chuỗi cứng.
  - Component dùng chung `src/components/`: AppShell (OrgShell + SystemShell có dải màu riêng), sidebar tự thu gọn < 1440px,
    org avatar màu cố định, badge môi trường, breadcrumb, Ctrl+K, thông báo, menu tài khoản (giao diện/mật độ/đăng xuất),
    cảnh báo phiên hết hạn 2 phút; PageHeader, DataTable, FilterBar (+ bộ lọc đã lưu), StatusBadge, KeyValueList, TechText,
    CopyButton, StatCard, EmptyState, ConfirmDialog 2 mức, FormField, PasswordInput, MfaCodeInput, SecretField, Toaster.
  - `/dev/ui` (chỉ dev, đã kiểm tra không có trong bundle production).
  - Trang mới: Danh sách + Chi tiết thiết bị (dữ liệu mẫu "Văn phòng mẫu", giả lập API phân trang server, có banner),
    Đăng nhập, Quên mật khẩu, MFA, Thiết lập MFA (khóa chia nhóm + bước mã khôi phục bắt buộc tick), Kích hoạt, 404.
  - Trang cũ (Dashboard tạm, Thành viên, Quản trị) đã nằm trong khung mới nhưng nội dung chưa làm lại (Bước 3).
    Dòng "API: ok · dev · DB ok" đã bỏ.
- Test / cách kiểm tra:
  - `make check` pass (132 test frontend, gồm test mới cho DataTable/ConfirmDialog/SecretField/MfaCodeInput/hết phiên/Ctrl+K/
    trang thiết bị; đã thử mutation để chắc test bắt lỗi).
  - Ảnh `docs/ui-screens/after/` (15 trang × 1440/1280 × Light/Dark = 60 ảnh).
  - axe-core WCAG 2.1 AA + duyệt Tab 25 bước mỗi trang: `docs/ui-screens/after/a11y-report.md` — 0 vấn đề
    (lần đầu ra 18: tương phản badge trên dòng chọn/Dark, aria-label lệch chữ hiển thị, khung cuộn/tab panel thiếu viền focus — đã sửa).
  - Script: `scripts/screenshots.mjs` (thêm actions/mock), `scripts/a11y.mjs`.
- Còn dở / lỗi đã biết:
  - Thao tác trên trang thiết bị (thêm/sửa/xóa/xuất) chỉ hiện toast "dữ liệu mẫu" cho tới P1-08.
  - Bundle JS ~1 MB (cảnh báo Vite) — tách chunk theo route ở Bước 3.
  - Editor sơ đồ chưa theo token/i18n (Bước 3). Tình trạng hệ thống chưa có trang trong khu vực Hệ thống (Bước 3).
  - API dev đang chạy ở 8069 cần khởi động lại (`make dev-api`) để có `environment`/`expiresAt`.
- Câu hỏi cho người dùng: duyệt ảnh Bước 2 trước khi sang Bước 3.
- Đề xuất quyết định cần chốt: không.
- Task tiếp theo đề xuất: UI Bước 3 (làm lại các trang còn lại theo module), sau đó P1-05.

## 2026-10-16 — Thiết kế lại giao diện NMS — Bước 1 (khảo sát & kế hoạch, chưa code giao diện)
- Đã làm: cài `@playwright/test` (trong Stack) + Chromium; `frontend/scripts/screenshots.mjs` (chụp theo danh sách trang, Light/Dark, nhiều độ rộng, cookie session) — dùng lại ở Bước 2–3. Chụp 14 trang × Light/Dark ở 1440px → `docs/ui-screens/before/` (28 ảnh) trên API + Vite riêng (8074/5180) với DB tạm có dữ liệu mẫu và session ở từng trạng thái (đầy đủ, chờ mã MFA, bắt buộc thiết lập MFA); đã dọn DB tạm và process, không đụng server dev 5173/8069 của người dùng. Viết `docs/DESIGN.md`: mục tiêu, 17 vấn đề hiện trạng có dẫn ảnh, bảng màu Light/Dark (accent aqua OM3, nền NOC tối) + 6 màu trạng thái có icon + chữ, typography IBM Plex Sans/Mono đóng gói, thang khoảng cách 4px, mật độ Gọn/Thoáng, AppShell, wireframe 4 kiểu trang, 10 nguyên tắc, thư viện đề xuất, nháp ADR-024.
- Test / cách kiểm tra: tương phản WCAG tính bằng script cho mọi cặp chữ/nền: chữ ≥ 5.06:1 (Light) / ≥ 4.72:1 (Dark); viền control ≥ 3.01:1 (sửa 2 vòng: bản đầu accent/up/warn/unknown Light < 4.5 trên header bảng, viền input < 3:1).
- Còn dở / lỗi đã biết: chưa ghi ADR-024, chưa cài thư viện (chờ duyệt). Thêm `@axe-core/playwright` (dev) vào danh sách đề xuất để kiểm tra AA tự động.
- Câu hỏi cho người dùng: duyệt DESIGN.md (bảng màu, font, mật độ, wireframe, thư viện).
- Đề xuất quyết định cần chốt: ADR-024 Hệ thống thiết kế giao diện (DESIGN.md §10).
- Task tiếp theo đề xuất: Bước 2 — nền tảng + component dùng chung + /dev/ui + 2 trang mẫu (sau khi duyệt).

## 2026-10-16 — P1-04 Người dùng & vai trò
- Đã làm:
  - Migration `000005_user_tokens` (link dùng 1 lần: invite / password_reset, chỉ lưu SHA-256). User được mời có `password_hash = ''` → đăng nhập luôn bị từ chối (sửa luôn: trước đó hash rỗng làm Login lỗi 500).
  - API (OpenAPI trước): `/orgs/{orgId}/members` GET (mọi thành viên) / POST (thêm theo email: user có sẵn → thêm ngay; chưa có → tạo user chờ + link mời 7 ngày) / PATCH `{userId}` (vai trò + quyền bổ sung, optimistic lock 409) / DELETE (gỡ; ai cũng tự rời được) / POST `{userId}/invite` (cấp lại link, link cũ hết hiệu lực); `/account-tokens/{token}` GET/POST công khai (xem link / đặt mật khẩu → dùng 1 lần, đăng xuất mọi nơi); `/admin/users` GET + `{userId}/disable|enable|reset-mfa|password-reset` (system admin).
  - Quy tắc vai trò (`checkRoleChange`): quản lý thành viên = owner/admin/`user.manage`; chỉ owner cấp/đổi/gỡ owner; chỉ owner/admin cấp/đổi admin và quyền bổ sung; không gỡ/hạ owner cuối cùng (409). `credential.reveal` ⇒ bắt buộc MFA (GetSession + UserRequiresMFA).
  - Bảo mật: reset mật khẩu / reset MFA chỉ system admin (admin tổ chức reset user thuộc nhiều tổ chức = chiếm quyền tổ chức khác); **chặn tấn công link mời chéo tổ chức**: không thêm được user đang chờ kích hoạt thuộc tổ chức khác (409), chỉ cấp lại link khi user chỉ thuộc đúng tổ chức này. System admin không tự vô hiệu hóa, không vô hiệu hóa system admin cuối; vô hiệu hóa / reset MFA đăng xuất user ngay. Audit: member.add/update/remove/invite_regenerated, user.disable/enable/mfa_reset/password_reset_issued, account.invite_accepted/password_reset.
  - Frontend: `/o/:orgId/members` (danh sách, thêm + hiện link mời 1 lần, đổi vai trò/quyền theo đúng quy tắc, gỡ/rời, cấp lại link), `/invite/:token` công khai (kích hoạt / đặt lại mật khẩu, nhập lại mật khẩu), `/admin/users` (vô hiệu hóa, reset MFA, link đặt lại mật khẩu).
- Test / cách kiểm tra: unit 11 trường hợp quy tắc vai trò; API với Postgres thật: cách ly mọi endpoint thành viên (kể cả nhắm user tổ chức khác qua đường dẫn tổ chức mình), mời → xem → mật khẩu yếu 400 → đăng nhập trước khi kích hoạt bị từ chối → kích hoạt → dùng lại link 404 → đăng nhập; thêm user có sẵn / trùng (không phân biệt hoa thường) 409 / dữ liệu sai 400; kịch bản tấn công link mời chéo tổ chức 409; quy tắc vai trò + owner cuối + version cũ + tự rời; credential.reveal → MFA bắt buộc; cấp lại link; quản trị user (owner bị 403, tự vô hiệu hóa 409, session mất sau khi vô hiệu hóa/reset MFA, link đặt lại mật khẩu dùng được) + audit. Mutation check: bỏ chốt chặn link mời → test tấn công fail. Vitest 110 (6 mới). Chạy thật process API + DB tạm (đã xóa) với Origin: owner mời → người được mời kích hoạt → đăng nhập thấy tổ chức (editor). Migration 5 đã áp vào DB dev. `make check` pass.
- Còn dở / lỗi đã biết: giới hạn theo site chuyển sang P1-07 (đã ghi vào PLAN); chưa gửi email (link copy tay tới P2-05 SMTP); thêm user có sẵn tiết lộ email đó có tài khoản trong hệ thống (rủi ro nhỏ, chấp nhận); chưa có trang "tài khoản của tôi" để tự đổi mật khẩu (P1-06 app shell).
- Câu hỏi cho người dùng: không.
- Task tiếp theo đề xuất: P1-05 Audit log (màn hình xem/lọc audit; ghi trước/sau đã có từ P1-03).

## 2026-10-16 — P1-03 Tổ chức & tenant middleware
- Đã làm:
  - ADR-023 (người dùng chốt): tổ chức xác định theo đường dẫn `/api/orgs/{orgId}/…` (web `/o/{orgId}`); system admin không mặc nhiên đọc dữ liệu tổ chức không phải thành viên.
  - `internal/tenant`: middleware tách `orgId` từ path (chỉ nhận UUID chuẩn), kiểm tra membership mỗi request; không phải thành viên / không tồn tại / đã xóa mềm → **404** giống nhau; `Membership` (CanEdit/CanAdmin/Has) trong context; `tenant.Require(ctx, orgId)` đối chiếu path param với context (lớp phòng thủ thứ hai).
  - `internal/audit`: ghi audit dùng chung (before/after JSON), gọi trong cùng transaction với thao tác ghi; `auth` chuyển sang dùng.
  - API: `GET /orgs` (tổ chức của tôi), `GET/PATCH /orgs/{orgId}` (PATCH: owner/admin, optimistic lock `version` → 409, audit `organization.update`), `POST /orgs/{orgId}/activate` (tổ chức mặc định, `AuthSession.activeOrganizationId`), `/admin/organizations` GET/POST (+`addMeAsOwner`, mặc định true) và DELETE (xóa mềm) — gate `requireSystemAdmin`; audit `organization.create/delete`.
  - `internal/tenanttest`: bộ test chống truy cập chéo dùng lại — Fixture 2 tổ chức + owner mỗi bên (session đã xác thực MFA), `NewUser` theo vai trò, `AssertCrossTenantDenied` (A gọi tài nguyên B → 404, kèm request đối chứng của B).
  - Frontend: `/` chuyển tới tổ chức dùng gần nhất / đầu tiên / thông báo chưa có tổ chức; `/o/:orgId` (bộ chọn tổ chức, thông tin + sửa cho owner/admin, báo 409, trang "không tìm thấy"); `/admin/organizations` (danh sách, tạo, xóa có xác nhận). `errorMessage`/`csrfParam` dùng chung trong `api/client.ts`.
- Test / cách kiểm tra: tenant unit (parse path, middleware, vai trò, Require); API với Postgres thật: cách ly mọi endpoint tổ chức + dữ liệu B không đổi + tổ chức không tồn tại/xóa mềm → 404; danh sách theo membership; viewer/editor PATCH → 403 ở backend; tên trống 400; version cũ 409; audit đúng 1 dòng có before/after; activate; admin gate 403 với owner; system admin không đọc được tổ chức không phải thành viên; tạo/xóa + audit. **Mutation check**: gỡ middleware tenant → test cách ly fail. Vitest 104 (6 test mới). Chạy thật process API + DB tạm (đã xóa) với header Origin: tạo 2 tổ chức → /orgs chỉ thấy tổ chức là owner → tổ chức kia 404 → PATCH 200 rồi version cũ 409 → audit đủ. `make check` pass.
- Còn dở / lỗi đã biết: chưa có thêm thành viên vào tổ chức có sẵn (P1-04); system admin tạo tổ chức với "không thêm tôi" thì chưa ai vào được cho tới P1-04; `site_scope` mới lưu, chưa áp dụng (khi có sites P1-07); editor `/editor` chưa gắn tổ chức (P1-13). Server `make dev-api` đang chạy của người dùng là bản cũ — cần khởi động lại.
- Câu hỏi cho người dùng: không.
- Task tiếp theo đề xuất: P1-04 Người dùng & vai trò.

## 2026-10-16 — Sửa lỗi: đăng nhập qua Vite (5173) bị chặn CSRF
- Đã làm: proxy Vite viết dạng rút gọn `'/api': url` ngầm bật `changeOrigin: true` → đổi Host thành `localhost:8069`, khác `Origin: http://localhost:5173` của trình duyệt → `csrfGuard` chặn mọi lần đăng nhập ở cổng dev. Đổi sang dạng object với `changeOrigin: false` (giống nginx `$http_host`).
- Test / cách kiểm tra: tái hiện bằng curl có header `Origin: http://localhost:5173` qua Vite → trước 403, sau 401 (đúng: tài khoản giả); Origin lạ vẫn 403; Docker 8068 vẫn đúng. `make check` pass. Bài học: kiểm tra trọn luồng phải gửi header `Origin` như trình duyệt (các lần trước dùng curl không có Origin nên không lộ lỗi).
- Còn dở / lỗi đã biết: dòng "401 (Unauthorized)" trong console khi mở trang là bình thường — frontend gọi `/auth/me` để biết đã đăng nhập chưa; trình duyệt luôn ghi log mọi phản hồi 4xx.
- Câu hỏi cho người dùng: không.
- Task tiếp theo đề xuất: P1-03 Tổ chức & tenant middleware.

## 2026-10-16 — P1-02 MFA TOTP
- Đã làm:
  - `internal/secrets`: mã hóa envelope — mỗi bí mật một DEK (AES-256-GCM), DEK bọc bằng master key (AES-256-GCM), lưu `key_version` để xoay key sau (ADR-018); AAD gắn bí mật vào ngữ cảnh (`totp:<user id>`) nên chép sang dòng khác không giải mã được. Dùng lại cho kho mật khẩu Phase 2.
  - `NTB_MASTER_KEY` **bắt buộc**: API không khởi động nếu thiếu/sai (base64 32 byte). Compose báo lỗi nếu chưa đặt; `make dev-env` tạo `deploy/.env` (chmod 600, key ngẫu nhiên) — đã tạo cho máy người dùng; `make dev-api` đọc cùng key đó (dev và Docker dùng chung DB nên phải chung key); không còn key nào commit trong repo.
  - Migration `000004_mfa`: `mfa_totp` (seed mã hóa, `enabled_at`, `last_used_step` chống dùng lại mã), `mfa_recovery_codes` (chỉ SHA-256). Query sqlc `mfa.sql`; `GetSession` trả thêm trạng thái MFA (enabled / verified / required = system admin hoặc owner/admin ở bất kỳ tổ chức nào).
  - `auth`: SetupTOTP (pquerna/otp, QR PNG sinh ở backend), EnableTOTP (transaction: bật + 10 mã khôi phục + đánh dấu session), VerifyMFA (TOTP ±1 bước, claim bước nguyên tử chống replay; hoặc mã khôi phục dùng 1 lần, gõ thường/không gạch vẫn nhận), DisableTOTP (cần mã mới; cấm khi bắt buộc), rate limit verify 5/phút/user; audit `mfa.setup/enable/enable_failed/verify/verify_failed/recovery_code_used/disable/disable_failed/verify_rate_limited`.
  - API: `POST /auth/mfa/{setup,enable,verify,disable}`; `AuthSession.mfa`. Middleware `mfaGate`: session chưa xong MFA chỉ gọi được me/logout/verify (hoặc setup/enable nếu bắt buộc thiết lập) — module sau tự được bảo vệ.
  - Frontend: `/mfa` (mã TOTP hoặc mã khôi phục), `/mfa/setup` (QR, khóa nhập tay, xác nhận, hiện mã khôi phục 1 lần + sao chép/tải .txt), guard điều hướng theo trạng thái MFA, trang chủ bật/tắt MFA cho người không bắt buộc.
  - Lỗi bắt được nhờ test: SetupTOTP với trạng thái session cũ trả QR cho seed không được lưu (UPSERT bỏ qua âm thầm) → giờ dựa vào số dòng DB ghi được, trả 409.
- Test / cách kiểm tra: secrets 4 test; auth thêm 4 test MFA với Postgres thật (trọn luồng + seed không lưu bản rõ + replay + mã khôi phục 1 lần + tắt; bắt buộc với system admin; rate limit; seed gắn với user); router thêm 2 test gate (admin bị buộc thiết lập; session chờ mã bị chặn). Vitest 98 (4 test MFA mới). Chạy thật với DB tạm (đã xóa): thiếu/sai key → API từ chối khởi động; admin → setup → bật bằng mã TOTP thật (tính độc lập bằng Python) → login mới bị chặn setup (403) → replay 401 → mã bước kế tiếp OK; audit đúng thứ tự. Docker build lại, migration 4 tự áp. `make check` pass.
- Còn dở / lỗi đã biết: chưa có trang "Tài khoản" đầy đủ (bật/tắt MFA tạm ở trang chủ, app shell P1-06); chưa có xoay master key (Phase 2, cấu trúc đã sẵn `key_version`); đặt lại MFA khi mất cả điện thoại lẫn mã khôi phục cần admin (P1-04 quản lý user). Trong lúc kiểm tra tôi đã tắt tiến trình `make dev-api` đang chạy ở 8069 (bản cũ) — người dùng cần chạy lại.
- Câu hỏi cho người dùng: không.
- Task tiếp theo đề xuất: P1-03 Tổ chức & tenant middleware.

## 2026-10-16 — ADR-022 Xóa mềm + ẩn mật khẩu CLI
- Đã làm:
  - ADR-022 (người dùng chốt): user/tổ chức không xóa cứng khi có dữ liệu liên quan — xóa mềm qua `users.disabled_at` / `organizations.deleted_at`; thêm `golang.org/x/term` vào Stack (CLAUDE.md cập nhật).
  - Migration `000003_soft_delete`: FK `audit_log` → users/organizations đổi `ON DELETE SET NULL` → `RESTRICT` (sửa lỗi P0-04: SET NULL đụng trigger append-only); thêm `organizations.deleted_at`.
  - `ntb admin create`: trên terminal gõ mật khẩu ẩn + nhập lại xác nhận; stdin là pipe/file thì đọc 1 dòng như cũ.
- Test / cách kiểm tra: test DB mới — xóa cứng user/tổ chức có audit → lỗi FK 23503 rõ ràng, user không liên quan xóa được, xóa mềm hoạt động; test auth — user bị vô hiệu hóa mất session và không đăng nhập được. Migration 000003 down/up chạy được; CLI kiểu pipe chạy thật trên DB tạm (đã xóa) và xóa cứng user đó bị chặn bởi `audit_log_actor_user_id_fkey`. `make check` pass. Docker api build lại, migration tự áp.
- Còn dở / lỗi đã biết: chế độ gõ ẩn cần terminal thật — chưa kiểm tra tự động, nhờ người dùng thử tay. Các truy vấn danh sách tổ chức (P1-03) phải lọc `deleted_at IS NULL`.
- Câu hỏi cho người dùng: không.
- Task tiếp theo đề xuất: P1-02 MFA TOTP.

## 2026-10-16 — P1-01 Đăng nhập (+ tick P0-05)
- Đã làm:
  - Migration `000002_session_csrf` (csrf_token theo session). Query sqlc `auth.sql` (user, lockout, session, audit).
  - `internal/auth`: argon2id PHC (m=64MiB,t=3,p=2; so sánh constant-time; email lạ vẫn băm giả chống dò thời gian); token 32 byte, DB chỉ lưu SHA-256; session idle 12h / tối đa 7 ngày, gia hạn trượt (ghi DB tối đa 5 phút/lần); khóa 15 phút sau 5 lần sai; rate limit bộ nhớ 10/phút/IP + 5/phút/email (429); `ClientIPResolver` chỉ tin X-Forwarded-For từ `NTB_TRUSTED_PROXIES` và lấy hop không tin cậy ngoài cùng bên phải; audit `auth.login` / `auth.login_failed` / `auth.login_rate_limited` / `auth.logout` / `user.create` (email chuẩn, không bao giờ có mật khẩu).
  - API (OpenAPI trước): `POST /auth/login` (Set-Cookie `ntb_session` HttpOnly, SameSite=Lax, Secure khi HTTPS qua proxy tin cậy), `POST /auth/logout`, `GET /auth/me` (user + CSRF token). Middleware: request info, nạp session, `csrfGuard` (chặn Sec-Fetch-Site cross-site / Origin≠Host cho mọi request ghi — chặn cả login CSRF; request đã đăng nhập phải có X-CSRF-Token đúng). Lỗi 400/500 trả thông báo chung, không lộ chi tiết nội bộ. Job xóa session hết hạn mỗi giờ.
  - CLI `ntb admin create --email --name` (mật khẩu từ stdin, ≥ 12 ký tự).
  - Frontend: `/login` (form, hiện lỗi server, `?next=` chỉ nhận đường dẫn nội bộ — chặn open redirect), `RequireAuth` cho `/` và `/editor`, client openapi-fetch tự gắn X-CSRF-Token, nút Đăng xuất.
  - Deploy: nginx giữ cổng trong Host (`$http_host`) để kiểm tra Origin khớp; Compose tạo mạng riêng 172.30.68.0/24, nginx IP tĩnh 172.30.68.10 và API **chỉ tin đúng IP đó** (bản đầu tin cả 192.168.0.0/16 — máy LAN có thể giả IP vượt rate limit; đã phát hiện khi kiểm tra và sửa). Docker image build dùng golang:1.27 (go.mod tối thiểu 1.26 do x/crypto).
- Test / cách kiểm tra:
  - Go: 15 test auth (băm, token, IP resolver chống giả mạo, rate limit, khóa tạm + mở khóa, rate limit theo email, vòng đời session, không lưu token gốc, session hết hạn, mật khẩu ngắn, audit không chứa mật khẩu + dùng email chuẩn) + 8 test HTTP (login sai/đúng + thuộc tính cookie, /me, logout thiếu/sai/đúng CSRF, chặn cross-origin, body hỏng 400 không lộ nội bộ, healthz). Vitest 8 test (guard, login, lỗi, chặn open redirect, logout gửi CSRF).
  - Chạy thật với DB tạm `ntb_e2e` (đã xóa): CLI tạo admin → login sai 401 → đúng 200 + cookie → /me → logout thiếu CSRF 403 / có CSRF 204 → /me 401; audit đủ 4 sự kiện.
  - Docker 8068: `/login` hiển thị trang đăng nhập (Done khi P0-05 ✅), migration 000002 tự chạy, login cùng nguồn gốc 401 / khác nguồn gốc 403, X-Forwarded-For giả bị bỏ qua. `make check` pass.
- Còn dở / lỗi đã biết:
  - **Lỗi thiết kế ở migration P0-04:** khóa ngoại `audit_log` dùng ON DELETE SET NULL nhưng trigger append-only chặn UPDATE → user/tổ chức đã có audit thì không xóa được (lỗi khó hiểu). Cần chốt hướng sửa (xem câu hỏi).
  - Docker Desktop (Mac) hiển thị mọi client là gateway 172.30.68.1 → rate limit theo IP gộp chung mọi người dùng khi chạy Docker trên Mac; server Linux giữ IP thật.
  - `ntb admin create` gõ tay thì mật khẩu hiện trên màn hình (không ẩn) — ẩn cần `golang.org/x/term` (ngoài Stack).
  - Rate limit trong bộ nhớ, reset khi restart (phù hợp 1 binary).
- Câu hỏi cho người dùng: (1) Sửa xung đột audit_log: (a) không bao giờ xóa cứng user/tổ chức, chỉ vô hiệu hóa (`disabled_at`), đổi FK thành RESTRICT; hay (b) bỏ FK của audit_log, giữ actor_user_id + email như dữ liệu lịch sử? (2) Cho thêm `golang.org/x/term` để ẩn mật khẩu khi gõ ở CLI?
- Task tiếp theo đề xuất: P1-02 MFA TOTP (cần chốt câu hỏi 1 trước khi đụng tới user/tổ chức ở P1-03/P1-04).

## 2026-10-16 — P0-05 Compose đầy đủ (hạ tầng xong, CHƯA tick)
- Đã làm:
  - `deploy/api.Dockerfile`: build Go nhiều tầng (golang:1.25-alpine, CGO tắt, GOWORK=off) → alpine, chạy user không root (uid 10001).
  - Compose: service `api` (env `NTB_DATABASE_URL` trỏ `db`, `NTB_MIGRATE_ON_START=true`, `NTB_MASTER_KEY`), healthcheck cả `web`/`api`/`db` (healthcheck api gọi `/api/healthz` → bao luôn kết nối DB); thứ tự khởi động db → api → web theo healthy.
  - Backend: cờ `NTB_MIGRATE_ON_START` (config + test) — API tự chạy migration nhúng trước khi phục vụ; dev vẫn dùng `make migrate-up`.
  - nginx: `location /api/` proxy sang `api:8069` (đặt trước SPA fallback, kèm X-Forwarded-*); route /api sai trả 404 thay vì `index.html`.
  - `.env.example`: `NTB_MASTER_KEY` (hướng dẫn `openssl rand -base64 32`, cảnh báo giữ riêng khỏi backup), `NTB_VERSION`, lưu ý ký tự đặc biệt trong mật khẩu DB.
  - Thêm `.dockerignore` (node_modules macOS từng có thể ghi đè node_modules Linux do `COPY frontend/` sau `npm ci`).
  - Sửa lỗi có sẵn: build Docker `web` hỏng từ P1-10 cũ vì frontend import `../schema` (alias @schema) mà Dockerfile chỉ copy `frontend/` → build giữ bố cục `/repo/frontend` + `/repo/schema`.
- Test / cách kiểm tra (chạy thật): `docker compose -f deploy/docker-compose.yml up -d --build` → 3 service healthy; `curl :8068/api/healthz` → 200 JSON `database:ok`; `/api/nope` → 404 (không phải index.html); `/editor` → 200; bundle đúng bản mới; log api có "applying database migrations"; `id` trong container = uid 10001. `make check` pass.
- Còn dở / lỗi đã biết: **P0-05 chưa tick** — Done khi cần "thấy trang đăng nhập", trang đó thuộc P1-01; tick cùng P1-01. Chưa thử migrate trên volume DB trống (không xóa volume dev của người dùng; logic migrate đã có test Go với DB tạm). API chưa dùng `NTB_MASTER_KEY` (từ P1-02) — sẽ bắt buộc có giá trị khi khởi động lúc đó.
- Câu hỏi cho người dùng: không.
- Task tiếp theo đề xuất: P1-01 Đăng nhập (argon2id, session cookie Postgres, logout, khóa tạm, CSRF, rate limit, IP client sau proxy tin cậy, `ntb admin create`, trang đăng nhập) — xong thì tick luôn P0-05.

## 2026-10-16 — P0-03 Sinh code
- Đã làm:
  - **OpenAPI 3.1 khả thi:** thử thật oapi-codegen v2.8.0 với spec 3.1 (`type: [string, "null"]` → `*string`) — chạy đúng. `api/openapi.yaml` nâng lên 3.1.0 theo đúng ADR-017, không cần ADR mới.
  - oapi-codegen ghim phiên bản bằng `go get -tool` (chạy `go tool oapi-codegen`), strict-server + chi + models → `internal/api/apigen`. sqlc (brew) với schema lấy từ migrations → `internal/store` (pgx/v5, có interface Querier). openapi-typescript + openapi-fetch → `frontend/src/api/{schema.d.ts,client.ts}`.
  - `make gen` chạy cả 3. Endpoint mẫu trọn đường: `GET /api/healthz` → `Server.GetHealthz` (implement StrictServerInterface) → sqlc `Ping` → Postgres; trả 200 `{status:ok, database:ok}` hoặc 503 `{status:degraded, database:unavailable}`; frontend dùng client sinh code (`api.GET('/healthz')`).
  - API kết nối DB qua `NTB_DATABASE_URL` (mặc định DB dev 5468); pool lazy — API vẫn chạy khi DB tắt và healthz báo.
  - openapi-typescript 7.13.0 (bản mới nhất) chỉ khai báo peer TypeScript ^5, dự án dùng TS 6 → thêm `overrides` trong `frontend/package.json` cho nó dùng TS của dự án; đã kiểm tra output đúng (chỉ là công cụ sinh code lúc dev).
  - openapi-fetch: `baseUrl` tuyệt đối theo origin trang (Request ngoài trình duyệt không nhận URL tương đối) và tra `fetch` mỗi lần gọi (test stub được).
- Test / cách kiểm tra (chạy thật): `make dev-api` + `make dev-web`, `curl :5173/api/healthz` → 200 database ok; dừng container db → 503 degraded (Done khi ✅). Go: healthz ok / DB lỗi 503 / **trọn đường với Postgres thật qua sqlc** / 404. Vitest: client sinh code gọi đúng `/api/healthz`, hiển thị ok / degraded / lỗi mạng. `make check` pass (90 FE test).
- Còn dở / lỗi đã biết: chưa có kiểm tra tự động "code sinh ra đã cập nhật" (chạy `make gen` rồi `git diff --exit-code`) — đề xuất thêm khi có CI. API chưa tự chạy migration khi khởi động (quyết định ở P0-05 cho container `api`).
- Câu hỏi cho người dùng: không.
- Task tiếp theo đề xuất: P0-05 Compose đầy đủ (`api` container, nginx proxy `/api`, healthcheck, migration khi khởi động, `NTB_MASTER_KEY` trong `.env.example`).

## 2026-10-16 — P0-04 Database
- Đã làm:
  - Migration `000001_init`: `organizations` (kind internal/customer), `users` (email citext unique, password_hash, is_system_admin, khóa tạm), `memberships` (role owner/admin/editor/viewer, permissions giới hạn theo ADR-019, site_scope, unique org+user), `sessions` (chỉ lưu hash token, active_organization_id, mfa_verified_at), `audit_log` (before/after JSONB, ip, request_id; **append-only bằng trigger** — UPDATE/DELETE bị chặn ở DB). Trigger `set_updated_at`; cột `version` cho optimistic lock.
  - `backend/db/embed.go` (migration nhúng vào binary), `internal/database` (pgxpool Open + MigrateUp/Down qua golang-migrate pgx5 driver), `internal/testdb` (mỗi test tạo DB tạm `ntb_test_<random>`, migrate, DROP khi xong).
  - Compose: `db` mở cổng host **5468** (máy có Postgres riêng ở 5432), chỉ bind 127.0.0.1; `.env.example` thêm `DB_PORT`. Makefile: `db-up`, `migrate-up/down` (CLI golang-migrate), `DATABASE_URL` + `NTB_TEST_DATABASE_URL` mặc định trỏ DB dev.
  - `go.work` ở gốc repo (gopls trong IDE nhận module backend).
- Test / cách kiểm tra (chạy thật): `make migrate-up` tạo 5 bảng → `make migrate-down` xóa sạch → `migrate-up` lại OK (Done khi ✅). Go test với Postgres thật: kết nối + đủ bảng, down/up round-trip, ràng buộc (email trùng không phân biệt hoa thường, role sai, membership trùng, permission lạ, trigger updated_at, audit_log không sửa/xóa được). Không còn DB tạm sau test. `make check` pass.
- Còn dở / lỗi đã biết: `make check` giờ cần `make db-up` trước (test DB fail rõ ràng nếu DB không chạy; chỉ skip khi biến `NTB_TEST_DATABASE_URL` rỗng). `brew install golang-migrate` tự nâng Go trên máy lên 1.27.2; `go.mod` tối thiểu go 1.25.11 (do pgx/migrate). API chưa kết nối DB (làm khi có endpoint dùng DB).
- Câu hỏi cho người dùng: không.
- Task tiếp theo đề xuất: P0-03 Sinh code (oapi-codegen + openapi-typescript/openapi-fetch + sqlc, endpoint mẫu trọn đường) — kèm kiểm tra OpenAPI 3.1 vs 3.0.3.

## 2026-10-16 — Refactor theo PLAN v2: dọn dẹp, cấu trúc lại, P0-01 Khung monorepo
- Đã làm:
  - Dọn dẹp: chuyển `dexie`/`fake-indexeddb` khỏi `package.json` gốc repo (lỗi cũ); ADR-021 (giữ oxlint, cổng web 8068), tick P0-02.
  - Cấu trúc lại: `src/{model,canvas,panels,validation,catalog,io}` → `src/editor/*`; gỡ autosave cả tài liệu + khôi phục phiên + Save/Open file làm lưu chính (ADR-015); giữ đọc/validate `.ntb.json` cho P1-22; gỡ dexie/fake-indexeddb (cài lại ở P1-13).
  - P0-01: backend chi + `GET /api/healthz` (`internal/api`), config env (`internal/config`, `NTB_HTTP_ADDR` mặc định `:8069`), slog JSON request log, graceful shutdown; `api/openapi.yaml` tối thiểu; frontend react-router (`/` trang tạm gọi healthz qua TanStack Query, `/editor` editor hiện có) + proxy Vite `/api` → `:8069`.
  - Bỏ `middleware.RealIP` của chi (staticcheck báo deprecated: giả mạo IP qua X-Forwarded-For) — lấy IP client sau proxy tin cậy sẽ làm ở P1-01.
- Test / cách kiểm tra: chạy thật `make dev-api` + `make dev-web` → `curl localhost:5173/api/healthz` trả `{"status":"ok","version":"dev"}` HTTP 200 qua proxy (Done khi P0-01 ✅). Go test healthz + 404; Vitest: home hiện trạng thái API / báo lỗi khi API sập / route editor render canvas. `make check` pass (89 FE test). ✅
- Còn dở / lỗi đã biết: `api/openapi.yaml` tạm viết OpenAPI **3.0.3** (ADR-017 ghi 3.1) — sẽ kiểm tra oapi-codegen ở P0-03, nếu hỗ trợ 3.1 thì nâng, nếu không thì ghi ADR. `/editor` vẫn chạy trên store client (`useEnsurePage`, tạo device phía client) cho tới P1-13/P1-15. IDE báo gopls thiếu `go.work` (không ảnh hưởng build).
- Câu hỏi cho người dùng: không.
- Đề xuất quyết định cần chốt: OpenAPI 3.0.3 vs 3.1 (sau khi kiểm tra ở P0-03).
- Task tiếp theo đề xuất: P0-04 Database (migration + golang-migrate) trước P0-03 vì sqlc cần schema DB.

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
