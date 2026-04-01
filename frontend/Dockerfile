# Stage 1: Build
FROM node:20-alpine AS build
WORKDIR /app

# Accept build-time Vite env vars from docker-compose
ARG VITE_RUNTIME_MODE=live
ARG VITE_API_URL=http://localhost:3001
ENV VITE_RUNTIME_MODE=$VITE_RUNTIME_MODE
ENV VITE_API_URL=$VITE_API_URL
ENV CI=true

COPY package*.json ./
RUN npm ci --silent
COPY . .
RUN npm run build

# Stage 2: Serve with nginx
FROM nginx:alpine

# gettext предоставляет envsubst — нужен для подстановки переменных в nginx конфиг
RUN apk add --no-cache gettext

COPY --from=build /app/dist /usr/share/nginx/html

# FIX [AUDIT]: ОБА nginx конфига копируются как шаблоны — docker-entrypoint.sh
# запускает envsubst для каждого, подставляя $BACKEND_URL и $YOUR_DOMAIN.
# nginx.conf       → dev/http конфиг (порт 80)
# nginx.prod.conf  → prod/https конфиг (подключается как volume при деплое с SSL)
COPY nginx.conf      /etc/nginx/nginx.conf.template
COPY nginx.prod.conf /etc/nginx/nginx.prod.conf.template
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 80 443

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost/ || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]
