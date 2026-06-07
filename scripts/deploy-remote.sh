#!/usr/bin/env bash
# Runs on the EC2 host after CI checks pass. Expects DEPLOY_PATH and optional GIT_SHA.
set -euo pipefail

DEPLOY_PATH="${DEPLOY_PATH:-/var/www/html/webespoke}"
GIT_SHA="${GIT_SHA:-}"
SERVICE_NAME="${SERVICE_NAME:-webespoke}"
APP_PORT="${APP_PORT:-3000}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:${APP_PORT}/}"

cd "$DEPLOY_PATH"

if [[ -n "$GIT_SHA" ]]; then
  git fetch origin --depth=1
  git checkout --force "$GIT_SHA"
else
  git fetch origin main --depth=1
  git checkout --force origin/main
fi

export NODE_ENV=production
export CI=true

if [[ ! -f .env ]]; then
  echo "ERROR: ${DEPLOY_PATH}/.env is missing. Create it from .env.example before deploying." >&2
  exit 1
fi

npm install
npm run build

if command -v systemctl >/dev/null 2>&1; then
  sudo systemctl restart "$SERVICE_NAME"
  sudo systemctl is-active --quiet "$SERVICE_NAME"
else
  echo "WARN: systemctl not found; restart the app process manually." >&2
fi

for attempt in 1 2 3 4 5; do
  if curl -fsS --max-time 15 "$HEALTH_URL" >/dev/null; then
    echo "Health check passed (${HEALTH_URL})"
    exit 0
  fi
  echo "Health check attempt ${attempt}/5 failed; retrying..."
  sleep 3
done

echo "ERROR: Health check failed after deploy (${HEALTH_URL})" >&2
exit 1
