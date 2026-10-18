---
title: Kho thiết bị
section: guides
order: 2
summary: Thêm thiết bị bằng tay hoặc Excel, thư viện model, cổng và IP, cụm HA / stack, nhóm thiết bị đầu cuối, vòng đời.
---

Kho thiết bị là nguồn dữ liệu gốc: sơ đồ, IPAM, báo cáo, cảnh báo hết hạn đều đọc từ đây.

## Thêm một thiết bị

**Thiết bị → Thêm thiết bị**, điền:

- **Hostname** (tên trong mạng), **loại** (router, switch, firewall, AP, camera…), **site**.
- **Hãng / model / part number / S/N**: chọn model trong **thư viện thiết bị** (hơn 350 model của 12 hãng) thì cổng được tạo sẵn đúng tên mà hãng dùng trong dòng lệnh (vd `GigabitEthernet1/0/1`), kèm ngày hãng ngừng bán / ngừng hỗ trợ nếu có.
- **IP quản trị**: IP để vào cấu hình thiết bị.
- **Vòng đời**: Dự kiến → Đang dùng → Dự phòng (trong kho) → Bảo hành (RMA) → Đã thanh lý.
- **Do mình quản lý?** Bỏ chọn với thiết bị của nhà mạng (modem, ONT) — chúng hiện viền đứt trên sơ đồ và không vào BOQ.
- Bảo hành, license, ngày mua, nhà cung cấp, người phụ trách, ghi chú, và các **trường tùy biến** tổ chức tự đặt.

## Nhập từ Excel

**Thiết bị → Nhập Excel**:

1. Tải **file mẫu**, hoặc dùng file sẵn có của khách.
2. **Ánh xạ cột**: chỉ ra cột nào là hostname, IP, S/N… (cột "Site" của khách có thể ánh xạ vào danh mục, "Location" vào site).
3. **Xem trước**: mỗi dòng ghi rõ sẽ tạo mới / cập nhật / lỗi gì. Tên gần giống nhau (`Hochiminh` / `Ho Chi Minh`) được đề xuất gộp.
4. Chọn **tạo mới**, hoặc **cập nhật theo hostname / S/N**, rồi nhập.

**Xuất Excel** ở danh sách thiết bị dùng đúng các cột đó, nên sửa xong nhập lại được.

## Cổng và IP

Trang chi tiết thiết bị → tab **Cổng**: cổng vật lý, LAG (gộp nhiều cổng), SVI / cổng ảo, kèm mode (access / trunk), VLAN, tốc độ, loại cổng (RJ45, SFP…). Mỗi cổng có thể gán IP (kèm mask, VRF); IP được tính vào IPAM ngay.

Chưa có cổng? Áp dụng một **template** (Template thiết bị) hoặc thêm theo mẫu tên cổng.

## Cụm HA / stack

Hai firewall chạy dự phòng (HA), hay nhiều switch xếp chồng (stack) là **một cụm**: ở trang chi tiết từng thiết bị → **Thêm vào cụm** → chọn cụm có sẵn hoặc **Tạo cụm mới**. Cụm có hostname / IP quản trị chung, hiện thành một khung trên sơ đồ, và các kiểm tra trùng IP / hostname hiểu đó là một.

## Nhóm thiết bị đầu cuối

24 camera hay 80 PC giống nhau không cần 80 dòng trong kho: tạo một **nhóm đầu cuối** (số lượng, dải IP) và vẽ thành một biểu tượng. Khi cần theo dõi riêng một máy, **tách** nó thành thiết bị.

## Sửa hàng loạt, xóa

Chọn nhiều dòng → **Sửa hàng loạt** (vòng đời, site, nhà cung cấp…). **Xóa** thiết bị cho xem trước những gì bị ảnh hưởng (dây, IP, sơ đồ đang đặt nó).

## Thiếu thông tin

Thiết bị đang dùng, do mình quản lý mà thiếu S/N, thiếu cả model lẫn part number, hoặc chưa gán vị trí (khi site có vị trí) được liệt kê ở Dashboard và [Báo cáo → Thiếu thông tin](help:bao-cao). PC, điện thoại, máy in, VM không bị nhắc.
