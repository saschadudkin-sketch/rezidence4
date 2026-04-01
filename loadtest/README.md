# Load / Resilience tooling

Набор скриптов для проверки устойчивости ключевых API-путей.

## 1) `auth_resilience.js` (k6)

Проверяет hot-path авторизации (`GET /api/auth/me`) под нагрузкой.

### Что измеряет
- `auth_me_latency` (p95/p99)
- `auth_errors` (error rate)

### Запуск
```bash
k6 run loadtest/auth_resilience.js \
  -e BASE_URL=http://localhost:3001 \
  -e TEST_TOKEN=<jwt>
```

Результаты сохраняются в:
- `loadtest/auth_resilience_results.json`

### Сравнение с baseline (регрессия)
```bash
# 1) Создайте baseline из стабильного прогона
cp loadtest/auth_resilience_results.json loadtest/baselines/auth_resilience_baseline.json

# 2) После нового прогона сравните с baseline
node loadtest/compare_auth_resilience.js
```

По умолчанию check валится, если:
- `p95` вырос > 15%
- `p99` вырос > 20%
- `auth_errors.rate` > 1%

---

## 2) `synthetic_canary.sh`

Быстрый smoke/canary для критичных endpoint'ов:
- `GET /api/health`
- `GET /api/auth/me` (по cookie token)
- `GET /api/chat/stream` (SSE handshake + content-type)

### Запуск
```bash
BASE_URL=http://localhost:3001 \
TOKEN=<jwt> \
TIMEOUT_SECONDS=10 \
./loadtest/synthetic_canary.sh
```

---

## Рекомендованный порядок в pre-prod

1. Прогнать `synthetic_canary.sh` (быстрая проверка доступности и auth/SSE handshake).
2. Прогнать `auth_resilience.js` (k6) и сравнить p95/p99 с базовой линией.
3. При деградации:
   - проверить DB/Redis состояние,
   - проверить rate-limit и reconnect метрики,
   - приложить отчёт `auth_resilience_results.json` к инциденту/PR.
