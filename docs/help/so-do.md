---
title: Vẽ sơ đồ
section: guides
order: 3
summary: Thêm thiết bị, nối dây, nhiều trang, lớp L1 / L2 / L3, mạng dùng chung, kiểm tra lỗi, lưu và xuất.
---

Sơ đồ vẽ từ dữ liệu trong kho: thiết bị, cổng, dây, IP là dữ liệu thật — sửa trên sơ đồ là sửa trong kho, và ngược lại.

## Tạo sơ đồ

Trang **Sơ đồ** có các nút:

- **Tạo sơ đồ**: sơ đồ trống, chọn lớp Vật lý / L2 / L3.
- **Tạo từ mẫu**: văn phòng nhỏ / vừa / trụ sở + chi nhánh, chọn HA, VPN, điện thoại IP, camera, Wi-Fi khách, bộ hãng. Hệ thống tạo thiết bị "Dự kiến" (model thật), dây đúng cổng, VLAN / subnet / dải IP — xem trước rồi mới tạo.
- **Sơ đồ tổng quan**: mọi site của tổ chức hoặc một danh mục, nối bằng đường WAN / VPN; bấm đúp một site để mở sơ đồ chi tiết.
- **Nhập .ntb.json**: sơ đồ xuất từ hệ thống khác.

## Thêm thiết bị

- **Thư viện** (bên trái, phím **B**): tab **Thêm mới** (theo loại / model) hoặc **Trong kho** (thiết bị đã có nhưng chưa vẽ). Kéo vào màn vẽ.
- Phím **/** mở ô thêm nhanh.
- **Delete** chỉ gỡ khỏi sơ đồ (thiết bị vẫn trong kho); **Shift + Delete** mới xóa khỏi kho.

## Nối dây

Kéo từ một thiết bị sang thiết bị kia (hoặc phím **L** rồi bấm hai thiết bị), chọn cổng hai đầu — chưa biết cổng thì để trống, gán sau. Loại dây (đồng, quang SM / MM, wireless, VPN logic…) đổi kiểu nét. Một cổng vật lý chỉ cắm được một dây; hệ thống chặn cắm trùng.

## Nhiều trang

Một sơ đồ chia được thành **trang** như các sheet Excel (Tầng 1, Tầng 2, Phòng server): tab ở đáy, **PgUp / PgDn** chuyển trang. Một thiết bị đặt được trên nhiều trang làm mốc. Dây có đầu kia ở trang khác hiện thành **mũi tên nối trang** (`→ Tầng 2`); bấm vào để sang đúng chỗ.

## Ba lớp nhìn: L1, L2, L3

Nút **L1 / L2** trên thanh công cụ, và trang loại L3:

- **L1 vật lý**: dây thật, cổng hai đầu, loại cáp.
- **L2 VLAN**: dây tô màu theo VLAN; trunk ghi các VLAN đi qua; cổng access hiện số VLAN.
- **L3 IP**: trang sinh từ IPAM — thanh subnet, thiết bị nối vào subnet bằng IP của nó, gateway, đường /30 giữa router.

## Mạng dùng chung, khung, chữ

- **Mạng dùng chung** (MPLS, Metro, LAN dùng chung): một đám mây mà nhiều site cùng cắm vào.
- **Khung nhóm**: gắn với site / vị trí để gom thiết bị; **chữ**, **mũi tên**, **vùng màu** để chú thích.
- **Bảng IP plan**: đặt bảng VLAN / subnet / gateway / dải IP của một site lên sơ đồ, luôn đọc từ IPAM.

## Kiểm tra lỗi

Nút **Vấn đề** trên thanh công cụ: hệ thống tự kiểm tra khi bạn vẽ — trùng IP / hostname, cổng cắm hai dây, lệch VLAN hai đầu dây, lệch duplex / tốc độ, IP tĩnh nằm trong dải DHCP, subnet chồng lấn, thiết bị thiếu thông tin, mật khẩu dùng chung cho quá nhiều thiết bị… Bấm một dòng để nhảy tới chỗ đó. Lỗi nghiêm trọng (đỏ) chặn lưu; cảnh báo và ghi chú thì không.

## Lưu

**Ctrl S**. Thay đổi chưa lưu được giữ tạm trong trình duyệt nếu lỡ đóng tab. Hai người sửa cùng lúc: người lưu sau được báo xung đột và chọn giữ bản nào. **Ctrl Z / Ctrl Shift Z** để hoàn tác / làm lại.

## Xuất

Nút **Xuất sơ đồ**:

- **PNG / SVG**: ảnh có tiêu đề và chú giải loại dây.
- **PDF in**: A3 / A4, mỗi trang một tờ, khung tên bản vẽ (title block) góc dưới phải — xem [Báo cáo & xuất file](help:bao-cao).
- **.ntb.json**: dữ liệu sơ đồ để nhập sang hệ thống / tổ chức khác (không có mật khẩu).

Mọi phím tắt: [Phím tắt màn vẽ](help:phim-tat).
