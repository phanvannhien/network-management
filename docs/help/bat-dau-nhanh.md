---
title: Bắt đầu nhanh
section: start
order: 1
summary: Từ tổ chức trống tới sơ đồ mạng đầu tiên trong 6 bước.
---

Hệ thống quản lý hạ tầng mạng của một hoặc nhiều tổ chức: thiết bị ở đâu, cắm vào đâu, dùng IP nào, hợp đồng nào sắp hết hạn — và vẽ thành sơ đồ từ chính dữ liệu đó. Sửa một chỗ, mọi sơ đồ và báo cáo cùng cập nhật.

## 1. Chọn tổ chức

Mỗi **tổ chức** là một khách hàng / công ty, dữ liệu tách hẳn nhau. System admin tạo tổ chức ở **Hệ thống → Tất cả tổ chức**; bạn chuyển giữa các tổ chức bằng ô tên tổ chức ở góc trên bên trái.

## 2. Dựng danh mục và site

Vào **Danh mục & Sites**:

- **Danh mục** là cây để gom site, vd `Tập đoàn → Công ty con → Khu vực`.
- **Site** là một địa điểm thật: trụ sở, chi nhánh, nhà máy, phòng máy chủ. Mã site tự sinh từ mã tổ chức và danh mục (vd `CJ-FOOD-HCM01`).
- Trong site có thể khai **vị trí** (tầng, phòng) và **rack**.

Xem thêm: [Tổ chức, danh mục & site](help:danh-muc-site).

## 3. Thêm thiết bị

Vào **Thiết bị**, một trong ba cách:

- **Thêm mới**: chọn loại, hãng, model. Model có trong thư viện thì cổng được tạo sẵn đúng tên của hãng.
- **Nhập Excel**: tải file mẫu, điền, nhập — xem trước từng dòng trước khi ghi.
- **Từ sơ đồ**: kéo một thiết bị mới vào màn vẽ; nó được thêm vào kho khi lưu.

Xem thêm: [Kho thiết bị](help:thiet-bi).

## 4. Khai IP

Vào **IPAM**: tạo VLAN, subnet (mạng con) và dải IP (DHCP, tĩnh). Có sẵn bảng IP plan trong Excel thì dùng **Nhập từ Excel**. Xem [IPAM](help:ipam).

## 5. Vẽ sơ đồ

Vào **Sơ đồ** → **Tạo sơ đồ**, hoặc **Tạo từ mẫu** (văn phòng nhỏ / vừa / trụ sở + chi nhánh) để có ngay một bản nháp đúng cổng, đúng VLAN. Kéo thiết bị từ thư viện bên trái, kéo từ thiết bị này sang thiết bị kia để nối dây, **Ctrl S** để lưu. Xem [Vẽ sơ đồ](help:so-do).

## 6. Mời người cùng làm

Vào **Thành viên → Mời thành viên**, chọn vai trò. Hệ thống tạo một link kích hoạt; bạn có thể copy gửi qua Zalo / Teams / email. Xem [Thành viên & phân quyền](help:thanh-vien-phan-quyen).

## Mẹo dùng hằng ngày

- **Ctrl K**: tìm mọi thứ — hostname, IP, MAC, S/N, site — và nhảy thẳng tới thiết bị trên sơ đồ.
- Nút **(?)** cạnh một ô nhập: giải thích thuật ngữ kèm ví dụ thật.
- **Menu tài khoản → Hiện hướng dẫn**: bật / tắt các dòng giải thích dưới ô nhập khi đã quen.
- Nút **?** trên thanh trên cùng mở trợ giúp đúng chủ đề của trang đang xem.
- [Thuật ngữ](/help/glossary): mọi khái niệm mạng dùng trong sản phẩm, giải thích cho người không chuyên.
