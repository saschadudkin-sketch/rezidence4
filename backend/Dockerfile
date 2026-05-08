# syntax=docker/dockerfile:1.7
FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev \
      --fetch-retries=5 \
      --fetch-retry-mintimeout=20000 \
      --fetch-retry-maxtimeout=120000 \
      --fetch-timeout=300000

COPY src ./src

# Uploads directory — mount as volume in production
RUN mkdir -p /app/uploads

# FIX [AUDIT]: процесс запускается от непривилегированного пользователя.
# Без этого при RCE-уязвимости в зависимости атакующий получает root внутри контейнера,
# откуда значительно проще выйти в хост-систему.
# node:20-alpine уже содержит пользователя 'node' (uid=1000) — используем его.
RUN chown -R node:node /app
USER node

EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3001/api/health || exit 1

CMD ["node", "src/index.js"]
