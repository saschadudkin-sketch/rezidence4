# Deploy to Timeweb VPS/VDS

Canonical release guide for this repo. `DEPLOY_TIMEWEB.md` now points here so there is only one authoritative flow.

## Target Topology

```text
Internet
  |
  v
Timeweb VPS :80/:443
  |- frontend  nginx + Vite build
  |- backend   Express API (internal Docker port 3001)
  |- db        PostgreSQL 16
  |- redis     Redis 7
  `- backup    scheduled pg dumps into ./backups
```

Browser traffic must go to the frontend host only. nginx proxies `/api/` and `/uploads/` to the backend container. Do not expose backend port `3001` publicly.

## 1. Prepare the Server

Recommended baseline:

- Ubuntu 22.04 LTS or 24.04 LTS
- 2 GB RAM minimum, 4 GB preferred
- 30 GB disk minimum
- Open ports `22`, `80`, `443`

```bash
ssh root@SERVER_IP
apt update && apt upgrade -y
apt install -y git curl ca-certificates ufw
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
```

## 2. Install Docker

```bash
curl -fsSL https://get.docker.com | sh
docker version
docker compose version
```

## 3. Upload the Project

Preferred path if you have Git:

```bash
mkdir -p /var/www
git clone REPOSITORY_URL /var/www/rezidence4
cd /var/www/rezidence4
```

Fallback if you deploy from an archive:

```bash
mkdir -p /var/www/rezidence4
# upload files with scp/SFTP/Timeweb file manager
cd /var/www/rezidence4
```

## 4. Configure `.env`

```bash
cp .env.example .env
nano .env
```

First HTTP launch by server IP:

```env
DB_PASSWORD=generate_a_long_database_password
JWT_SECRET=generate_with_openssl_rand_hex_32
REDIS_PASSWORD=generate_with_openssl_rand_hex_24
SMSRU_API_ID=STUB
BACKEND_URL=http://SERVER_IP
FRONTEND_URL=http://SERVER_IP
YOUR_DOMAIN=SERVER_IP
ENABLE_HTTPS=false
```

Generate secrets on the server:

```bash
openssl rand -hex 24
openssl rand -hex 32
```

If you have a real domain, create DNS `A` records before enabling HTTPS:

```text
example.com     A     SERVER_IP
www.example.com A     SERVER_IP
```

Then use:

```env
BACKEND_URL=https://example.com
FRONTEND_URL=https://example.com
YOUR_DOMAIN=example.com
ENABLE_HTTPS=true
```

## 5. Build and Launch

```bash
docker compose up -d --build
docker compose ps
curl -I http://SERVER_IP
curl http://SERVER_IP/api/health
```

Healthy first launch means `db`, `backend`, `frontend`, `redis`, and `backup` are `running` or `healthy`.

## 6. Seed the First Admin

```bash
docker compose exec backend node src/seed.js
```

This creates the initial admin with phone `+70000000000`. Replace it immediately:

```bash
docker compose exec db psql -U residenze -d residenze -c \
  "UPDATE users SET phone='+7YOUR10DIGITS', name='Admin Name' WHERE role='admin';"
```

## 7. Verify Login Flow

Open `http://SERVER_IP` and request an SMS code for the seeded admin.

With `SMSRU_API_ID=STUB`, the OTP is printed to backend logs:

```bash
docker compose logs backend | grep STUB
```

Use that code to log in and confirm the dashboard loads.

## 8. Enable HTTPS

HTTPS requires a real domain. Let's Encrypt does not issue normal certificates for bare IP addresses.

```bash
docker compose stop frontend
docker run --rm -p 80:80 \
  -v /etc/letsencrypt:/etc/letsencrypt \
  -v /var/www/certbot:/var/www/certbot \
  certbot/certbot certonly --standalone \
  -d example.com
```

Make sure `docker-compose.yml` exposes `443` and mounts the certificate volumes, then update `.env`:

```env
BACKEND_URL=https://example.com
FRONTEND_URL=https://example.com
YOUR_DOMAIN=example.com
ENABLE_HTTPS=true
```

Rebuild because `VITE_API_URL` is compiled into the frontend bundle:

```bash
docker compose up -d --build
curl -I https://example.com
curl https://example.com/api/health
```

Renew certificates:

```bash
docker run --rm -p 80:80 \
  -v /etc/letsencrypt:/etc/letsencrypt \
  -v /var/www/certbot:/var/www/certbot \
  certbot/certbot renew
docker compose restart frontend
```

## 9. Release Updates

```bash
cd /var/www/rezidence4
git pull
docker compose up -d --build
docker compose ps
```

If the server is updated by file upload instead of Git, upload the new files and still run `docker compose up -d --build`.

## 9.1 Rollback Procedure

If the new release is unhealthy after `docker compose up -d --build`, roll back immediately to the previous known-good revision.

1. Find the last stable commit:

```bash
cd /var/www/rezidence4
git log --oneline -n 5
```

2. Check out that commit or tag:

```bash
git checkout PREVIOUS_GOOD_SHA
```

3. Rebuild and restart the stack from the reverted sources:

```bash
docker compose up -d --build
docker compose ps
curl -I http://SERVER_IP
curl http://SERVER_IP/api/health
```

4. Verify the critical user paths:

- login works for the admin account
- `/api/health` returns `200`
- frontend root returns HTML
- background jobs and SSE reconnect without errors in backend logs

5. Only after the rollback is stable, investigate the failed release on a separate branch or staging environment.

Notes:

- `db_data` and `uploads` volumes are preserved during rollback, so application data is not deleted.
- Do not run destructive volume commands such as `docker compose down -v` during rollback unless you explicitly intend to wipe state.

## 10. Useful Operations

```bash
docker compose ps
docker compose logs --tail=100 backend
docker compose logs --tail=100 frontend
docker compose exec db pg_isready -U residenze
docker compose exec redis redis-cli -a "$REDIS_PASSWORD" ping
docker compose run --rm backup /backup.sh
ls -lah backups
docker compose down
```

## 11. Common Failures

Site not reachable:

```bash
docker compose ps
docker compose logs frontend
```

OTP not arriving:

```bash
docker compose logs backend | grep -i sms
```

User phone not found:

- The user is missing from `users`.
- Create it from the admin UI or insert it directly in PostgreSQL.

Database not starting:

```bash
docker compose logs db
```
