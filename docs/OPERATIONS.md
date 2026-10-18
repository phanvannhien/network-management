# Vận hành — sao lưu, khôi phục, master key

Tài liệu cho người cài đặt / quản trị hệ thống (system admin). Quyết định gốc: ADR-053.
Phần cài đặt / nâng cấp và các đích sao lưu NAS / cloud sẽ bổ sung ở P2-13 bước 2–3.

## 1. Hệ thống có những gì cần giữ

| Thứ | Ở đâu | Mất thì sao |
| --- | --- | --- |
| **Database** (mọi tổ chức, thiết bị, sơ đồ, IPAM, hợp đồng, file đính kèm, kho mật khẩu đã mã hóa) | Volume Docker `db_data` | Mất toàn bộ dữ liệu → cần bản sao lưu |
| **Master key** `NTB_MASTER_KEY` | `deploy/.env` | Khôi phục được mọi thứ **trừ** mật khẩu trong kho, tài khoản cloud, mã MFA (mọi người phải đặt lại MFA) |
| **Mật khẩu sao lưu** `NTB_BACKUP_PASSPHRASE` | `deploy/.env` | Các file sao lưu **không mở được** |
| File sao lưu | Volume `ntb_backups` hoặc thư mục `NTB_BACKUP_HOST_DIR` | Không còn bản để khôi phục |

Master key và mật khẩu sao lưu **không bao giờ nằm trong file sao lưu**. Hai thứ này là hai chìa khóa khác nhau, cất riêng.

## 2. Giữ master key và mật khẩu sao lưu

1. Ngay sau khi cài, mở `deploy/.env`, chép `NTB_MASTER_KEY` và `NTB_BACKUP_PASSPHRASE` vào **trình quản lý mật khẩu của công ty** (Bitwarden, 1Password…), mỗi cái một mục, ghi rõ tên máy chủ.
2. In một bản giấy (hoặc ghi tay), cho vào phong bì niêm phong, cất két. Ghi ngày.
3. Không gửi qua chat / email, không chụp màn hình lên nhóm.
4. Đổi master key: `ntb rotate-master-key` (xem `deploy/.env.example`). Sau khi đổi, **cập nhật ngay bản cất giữ**, và giữ cả key cũ cho tới khi các bản sao lưu cũ hết hạn: bản sao lưu làm trước khi đổi chỉ mở được mật khẩu kho bằng key cũ.
5. Đổi mật khẩu sao lưu: sửa `NTB_BACKUP_PASSPHRASE`, khởi động lại. Bản cũ vẫn cần mật khẩu cũ → giữ mật khẩu cũ tới khi bản cũ hết hạn (tối đa 12 tháng với cấu hình mặc định).

## 3. Bật sao lưu

Trong `deploy/.env`:

```
NTB_BACKUP_PASSPHRASE=<openssl rand -base64 24>   # ≥ 16 ký tự
NTB_BACKUP_TIME=02:00                              # giờ theo NTB_TIMEZONE, hoặc off
NTB_BACKUP_KEEP=7,4,12                             # giữ: 7 ngày, 4 tuần, 12 tháng
# NTB_BACKUP_HOST_DIR=/mnt/nas/ntb-backups         # tùy chọn: lưu thẳng vào thư mục trên máy chủ / NAS
```

Rồi `docker compose -f deploy/docker-compose.yml up -d`. Kiểm tra: **Hệ thống → Tình trạng hệ thống → Sao lưu** phải xanh "Bình thường" sau lần chạy đầu (máy bật sau giờ hẹn thì chạy ngay trong vài phút).

Dùng thư mục trên máy chủ (`NTB_BACKUP_HOST_DIR`): thư mục phải cho user uid 10001 ghi được — `sudo mkdir -p /mnt/nas/ntb-backups && sudo chown 10001 /mnt/nas/ntb-backups && sudo chmod 700 /mnt/nas/ntb-backups`.

### Hệ thống tự làm gì

