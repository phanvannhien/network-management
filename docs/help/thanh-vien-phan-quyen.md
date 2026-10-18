---
title: Thành viên & phân quyền
section: guides
order: 8
summary: Vai trò owner / admin / editor / viewer, quyền bổ sung, mời bằng link, MFA, nhật ký.
---

## Vai trò

Mỗi người có một vai trò **trong từng tổ chức**:

| Vai trò | Làm được |
| --- | --- |
| **Owner** | Toàn quyền tổ chức, kể cả nâng / hạ quyền admin |
| **Admin** | Quản trị tổ chức: thành viên, trường tùy biến, cảnh báo hết hạn, nhật ký; xem mật khẩu |
| **Editor** | Thêm / sửa thiết bị, IPAM, sơ đồ, nhà cung cấp… |
| **Viewer** | Chỉ xem (kể cả báo cáo), không thấy mật khẩu |

**Quyền bổ sung** cấp riêng cho từng người: *Xem mật khẩu*, *Quản lý mật khẩu*, *Quản lý thành viên*.

Không ai tự nâng quyền của mình: owner (hoặc system admin) mới nâng được.

**System admin** quản trị cả bản cài đặt (khu **Hệ thống**: tổ chức, người dùng, email, sao lưu) — khác với owner của một tổ chức.

## Mời thành viên

**Thành viên → Mời thành viên**: email, vai trò. Người đã có tài khoản được thêm ngay; email mới nhận một **link kích hoạt** dùng một lần, hết hạn sau 7 ngày. Link có thể copy gửi qua Zalo / Teams / email — không bắt buộc máy chủ có email.

## Đăng nhập an toàn

- **MFA** (mã 6 số từ ứng dụng Google Authenticator, Microsoft Authenticator…) bắt buộc với owner / admin, khuyên dùng với mọi người. Bật ở **menu tài khoản → Xác thực hai lớp**.
- Khi bật MFA, cất **mã khôi phục** ở nơi an toàn: mất điện thoại thì dùng mã này để vào.
- Sai mật khẩu nhiều lần, tài khoản bị khóa tạm.

## Nhật ký

**Nhật ký (audit log)** ghi mọi thao tác ghi (tạo / sửa / xóa, trước và sau), đăng nhập, xuất file, xem / copy mật khẩu: ai, lúc nào, từ đâu. Owner / admin xem và lọc được.
