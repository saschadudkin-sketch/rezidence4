# Деплой на Timeweb Cloud VPS

## Требования

- VPS с Ubuntu 22.04 или 24.04 (минимум 1 CPU, 1 GB RAM)
- Домен, направленный на IP сервера
- Docker + Docker Compose (устанавливается ниже)

---

## 1. Подготовка сервера

```bash
# Подключиться к VPS
ssh user@your-server-ip

# Установить Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker

# Установить Docker Compose Plugin
sudo apt-get install -y docker-compose-plugin
```

---

## 2. Загрузить проект

```bash
# Клонировать репозиторий (или загрузить архив)
git clone https://github.com/your-org/residenze.git /home/user/residenze
cd /home/user/residenze

# Создать .env с настройками
cp .env.example .env
nano .env
```

Заполните `.env`:
```env
VITE_RUNTIME_MODE=live
VITE_API_URL=https://api.your-domain.ru
BACKEND_URL=https://api.your-domain.ru
```

---

## 3. Запустить фронтенд

```bash
cd /home/user/residenze
docker compose up -d --build

# Проверить
curl http://localhost
```

Переменная `BACKEND_URL` автоматически подставится в CSP-заголовок nginx при старте контейнера.

---

## 4. HTTPS через Let's Encrypt (обязательно для production)

```bash
sudo apt install -y certbot python3-certbot-nginx

# Получить сертификат (nginx должен слушать 80)
sudo certbot --nginx -d your-domain.ru -d www.your-domain.ru

# Автообновление уже настроено через systemd timer
# Проверить:
sudo systemctl status certbot.timer
```

После получения сертификата nginx на хосте будет проксировать HTTPS → Docker контейнер.

**Пример /etc/nginx/sites-available/residenze:**
```nginx
server {
    listen 443 ssl;
    server_name your-domain.ru www.your-domain.ru;

    ssl_certificate     /etc/letsencrypt/live/your-domain.ru/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.ru/privkey.pem;

    location / {
        proxy_pass http://localhost:80;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name your-domain.ru www.your-domain.ru;
    return 301 https://$host$request_uri;
}
```

```bash
sudo ln -s /etc/nginx/sites-available/residenze /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

---

## 5. Обновление

```bash
cd /home/user/residenze
git pull
docker compose up -d --build
```

---

## 6. Просмотр логов

```bash
# Логи контейнера
docker compose logs -f frontend

# Статус
docker compose ps
```

---

## Troubleshooting

**Шрифты не загружаются** — убедитесь, что BACKEND_URL в `.env` не содержит trailing slash и соответствует реальному URL backend.

**API не работает** — проверьте, что backend запущен и `BACKEND_URL` в `.env` указывает на правильный адрес.

**CSP блокирует запросы** — в браузере откройте DevTools → Console. Если видите `Content Security Policy`, проверьте `BACKEND_URL` и пересоберите контейнер.