- **Hằng ngày** vào giờ hẹn: dump database, nén, **mã hóa AES-256** bằng mật khẩu sao lưu, ghi file `ntb-<thời điểm UTC>-scheduled.ntbbak` (quyền 600).
- **Đọc lại toàn bộ** file vừa ghi (giải mã từng khối, đọc từng bảng). File không đọc lại được bị xóa và lần chạy báo lỗi — không bao giờ giữ một bản hỏng như bản tốt.
- Chỉ sau khi có bản tốt mới **dọn bản cũ**: giữ bản mới nhất của 7 ngày, 4 tuần, 12 tháng gần nhất; bản thủ công / trước nâng cấp giữ 5 bản mới nhất.
- **Trước khi nâng cấp** (phiên bản mới có thay đổi database): tự sao lưu một bản `pre-upgrade` rồi mới nâng cấp. Sao lưu lỗi thì **không nâng cấp** (bỏ qua bằng `NTB_BACKUP_SKIP_PRE_UPGRADE=true` — chỉ khi biết mình đang làm gì).
- Máy chủ tắt đúng giờ hẹn → chạy bù khi bật lại. Lỗi → thử lại sau mỗi giờ.
- Trang **Tình trạng hệ thống** báo đỏ khi quá 2 ngày không có bản tốt, kèm lý do lỗi của từng lần.

## 4. Lệnh

Chạy trong thư mục dự án (máy chủ cài Docker):

| Việc | Lệnh |
| --- | --- |
| Sao lưu ngay | `make backup` |
| Xem các bản và lịch sử | `make backup-list` |
| Thử khôi phục vào database tạm (không đụng dữ liệu thật) | `docker compose -f deploy/docker-compose.yml exec api ntb backup verify <file> --full` |
| Khôi phục | `make restore FILE=<file>` |
| Giải mã ra file pg_dump thường (để mở bằng công cụ khác) | `ntb backup decrypt <file> --out <file.dump>` |
| Xem / xóa database cũ giữ lại sau khôi phục | `... exec api ntb backup drop-old` · `ntb backup drop-old <tên> --yes` |

`<file>` là tên trong danh sách (vd `ntb-20261018T190000Z-scheduled.ntbbak`) hoặc đường dẫn đầy đủ.

## 5. Khôi phục

`make restore FILE=...` làm các bước:

1. Dừng API (`docker compose stop api`).
2. Kiểm tra: bản sao lưu làm bằng **cùng master key** (khác thì dừng — xem mục 6), không mới hơn phiên bản đang chạy, không có API nào còn chạy.
3. Giải mã thẳng vào một **database mới** (`ntb_restore_<thời điểm>`) trong một giao dịch, rồi nâng cấp cấu trúc lên phiên bản đang chạy (bản sao lưu cũ vẫn khôi phục được vào phiên bản mới).
4. Kiểm tra database mới (đếm tổ chức, thiết bị…, khóa mã hóa đúng phiên bản).
5. Đổi tên: database hiện tại → `ntb_pre_restore_<thời điểm>` (**giữ lại**), database mới → `ntb`.
6. Khởi động lại API.

Lỗi ở bước nào trước bước 5 → database hiện tại **không bị đụng tới**. Sau khi kiểm tra mọi thứ ổn: `ntb backup drop-old` để xóa database cũ (nó chiếm dung lượng bằng database thật).

Sau khôi phục: mọi người phải đăng nhập lại; mật khẩu đăng nhập, MFA, dữ liệu là của thời điểm sao lưu.

**Khôi phục lên máy chủ mới** (máy cũ hỏng): cài hệ thống như mới với **đúng `NTB_MASTER_KEY` cũ** và mật khẩu sao lưu cũ trong `deploy/.env`, chép file sao lưu vào volume / thư mục sao lưu, chạy `make restore FILE=...`.

Postgres ngoài (không dùng container `db`): user của app cần quyền `CREATEDB` và là chủ database để đổi tên.

## 6. Khi master key không khớp

`restore` báo "made with another master key":

- Có key cũ: đặt `NTB_MASTER_KEY` (và `NTB_MASTER_KEY_VERSION`) như lúc sao lưu, khôi phục, khởi động; muốn đổi sang key mới thì chạy `ntb rotate-master-key` sau đó.
- Mất hẳn key cũ: `ntb backup restore <file> --yes --accept-key-mismatch` — khôi phục được thiết bị, sơ đồ, IPAM, hợp đồng…; **mật khẩu trong kho, tài khoản cloud và mã MFA không mở được** (nhập lại mật khẩu kho; mọi người đặt lại MFA).

## 7. Diễn tập

Ít nhất mỗi quý: `ntb backup verify <bản mới nhất> --full` — khôi phục vào database tạm, in số tổ chức / thiết bị / sơ đồ, rồi xóa. Bản sao lưu chưa từng thử khôi phục thì coi như chưa có.
