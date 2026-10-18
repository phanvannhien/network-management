---
title: Sao lưu & khôi phục
section: admin
order: 2
summary: Giữ master key, bật sao lưu tự động, đích lưu theo cỡ khách (NAS, SFTP, S3, Google Drive…), khôi phục, chống ransomware.
---

Cho người quản trị hệ thống (system admin). Cài đặt và nâng cấp: [Cài đặt & nâng cấp](help:cai-dat-nang-cap).

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
- Sau mỗi bản tốt (trừ bản trước nâng cấp): **gửi lên các đích** đã thêm ở Hệ thống → Sao lưu, rồi dọn bản cũ trên từng đích theo số bản giữ của đích đó. Một đích lỗi không làm hỏng bản sao lưu.
- **Email cho system admin** (qua SMTP ở Hệ thống → Gửi email) khi sao lưu hằng ngày bắt đầu lỗi, và khi một đích chuyển sang lỗi — một email mỗi lần chuyển trạng thái, không phải mỗi giờ.
- Trang **Tình trạng hệ thống** và **Sao lưu** báo đỏ khi quá 2 ngày không có bản tốt, vàng khi có đích gửi lỗi, kèm lý do.

## 4. Đích lưu bản sao — chọn theo cỡ khách

Bản trên máy chủ chỉ chống xóa nhầm / nâng cấp hỏng; hỏng ổ cứng hay mất máy chủ là mất theo. **Quy tắc 3-2-1**: 3 bản, trên 2 loại nơi lưu, 1 bản ngoài toà nhà. Thêm đích ở **Hệ thống → Sao lưu → Thêm đích**; sau khi lưu hệ thống tự thử kết nối (tạo thư mục, ghi rồi xóa một file nhỏ). Mật khẩu / token được mã hóa bằng master key, không bao giờ hiện lại; đổi master key thì chúng được mã hóa lại theo.

| Khách | Gợi ý | Chống được |
| --- | --- | --- |
| Cá nhân / công ty nhỏ | Google Drive / OneDrive / Dropbox, hoặc nút **Tải về** định kỳ | Hỏng máy chủ |
| Văn phòng có NAS | NAS (thư mục mount hoặc SFTP) + bật snapshot trên NAS | Chết ổ cứng, mã độc (nhờ snapshot) |
| Doanh nghiệp / MSP | NAS + kho S3 có **Object Lock** ở ngoài | Cháy nổ, mất trộm, ransomware |

### Thư mục mount (NAS qua SMB/NFS, ổ USB)

1. Mount share NAS trên máy chủ, vd `/mnt/nas` (fstab với `cifs` hoặc `nfs`).
2. Gắn vào container `api` bằng file `deploy/docker-compose.override.yml` (các lệnh `make` tự dùng file này khi có; lệnh `docker compose` gõ tay thì thêm `-f deploy/docker-compose.yml -f deploy/docker-compose.override.yml`):
   ```yaml
   services:
     api:
       volumes:
         - /mnt/nas/ntb:/mnt/nas/ntb
   ```
   Thư mục phải cho uid 10001 ghi: `sudo chown 10001 /mnt/nas/ntb`.
3. Thêm đích **Thư mục mount**, đường dẫn `/mnt/nas/ntb`.

(Cách khác: đặt cả thư mục sao lưu chính lên NAS bằng `NTB_BACKUP_HOST_DIR` — mục 3.)

### SFTP (NAS Synology / QNAP, máy chủ khác)

- Bật SFTP trên NAS; tạo **tài khoản riêng** chỉ ghi được một thư mục (vd `backup-ntb`).
- **Khóa máy chủ (bắt buộc, chống giả mạo)**: trên máy chủ cài hệ thống chạy `ssh-keyscan -p 22 nas.congty.local`, dán toàn bộ kết quả vào ô "Khóa máy chủ SFTP".
- Dùng khóa riêng (private key, PEM) thay mật khẩu nếu được.
- Đổi máy chủ, cổng, tài khoản hoặc khóa máy chủ của một đích SFTP thì phải nhập lại mật khẩu (mật khẩu đã lưu không bao giờ được gửi tới một máy chủ khác).
- Thêm / sửa / thử đích, "Sao lưu ngay" và tải bản về đều hỏi lại mã MFA nếu lần xác nhận gần nhất đã quá vài phút.

### Kho S3 (AWS, Backblaze B2, Wasabi, Cloudflare R2, Synology C2, MinIO)

1. Tạo bucket **có bật Object Lock** và đặt thời hạn giữ mặc định (vd 30 ngày, chế độ Governance hoặc Compliance). Trong thời hạn đó không ai xóa được file — kể cả kẻ đã chiếm máy chủ và lấy được key.
2. Tạo access key **chỉ cho bucket này**, quyền ghi + liệt kê + xóa (xóa sẽ bị Object Lock chặn tới hạn — bình thường, hệ thống bỏ qua).
3. Thêm đích **Kho S3**: chọn nhà cung cấp, endpoint (B2: `s3.<vùng>.backblazeb2.com`; Wasabi: `s3.<vùng>.wasabisys.com`; R2: `<account-id>.r2.cloudflarestorage.com`; Synology C2: theo vùng; AWS: để trống), vùng, bucket, thư mục, access key.
4. Nên đặt số bản giữ dài hơn cho đích ngoài toà nhà, vd `30,12,24`.

