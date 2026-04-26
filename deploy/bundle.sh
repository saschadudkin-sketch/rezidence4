#!/bin/bash
# bundle.sh — создаёт production deploy bundle (.tar.gz)
#
# Использует `git archive` чтобы взять только tracked files из current HEAD.
# Исключает tests, CI configs, docs, dev-only — всё, что не нужно runtime'у.
#
# Использование:
#   cd /path/to/rezidence4
#   bash deploy/bundle.sh
#   → создаст deploy/bundle-YYYYMMDD-HHMM.tar.gz
#
# Затем:
#   scp deploy/bundle-*.tar.gz deploy@vps:/opt/domhub/
#
# На VPS:
#   cd /opt/domhub
#   tar -xzf bundle-*.tar.gz
#   cp deploy/.env.production.template .env
#   chmod 600 .env
#   # заполнить .env
#   docker compose up -d

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

TIMESTAMP=$(date -u +'%Y%m%d-%H%M')
COMMIT_SHA=$(git rev-parse --short HEAD)
BUNDLE="deploy/bundle-${TIMESTAMP}-${COMMIT_SHA}.tar.gz"

# Файлы и папки, которые нужны runtime'у:
INCLUDE_PATHS=(
  # Compose orchestration
  docker-compose.yml

  # Backend
  backend/Dockerfile
  backend/.dockerignore
  backend/package.json
  backend/package-lock.json
  backend/src

  # Frontend
  frontend/Dockerfile
  frontend/.dockerignore
  frontend/package.json
  frontend/package-lock.json
  frontend/src
  frontend/index.html
  frontend/vite.config.js
  frontend/tsconfig.json
  frontend/tsconfig.strict.json
  frontend/postcss.config.js
  frontend/eslint.config.js
  frontend/public
  frontend/nginx.conf

  # Ops (postgres init, alerts)
  ops

  # Deploy guides
  deploy/README.md
  deploy/.env.production.template
  deploy/check-config.sh
)

# Валидация: проверим что все INCLUDE_PATHS существуют
echo "[bundle] verifying paths exist..."
MISSING=()
for path in "${INCLUDE_PATHS[@]}"; do
  if [ ! -e "$path" ]; then
    MISSING+=("$path")
  fi
done
if [ ${#MISSING[@]} -gt 0 ]; then
  echo "[bundle] WARNING: missing paths (skipping):"
  printf "  - %s\n" "${MISSING[@]}"
fi

# Используем git archive — берёт только git-tracked files,
# автоматически исключает .gitignore'd (node_modules, coverage, etc).
EXISTING_PATHS=()
for path in "${INCLUDE_PATHS[@]}"; do
  if [ -e "$path" ]; then
    EXISTING_PATHS+=("$path")
  fi
done

echo "[bundle] creating $BUNDLE..."
git archive --format=tar.gz --output="$BUNDLE" HEAD "${EXISTING_PATHS[@]}"

SIZE=$(du -h "$BUNDLE" | cut -f1)
echo "[bundle] ✓ created $BUNDLE ($SIZE)"
echo ""
echo "Next steps:"
echo "  1. Verify contents:    tar -tzf $BUNDLE | head -30"
echo "  2. Upload to VPS:      scp $BUNDLE deploy@vps:/opt/domhub/"
echo "  3. On VPS:             cd /opt/domhub && tar -xzf $(basename $BUNDLE)"
echo "  4. Setup .env:         cp deploy/.env.production.template .env && chmod 600 .env && nano .env"
echo "  5. Pre-flight check:   bash deploy/check-config.sh"
echo "  6. Start stack:        docker compose up -d"
