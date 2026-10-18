# Rà soát bảo mật — Gate Enterprise (P2-14)

Ngày: 2026-10-18. Phạm vi: kho mật khẩu & mọi bí mật, phân quyền / cách ly tổ chức trên toàn bộ API, bề mặt web và dữ liệu đầu vào — tập trung phần làm sau lần rà nền tảng P2-01 (ADR-046). Quyết định: ADR-055.

## Cách làm

1. **Rà code** (3 nhánh song song, chỉ đọc):
   - bí mật: mã hóa envelope, kho mật khẩu, TOTP, SMTP, đích sao lưu, file sao lưu;
   - phân quyền & cách ly tổ chức: từng operation trong `api/openapi.yaml`;
   - bề mặt web: XSS, file, import, gọi lệnh ngoài (rclone, pg_dump), CSRF / cookie / chuyển hướng, thư viện phụ thuộc.
2. **Kiểm thử xâm nhập tự động** (`backend/internal/api/pentest_test.go`, chạy trong `make check`): đọc **toàn bộ 236 operation** từ hợp đồng API rồi gọi như kẻ tấn công:
   - không đăng nhập → phải 401;
   - phiên hợp lệ nhưng thiếu / sai CSRF token, hoặc từ trang khác (Origin lạ) → mọi thao tác ghi phải 403;
   - thành viên tổ chức B gọi địa chỉ của tổ chức A → không bao giờ thành công;
   - viewer → không ghi được gì (trừ 5 thao tác chỉ-đọc / của chính mình, có lý do);
   - owner tổ chức gọi khu `/admin` → 403;
   - không một lệnh nào được trả 5xx.
   Endpoint thêm sau này tự được kiểm.
3. **Dữ liệu độc** (`pentest_targeted_test.go`): SQL injection qua ô tìm kiếm / lọc, ký tự NUL, chuỗi 100 KB, thẻ HTML, ký tự đảo chiều, đường dẫn `../`, body 6 MiB.
4. **Trình duyệt thật**: tên site / thiết bị / nhà cung cấp / sơ đồ / mật khẩu chứa `<img onerror>` / `<svg onload>`, mở 11 trang và ô tìm kiếm Ctrl K — không hộp `alert` nào bật.
5. **Phụ thuộc**: `npm audit --omit=dev` = 0; `govulncheck` = 0 lỗ hổng được gọi tới.

## Kết quả

Không có lỗi **nghiêm trọng / cao**. Không có đường nào để tổ chức này đọc / sửa dữ liệu tổ chức khác, để viewer ghi dữ liệu, hay để lấy bí mật ngoài endpoint "reveal".

