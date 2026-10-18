---
title: Cài đặt & nâng cấp
section: admin
order: 1
summary: Cài hệ thống lên máy chủ, bật HTTPS, nâng cấp phiên bản và quay về bản cũ.
---

Cho người cài hệ thống lên máy chủ của công ty / khách hàng. Sao lưu, khôi phục, master key: xem [Sao lưu & khôi phục](help:sao-luu-khoi-phuc).

## 1. Cần gì

| | Tối thiểu | Khuyên dùng |
| --- | --- | --- |
| Máy chủ | Linux 64-bit (Ubuntu 22.04+/Debian 12+), hoặc máy ảo | Máy ảo riêng, có snapshot |
| CPU / RAM | 2 vCPU / 4 GB | 4 vCPU / 8 GB (vài nghìn thiết bị trở lên) |
| Đĩa | 20 GB | 50 GB+ (database + các bản sao lưu trên máy) |
| Phần mềm | Docker Engine 24+ với plugin `docker compose`, `make`, `git` | |
| Mạng | Người dùng vào được cổng web (mặc định 8068) | Có tên miền nội bộ + HTTPS qua reverse proxy |

Không cần mở cổng database ra ngoài: Postgres chỉ nghe trên `127.0.0.1`.

## 2. Cài lần đầu

```sh
git clone <kho mã> /opt/ntb && cd /opt/ntb       # hoặc giải nén bản phát hành vào /opt/ntb
cp deploy/.env.example deploy/.env && chmod 600 deploy/.env
```

Sửa `deploy/.env`:

| Biến | Đặt thành |
| --- | --- |
| `POSTGRES_PASSWORD` | Mật khẩu mạnh, tránh ký tự `@ : / ? #` |
| `NTB_MASTER_KEY` | `openssl rand -base64 32` |
| `NTB_BACKUP_PASSPHRASE` | `openssl rand -base64 24` (≥ 16 ký tự, khác master key) |
| `NTB_TIMEZONE` | Múi giờ của khách, vd `Asia/Ho_Chi_Minh` |
| `WEB_PORT` | Cổng web nếu 8068 đã có người dùng |
| `NTB_COOKIE_SECURE=true` | Khi người dùng chỉ vào qua HTTPS |

**Ngay lúc này**, chép `NTB_MASTER_KEY` và `NTB_BACKUP_PASSPHRASE` vào trình quản lý mật khẩu và một bản in cất két ([giữ master key](help:sao-luu-khoi-phuc#2-giu-master-key-va-mat-khau-sao-luu)). Đây là bước hay bị quên nhất và không làm lại được.

Khởi động và tạo system admin đầu tiên:

```sh
docker compose -f deploy/docker-compose.yml up -d --build
printf '%s' 'mật-khẩu-ít-nhất-12-ký-tự' > /tmp/pw && \
  docker compose -f deploy/docker-compose.yml exec -T api ntb admin create --email admin@congty.vn --name "Quản trị" < /tmp/pw; \
  rm -f /tmp/pw
```

Mở `http://<máy chủ>:8068`, đăng nhập, bật MFA (bắt buộc với quản trị), rồi:

1. **Hệ thống → Tất cả tổ chức**: tạo tổ chức đầu tiên, rồi mời người dùng.
2. **Hệ thống → Gửi email**: cấu hình SMTP (để có cảnh báo hết hạn và email khi sao lưu lỗi).
3. **Hệ thống → Sao lưu**: kiểm tra "Bình thường", thêm ít nhất một đích ngoài máy chủ (NAS / cloud).

## 3. HTTPS và reverse proxy

Container `web` nghe HTTP. Để chạy HTTPS, đặt một reverse proxy (Caddy, Nginx, Traefik, HAProxy của tường lửa…) phía trước, chuyển tới cổng `WEB_PORT`, và:

- gửi header `X-Forwarded-Proto: https` và `X-Forwarded-For`;
- thêm **đúng địa chỉ IP** của proxy vào `NTB_TRUSTED_PROXIES` (giữ `172.30.68.10/32` của container web), vd `NTB_TRUSTED_PROXIES=172.30.68.10/32,10.0.0.5/32` — không bao giờ cả dải mạng LAN;
- đặt `NTB_COOKIE_SECURE=true`.

Ví dụ Caddy (tự lấy chứng chỉ khi có tên miền thật, hoặc `tls internal` cho tên nội bộ):

```
ntb.congty.local {
    tls internal
    reverse_proxy 127.0.0.1:8068
}
```

## 4. Nâng cấp

```sh
cd /opt/ntb
git pull                     # hoặc giải nén bản mới đè lên (giữ nguyên deploy/.env)
docker compose -f deploy/docker-compose.yml up -d --build
```

Khi API khởi động với phiên bản mới có thay đổi database, nó **tự sao lưu một bản `pre-upgrade` trước khi nâng cấp**. Sao lưu lỗi thì API dừng, báo lỗi trong `docker compose logs api` và **không đụng database** — sửa lỗi (thường là đầy đĩa) rồi chạy lại lệnh trên.

Sau nâng cấp: **Hệ thống → Tình trạng hệ thống** xem phiên bản, database "Hoạt động"; mở thử vài sơ đồ.

**Quay về phiên bản cũ** nếu bản mới có vấn đề:

```sh
git checkout <tag bản cũ>
docker compose -f deploy/docker-compose.yml build api
make restore FILE=<bản pre-upgrade vừa tạo>      # tên trong make backup-list
```

(Bản cũ không chạy được trên database đã nâng cấp, nên phải khôi phục bản `pre-upgrade`. Dữ liệu nhập sau lúc nâng cấp sẽ mất.)

**Nâng major Postgres** (vd 16 → 17): đổi cả image `db` trong `deploy/docker-compose.yml` lẫn gói `postgresql16-client` trong `deploy/api.Dockerfile`, rồi chuyển dữ liệu bằng sao lưu / khôi phục — không chỉ đổi số phiên bản image (thư mục dữ liệu Postgres không tương thích giữa các major).

## 5. Gỡ bỏ

`docker compose -f deploy/docker-compose.yml down` dừng hệ thống, giữ dữ liệu. Thêm `-v` sẽ **xóa vĩnh viễn** database và các bản sao lưu trên máy — chỉ làm khi đã có bản sao lưu ở nơi khác.
