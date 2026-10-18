---
title: IPAM — quản lý IP
section: guides
order: 4
summary: VLAN, subnet, dải DHCP / tĩnh, tìm IP trống, IP thuộc ai, nhập IP plan từ Excel.
---

IPAM (IP Address Management) là sổ IP của tổ chức: mạng nào dùng dải nào, IP nào đã có người dùng.

## VLAN

**IPAM → VLAN**: số VLAN (1–4094), tên, màu (dùng trên sơ đồ L2). VLAN gắn với một site, hoặc **toàn tổ chức** nếu mọi site dùng chung số đó. Một site có VLAN 10 riêng thì VLAN 10 của site đó được ưu tiên.

## Subnet

**IPAM → Thêm subnet**: mạng con dạng CIDR (vd `10.1.20.0/24`), gateway, VRF (bảng định tuyến riêng — để trống nếu không dùng), VLAN, site. Cột **Đã dùng** đếm IP đã gán (cổng thiết bị, IP cụm, nhóm đầu cuối) trên tổng số IP; vàng / đỏ khi gần đầy.

## Dải IP

Trong subnet, chia **dải**:

- **DHCP**: máy chủ DHCP tự cấp — không gán tay vào đây.
- **IP tĩnh**: cho server, camera, máy in đặt IP tay.
- **Dành riêng**: giữ chỗ, không ai dùng.

Nút **IP trống kế tiếp** gợi ý IP chưa ai dùng (bỏ qua dải DHCP).

## IP này của ai?

Gõ IP vào **Ctrl K** (hoặc ô tra cứu trong IPAM): hệ thống cho biết IP thuộc subnet nào, gán cho thiết bị / cổng nào, nằm trong dải nào.

## Nhập IP plan từ Excel

**IPAM → Nhập từ Excel**:

1. Tải **file mẫu** hoặc dùng bảng có sẵn — cột được nhận theo tên tiếng Việt / tiếng Anh: Site, VLAN, Tên VLAN, Subnet, Mask, Gateway, VRF, Mô tả, IP đầu / IP cuối, Loại dải, DHCP / DHCP Start / DHCP End / Static range…
2. Xem trước từng dòng: **Tạo mới / Bổ sung / Đã có / Lỗi** kèm lý do.
3. Nhập. Dòng lỗi được bỏ qua, dòng đúng vẫn vào.

> **Không ghi đè**: nhập chỉ điền chỗ còn trống; chỗ IPAM đã có giá trị khác thì giữ nguyên và báo lên để bạn tự quyết.

File [Báo cáo → IP plan](help:bao-cao) xuất ra dùng đúng các cột này, nên sửa xong nhập lại được.

## Kiểm tra tự động

Trên sơ đồ và Dashboard: subnet chồng lấn nhau, IP tĩnh hay gateway nằm trong dải DHCP, subnet sắp hết IP, IP trùng giữa hai thiết bị.
