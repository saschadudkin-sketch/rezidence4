FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

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
