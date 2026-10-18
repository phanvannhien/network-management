---
title: Kho mật khẩu & tài khoản cloud
section: guides
order: 5
summary: Lưu mật khẩu thiết bị và tài khoản cloud an toàn, ai được xem, MFA, nhắc đổi mật khẩu.
---

## Mật khẩu thiết bị

**Kho mật khẩu → Thêm mật khẩu**: tên, loại (SSH, web, SNMP…), tên đăng nhập, mật khẩu, các thiết bị dùng nó, chu kỳ đổi (tùy chọn). Mật khẩu được **mã hóa** ngay khi lưu; không xuất hiện trong danh sách, file xuất, báo cáo hay nhật ký.

## Xem / copy mật khẩu

- Cần quyền **Xem mật khẩu** (owner / admin có sẵn; người khác được cấp thêm ở Thành viên).
- Cần **xác nhận mã MFA** gần đây — hệ thống hỏi mã khi bạn bấm Xem / Copy.
- **Mọi lần xem / copy đều ghi nhật ký**: ai, lúc nào, mật khẩu nào.

## Tài khoản cloud

Tài khoản quản lý trên mạng (UniFi, FortiCloud, Meraki, Omada, nhà mạng…): đường dẫn, tên đăng nhập, mật khẩu, **ai giữ MFA** của tài khoản, thiết bị được quản lý qua nó, ngày hết hạn gói.

## Cảnh báo

- **Dùng chung**: một mật khẩu cho từ 5 thiết bị trở lên (stack / cụm HA tính là một) bị đánh dấu ⚠ và báo trên sơ đồ — lộ một chỗ là lộ cả loạt. SNMP community không bị tính.
- **Đến hạn đổi**: mật khẩu có chu kỳ đổi được nhắc như các ngày hết hạn khác ([cảnh báo hết hạn](help:nha-cung-cap#canh-bao-het-han)).

> Mật khẩu được mã hóa bằng master key của máy chủ. Mất master key thì không mở lại được — system admin giữ key theo [Sao lưu & khôi phục](help:sao-luu-khoi-phuc).
