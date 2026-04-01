.PHONY: check-observability validate-loadtest-scripts canary

# Проверка согласованности alert rules ↔ docs/runbook
check-observability:
	node ops/check_observability_consistency.js

# Валидация синтаксиса resilience/canary скриптов
validate-loadtest-scripts:
	node --check loadtest/auth_resilience.js
	bash -n loadtest/synthetic_canary.sh

# Быстрый synthetic canary (нужен TOKEN)
# Пример:
#   make canary BASE_URL=http://localhost:3001 TOKEN=<jwt>
canary:
	@if [ -z "$(TOKEN)" ]; then \
		echo "TOKEN is required. Usage: make canary BASE_URL=http://localhost:3001 TOKEN=<jwt>"; \
		exit 2; \
	fi
	BASE_URL=$${BASE_URL:-http://localhost:3001} TOKEN=$(TOKEN) ./loadtest/synthetic_canary.sh
