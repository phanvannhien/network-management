---
title: Tổ chức, danh mục & site
section: guides
order: 1
summary: Cách sắp xếp khách hàng, công ty con, địa điểm, tầng / phòng và rack.
---

## Tổ chức

Một **tổ chức** chứa toàn bộ dữ liệu của một khách hàng / công ty. Người dùng chỉ thấy các tổ chức mình là thành viên; mỗi tổ chức có một **mã** ngắn (2–12 ký tự, vd `CJ`) làm tiền tố cho mọi mã site.

## Danh mục

**Danh mục** là cây cha–con để gom site theo cách khách hàng tự gọi: tập đoàn → công ty → khu vực, hoặc miền Bắc / miền Nam. Mỗi danh mục có mã riêng, góp vào mã site.

Ô chọn **danh mục trên thanh trên cùng** lọc gần như mọi trang (Dashboard, thiết bị, báo cáo…) theo danh mục đó và các danh mục con. Chọn "Toàn tổ chức" để xem tất cả.

## Site

**Site** là một địa điểm thật có thiết bị: trụ sở, chi nhánh, kho, phòng máy chủ, hoặc một trung tâm dữ liệu thuê chỗ.

- Mã site tự sinh: `<mã tổ chức>-<mã danh mục>-<mã riêng>`, vd `CJ-FOOD-HCM01`. Khi nhập Excel có thể ghi mã đầy đủ hoặc mã riêng (nếu không trùng).
- Site có thể ghi nhà mạng, địa chỉ, múi giờ, người liên hệ.
- **Sơ đồ tổng quan** (trang Sơ đồ → nút Sơ đồ tổng quan) vẽ mọi site và các đường WAN / VPN giữa chúng; bấm đúp một site để mở sơ đồ chi tiết của site đó.

## Vị trí và rack

Trong một site, **vị trí** là cây tầng → phòng → tủ (vd `Tầng 2 / Phòng server`). Gán vị trí cho thiết bị giúp kỹ thuật viên tìm đúng chỗ; khi site đã khai vị trí, thiết bị chưa gán vị trí sẽ bị nhắc trong danh sách "thiếu thông tin".

**Rack** có số U; thiết bị gắn rack ghi vị trí U và chiều cao.

## Xóa

Xóa một site chỉ được khi không còn thiết bị; dữ liệu đã xóa vẫn còn trong nhật ký (audit log).