### Google Drive / OneDrive / Dropbox

Máy chủ thường không có trình duyệt, nên lấy token trên một máy tính khác:

1. Cài rclone (rclone.org/downloads).
2. Chạy `rclone authorize "drive"` (hoặc `"onedrive"`, `"dropbox"`), đăng nhập tài khoản sẽ chứa bản sao lưu, bấm cho phép.
3. Lệnh in ra một dòng `{"access_token":…,"refresh_token":…}` — dán nguyên dòng vào ô Token (OneDrive: dán trong vòng 1 giờ để hệ thống tìm ra ổ đĩa).

Token tự làm mới; nếu tài khoản đổi mật khẩu / thu hồi quyền, đích chuyển sang lỗi và system admin nhận email — lấy token mới.

### Chống ransomware

Mã độc chiếm được máy chủ có thể xóa / mã hóa mọi thứ máy chủ ghi được, kể cả ổ NAS đang mount. Cần ít nhất một bản **máy chủ không xóa được**:

- **NAS Synology**: Snapshot Replication — chụp thư mục sao lưu mỗi ngày, giữ 30 ngày, bật "immutable snapshot" (DSM 7.2+). QNAP: Snapshot với thời hạn khóa.
- **S3**: Object Lock (ở trên).
- Hoặc định kỳ tải một bản về ổ ngoài rồi rút ra.

## 5. Lệnh

Chạy trong thư mục dự án (máy chủ cài Docker):

| Việc | Lệnh |
| --- | --- |
| Sao lưu ngay | `make backup` |
| Xem các bản và lịch sử | `make backup-list` |
| Thử khôi phục vào database tạm (không đụng dữ liệu thật) | `docker compose -f deploy/docker-compose.yml exec api ntb backup verify <file> --full` |
| Khôi phục | `make restore FILE=<file>` |
| Giải mã ra file pg_dump thường (để mở bằng công cụ khác) | `ntb backup decrypt <file> --out <file.dump>` |
| Xem / xóa database cũ giữ lại sau khôi phục | `... exec api ntb backup drop-old` · `ntb backup drop-old <tên> --yes` |
| Tải một bản về máy tính | Hệ thống → Sao lưu → Tải về (nhập lại mã MFA) |

`<file>` là tên trong danh sách (vd `ntb-20261018T190000Z-scheduled.ntbbak`) hoặc đường dẫn đầy đủ.

## 6. Khôi phục

`make restore FILE=...` làm các bước:

1. Dừng API (`docker compose stop api`).
2. Kiểm tra: bản sao lưu làm bằng **cùng master key** (khác thì dừng — xem mục 7), không mới hơn phiên bản đang chạy, không có API nào còn chạy.
3. Giải mã thẳng vào một **database mới** (`ntb_restore_<thời điểm>`) trong một giao dịch, rồi nâng cấp cấu trúc lên phiên bản đang chạy (bản sao lưu cũ vẫn khôi phục được vào phiên bản mới).
4. Kiểm tra database mới (đếm tổ chức, thiết bị…, khóa mã hóa đúng phiên bản).
5. Đổi tên: database hiện tại → `ntb_pre_restore_<thời điểm>` (**giữ lại**), database mới → `ntb`.
6. Khởi động lại API.

Lỗi ở bước nào trước bước 5 → database hiện tại **không bị đụng tới**. Sau khi kiểm tra mọi thứ ổn: `ntb backup drop-old` để xóa database cũ (nó chiếm dung lượng bằng database thật).

Sau khôi phục: mọi người phải đăng nhập lại; mật khẩu đăng nhập, MFA, dữ liệu là của thời điểm sao lưu.

**Khôi phục lên máy chủ mới** (máy cũ hỏng): cài hệ thống như mới ([Cài đặt & nâng cấp](help:cai-dat-nang-cap)) với **đúng `NTB_MASTER_KEY` cũ** và mật khẩu sao lưu cũ trong `deploy/.env`, lấy file sao lưu từ NAS / cloud (rclone, trình duyệt, hoặc ổ USB), chép vào thư mục sao lưu (`docker compose cp <file> api:/var/lib/ntb/backups/`, hoặc thư mục `NTB_BACKUP_HOST_DIR`), chạy `make restore FILE=...`. Các đích sao lưu cũng được khôi phục theo database.

Postgres ngoài (không dùng container `db`): user của app cần quyền `CREATEDB` và là chủ database để đổi tên.

## 7. Khi master key không khớp

`restore` báo "made with another master key":

- Có key cũ: đặt `NTB_MASTER_KEY` (và `NTB_MASTER_KEY_VERSION`) như lúc sao lưu, khôi phục, khởi động; muốn đổi sang key mới thì chạy `ntb rotate-master-key` sau đó.
- Mất hẳn key cũ: `ntb backup restore <file> --yes --accept-key-mismatch` — khôi phục được thiết bị, sơ đồ, IPAM, hợp đồng…; **mật khẩu trong kho, tài khoản cloud và mã MFA không mở được** (nhập lại mật khẩu kho; mọi người đặt lại MFA).

## 8. Diễn tập

Ít nhất mỗi quý: `ntb backup verify <bản mới nhất> --full` — khôi phục vào database tạm, in số tổ chức / thiết bị / sơ đồ, rồi xóa. Bản sao lưu chưa từng thử khôi phục thì coi như chưa có.
