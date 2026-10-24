# HRM DevOps – Đề 10: Hệ thống Quản lý Nhân sự

**Sinh viên:** DTC245160058  
**Môn:** Triển khai và Quản trị Hệ thống Phần mềm

Ứng dụng quản lý nhân viên, phòng ban, chấm công, triển khai toàn bộ bằng **Docker Compose**:
Node.js (Express) + PostgreSQL 16 + pgAdmin + Nginx (HTTPS) + Prometheus + Grafana + Loki/Promtail.

## Kiến trúc

| Service | Vai trò | Mạng |
|---|---|---|
| nginx | Reverse proxy HTTPS, security headers, rate limit | frontend |
| app | Ứng dụng HRM (Node.js), xuất `/metrics` | frontend, backend |
| db | PostgreSQL 16 | backend (internal) |
| pgadmin | Công cụ quản lý DB | frontend, backend |
| prometheus | Thu thập metrics | monitoring, frontend |
| grafana | Dashboard + truy vấn log | monitoring, frontend |
| cadvisor / nginx-exporter / postgres-exporter | Exporter cho container / web / DB | monitoring |
| loki / promtail | Log tập trung | monitoring (internal) |

Chỉ cổng **80/443** được mở ra ngoài; `backend` và `monitoring` là mạng `internal`.

## Yêu cầu

Ubuntu 22.04/24.04, Docker Engine + Docker Compose plugin, `openssl`, `apache2-utils`.

## Cách chạy

```bash
git clone git@github.com:DTC245160058/hrm-devops.git && cd hrm-devops
cp .env.example .env          # đổi toàn bộ CHANGE_ME thành mật khẩu mạnh, đặt SERVER_IP
chmod 600 .env
source .env
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout nginx/certs/server.key -out nginx/certs/server.crt \
  -subj "/C=VN/O=HRM/CN=${SERVER_IP}" -addext "subjectAltName=IP:${SERVER_IP}"
sudo chown 101:101 nginx/certs/server.key && sudo chmod 600 nginx/certs/server.key
htpasswd -cB nginx/htpasswd admin && chmod 644 nginx/htpasswd
docker compose up -d --build
docker compose ps
```

## Truy cập

| Dịch vụ | URL |
|---|---|
| Web HRM | https://SERVER_IP/ |
| pgAdmin | https://SERVER_IP/pgadmin/ |
| Grafana (+ Loki Explore) | https://SERVER_IP/grafana/ |
| Prometheus (basic auth) | https://SERVER_IP/prometheus/ |

Dashboard Grafana import theo ID: **14282** (container), **9628** (PostgreSQL), **12708** (NGINX).

## LogQL mẫu

```
{service="nginx"}
{service="nginx"} | json | __error__="" | status >= 400
{service="app", level=~"warn|error"}
sum by (status) (count_over_time({service="nginx"} | json | __error__="" [5m]))
{service="db"} |~ "(?i)authentication failed"
```

## Hardening

- Container chạy **non-root** (app uid 1000, nginx 101, grafana 472, prometheus 65534, loki 10001)
- **Cô lập mạng**: DB và monitoring nằm trong mạng `internal`, không publish port
- **Mật khẩu mạnh** sinh ngẫu nhiên 32 ký tự trong `.env` (quyền 600, không commit)
- **Hạn chế quyền DB**: app dùng user `hrm_app` chỉ có SELECT/INSERT/UPDATE/DELETE; exporter chỉ có `pg_monitor`
- **HTTPS + security headers** (HSTS, X-Frame-Options, nosniff, CSP, Referrer-Policy), `server_tokens off`
- `read_only`, `cap_drop: ALL`, `no-new-privileges`, rate limit, chặn `/metrics`, basic auth cho Prometheus, xoay vòng log, UFW

## Lệnh quản trị thường dùng

```bash
docker compose ps                 # trạng thái
docker compose logs -f app        # xem log
docker compose restart nginx      # khởi động lại 1 service
docker compose down               # dừng (giữ dữ liệu)
```