| # | Mức | Vấn đề | Trạng thái |
| --- | --- | --- | --- |
| 1 | Trung bình | System admin (hoặc phiên admin bị chiếm) sửa đích SFTP / máy chủ SMTP sang máy chủ khác, để trống mật khẩu rồi bấm "Thử" → mật khẩu đã lưu bị gửi tới máy đó | **Đã sửa**: đổi máy chủ / cổng / tài khoản / khóa máy chủ (SMTP: cả kiểu mã hóa) thì phải nhập lại mật khẩu |
| 2 | Trung bình | Tạo đích sao lưu + "Sao lưu ngay" không cần MFA, trong khi tải bản sao lưu cần — đường vòng chép dữ liệu ra ngoài | **Đã sửa**: thêm / sửa / xóa / thử đích, sao lưu ngay, lưu / thử SMTP đều cần MFA vừa xác nhận (428 → giao diện hỏi mã rồi làm tiếp) |
| 3 | Trung bình | System admin reset MFA + lấy link đặt lại mật khẩu của owner tổ chức khác để đăng nhập thay; tổ chức không thấy trong nhật ký | **Đã sửa**: reset MFA, link đặt lại mật khẩu, khóa tài khoản cần MFA vừa xác nhận; nhật ký được ghi thêm vào **mọi tổ chức** người đó tham gia |
| 4 | Thấp–TB | Khóa máy chủ SFTP là tùy chọn → kẻ đứng giữa giả NAS lấy mật khẩu | **Đã sửa**: bắt buộc khóa máy chủ cho đích SFTP |
| 5 | Thấp | Ký tự NUL trong ô tìm kiếm / dữ liệu ghi làm API trả 500 (Postgres không nhận NUL) | **Đã sửa**: middleware từ chối 400 mọi NUL / UTF-8 hỏng ở đường dẫn, query, body JSON |
| 6 | Thấp | Tên file sao lưu cho phép `/`, `..` ở phần "loại" (tải về chỉ được nhờ router không khớp `/`) | **Đã sửa**: loại chỉ gồm `a-z` và `-` |
| 7 | Thấp | `ntb rotate-master-key` không kiểm tra API đã dừng (API chạy tiếp sẽ ghi bằng key cũ); bảng đích sao lưu chưa được khóa khi đổi key | **Đã sửa**: lệnh từ chối khi API đang chạy; khóa thêm bảng |
| 8 | Thấp | Tiến trình con (pg_dump, rclone) nhận cả biến môi trường chứa master key / mật khẩu sao lưu | **Đã sửa**: chỉ truyền PATH, HOME, TZ, PG* |
| 9 | Thấp | File cấu hình tạm của rclone (chứa bí mật) còn sót khi tiến trình bị kill | **Đã sửa**: dọn lúc khởi động |
| 10 | Thấp | Lưu token OAuth đã làm mới có thể đè token vừa dán | **Đã sửa**: chỉ ghi đè đúng bí mật cũ |
| 11 | Thấp | Lần xem mật khẩu **bị từ chối** (thiếu quyền, cần MFA, quá giới hạn) không vào nhật ký | **Đã sửa**: ghi `credential.reveal_denied` / `cloud_account.reveal_denied` kèm lý do |
| 12 | Thấp | Link chuyển hướng sau đăng nhập nhận `/\host` (trình duyệt hiểu là `//host`) — chưa khai thác được | **Đã sửa**: chặn `\` và ký tự điều khiển |
| 13 | Thấp | Giới hạn body 26 MiB chọn theo "đường dẫn kết thúc bằng…" | **Đã sửa**: chỉ đúng 4 route nhập / file hợp đồng |
| 14 | Thấp | Vài join SQL (báo cáo, nhà cung cấp) thiếu điều kiện tổ chức — khóa ngoại đã chặn, không lộ | **Đã sửa**: thêm điều kiện tổ chức |
| 15 | Thấp | Admin tổ chức A thêm thẳng một tài khoản đã có (của tổ chức B) mà không cần người đó đồng ý; phản hồi cho biết email đã có tài khoản hay chưa; có thể buộc người đó bật MFA | **Đề xuất** (đổi luồng mời → cần người dùng chốt) |
| 16 | Thông tin | Kiểm tra phiên bản master key lúc khởi động bỏ qua khi database chậm (chỉ ảnh hưởng sẵn sàng) | Chấp nhận |
| 17 | Thông tin | "Thử SMTP" trả nguyên thông báo lỗi của máy chủ (system admin có thể dò máy chủ nội bộ) | Chấp nhận — chỉ system admin, cần để chẩn đoán |
| 18 | Thông tin | File mã khôi phục MFA từng nằm trong lịch sử git (chưa push) | Người dùng chốt: đã gỡ khỏi git, giữ lịch sử |

## Đã xác nhận chắc chắn

- **Mã hóa**: mỗi bí mật một khóa dữ liệu 256-bit, nonce ngẫu nhiên, AAD gắn với bảng + id (không dời bí mật sang dòng / bảng / tổ chức khác được), lỗi giải mã không lộ chi tiết, đổi key không chạm bản rõ.
- **Kho mật khẩu**: ghi cần admin / `credential.manage`; xem cần admin / `credential.reveal` + MFA trong 5 phút + 30 lần / phút; nhật ký ghi **trước** khi trả bí mật (không ghi được thì không trả); danh sách / xuất file / báo cáo / nhật ký chỉ có cờ "đã có mật khẩu".
- **TOTP**: seed mã hóa, chống dùng lại mã, so sánh thời gian hằng, mã khôi phục 80-bit lưu dạng hash, dùng một lần.
- **Cách ly tổ chức**: mọi endpoint lấy tổ chức từ đường dẫn (`tenant.Require`), mọi query lọc `organization_id`, khóa ngoại ghép `(id, organization_id)` ở DB, id trong body đều được kiểm thuộc tổ chức.
- **Phân quyền**: không tự nâng quyền, không cấp vai trò cao hơn mình, owner cuối cùng được giữ; khu `/admin` chỉ system admin.
- **Web**: CSRF (Origin + token so sánh thời gian hằng), cookie HttpOnly / SameSite=Lax / Secure, CSP chặt, không `dangerouslySetInnerHTML`, Excel không thành công thức, email tổng hợp escape HTML, file hợp đồng tải về dạng attachment + nosniff, import `.ntb.json` theo schema có giới hạn.
- **Gọi lệnh ngoài**: rclone / pg_dump nhận danh sách tham số (không qua shell), bí mật không nằm trên dòng lệnh, cấu hình chặn xuống dòng.

## Chạy lại

```sh
make check                    # gồm TestPentestEveryOperation, TestPentestHostileInput và các test hồi quy ở trên
```
