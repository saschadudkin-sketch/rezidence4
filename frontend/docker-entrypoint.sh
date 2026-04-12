#!/bin/sh
# docker-entrypoint.sh — интерполируем переменные окружения в nginx конфиги.
#
# FIX [AUDIT]: nginx НЕ интерполирует переменные в add_header без envsubst.
# Без этого браузер получает буквальный "$BACKEND_URL" в Content-Security-Policy,
# что блокирует загрузку фото с бэкенда и SSE-соединение.
#
# Обрабатывает ДВА шаблона:
#   /etc/nginx/nginx.conf.template      → /etc/nginx/nginx.conf      (dev / http)
#   /etc/nginx/nginx.prod.conf.template → отдельный файл (prod / https, если подключён)
#
# Переменные окружения (задаются в docker-compose):
#   BACKEND_URL  — URL бэкенда, например: http://1.2.3.4:3001 или https://api.example.com
#   YOUR_DOMAIN  — домен фронта (только для HTTPS-конфига), например: example.com

set -e

BACKEND_URL="${BACKEND_URL:-}"
YOUR_DOMAIN="${YOUR_DOMAIN:-localhost}"
ENABLE_HTTPS="${ENABLE_HTTPS:-false}"

if [ -z "$BACKEND_URL" ]; then
  echo "[entrypoint] ERROR: BACKEND_URL is not set."
  echo "[entrypoint] Set BACKEND_URL in docker-compose environment section."
  exit 1
fi

echo "[entrypoint] BACKEND_URL=$BACKEND_URL  YOUR_DOMAIN=$YOUR_DOMAIN  ENABLE_HTTPS=$ENABLE_HTTPS"

# ── Основной конфиг (dev / http) ──────────────────────────────────────────────
DEV_TEMPLATE="/etc/nginx/nginx.conf.template"
DEV_TARGET="/etc/nginx/conf.d/default.conf"

if [ -f "$DEV_TEMPLATE" ]; then
  envsubst '$BACKEND_URL $YOUR_DOMAIN' < "$DEV_TEMPLATE" > "$DEV_TARGET"
  echo "[entrypoint] Generated $DEV_TARGET from $DEV_TEMPLATE"
else
  echo "[entrypoint] WARNING: $DEV_TEMPLATE not found, using existing nginx.conf"
fi

# ── Production HTTPS конфиг (если подключён как volume) ───────────────────────
PROD_TEMPLATE="/etc/nginx/nginx.prod.conf.template"
if [ "$ENABLE_HTTPS" = "true" ] && [ -f "$PROD_TEMPLATE" ]; then
  PROD_TARGET="/etc/nginx/conf.d/default.conf"
  envsubst '$BACKEND_URL $YOUR_DOMAIN' < "$PROD_TEMPLATE" > "$PROD_TARGET"
  echo "[entrypoint] Generated $PROD_TARGET from $PROD_TEMPLATE"
fi

echo "[entrypoint] Validating nginx config..."
nginx -t

echo "[entrypoint] Starting nginx..."
exec nginx -g 'daemon off;'
