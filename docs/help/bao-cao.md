---
title: Báo cáo & xuất file
section: guides
order: 7
summary: IP plan, VLAN, port map, BOQ, sắp hết hạn, thiếu thông tin, thống kê — xem trên màn hình, tải Excel; PDF sơ đồ A3 / A4.
---

## Báo cáo

Menu **Báo cáo**. Mọi báo cáo lọc theo danh mục trên thanh trên cùng và theo site; bảng trên màn hình giống hệt file Excel tải về. Không báo cáo nào có mật khẩu; mỗi lần tải được ghi nhật ký.

| Báo cáo | Dùng để | Ghi chú |
| --- | --- | --- |
| **IP plan** | Gửi khách / đối tác bảng mạng con | Mỗi subnet một dòng; cột đúng như "Nhập từ Excel" nên sửa xong nhập lại được |
| **VLAN** | Rà VLAN | Số cổng access và số trunk mang từng VLAN |
| **Port map** | In mang theo khi lắp đặt / xử lý sự cố | Mọi cổng kể cả cổng trống, đầu kia của dây, mã cáp; mỗi switch / router / firewall một sheet |
| **BOQ** | Báo giá, đặt hàng, nghiệm thu | Gộp theo part number; dự kiến / đang dùng / dự phòng tách sheet, không cộng chung |
| **Sắp hết hạn** | Kế hoạch gia hạn | Bảo hành, license, EoS, hợp đồng — quá hạn / 30 / 60 / 90 ngày |
| **Thiếu thông tin** | Dọn dữ liệu | Thiếu S/N, model / part number, vị trí |
| **Thống kê thiết bị** | Tổng quan | Theo site, loại, hãng |

## PDF sơ đồ

Trong sơ đồ: **Xuất sơ đồ → PDF in**:

- Khổ **A3 / A4**, ngang / dọc; tất cả các trang (mỗi trang một tờ) hoặc trang đang xem.
- **Khung tên bản vẽ** (title block) góc dưới phải: tổ chức, site, tên sơ đồ — trang, số bản vẽ, phiên bản, ngày, người lập, người kiểm tra, mức bảo mật, tờ x / y.
- Sơ đồ chụp ở 300 DPI, nền trắng; có chú giải loại dây. Sơ đồ quá to so với khổ giấy thì được báo trước — chọn A3 hoặc chia trang.

## Excel danh sách thiết bị và .ntb.json

- **Thiết bị → Xuất Excel**: danh sách thiết bị đang lọc, nhập lại được.
- **Xuất sơ đồ → .ntb.json**: sơ đồ cùng thiết bị, cổng, IP, dây để chuyển sang tổ chức / máy chủ khác (không có mật khẩu).
