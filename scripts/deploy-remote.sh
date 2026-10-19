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

VOICE_BUNDLE=dist/voice-gateway.mjs
voice_before="$( [[ -f "$VOICE_BUNDLE" ]] && sha256sum "$VOICE_BUNDLE" | cut -d' ' -f1 || echo none )"

npm install
npm run build

voice_after="$(sha256sum "$VOICE_BUNDLE" | cut -d' ' -f1)"

unit_exists() { systemctl list-unit-files --no-legend "$1" 2>/dev/null | grep -q .; }

if command -v systemctl >/dev/null 2>&1; then
  # Web: restart now. With the voice worker installed (VOICE_GATEWAY_MODE=external) this never
  # touches a live call.
  sudo systemctl restart "$SERVICE_NAME"
  sudo systemctl is-active --quiet "$SERVICE_NAME"

  # Jobs process, if installed.
  if unit_exists "${SERVICE_NAME}-jobs.service"; then
    sudo systemctl restart "${SERVICE_NAME}-jobs"
  fi

  # Voice workers, only when the voice code changed. One at a time: each drains (no new calls,
  # waits for live ones, up to 15 min) while the other keeps taking calls. Runs detached so this
  # deploy doesn't wait on the drains — follow it with: journalctl -u '${SERVICE_NAME}-voice-rollout-*' -f
  if unit_exists "${SERVICE_NAME}-voice@.service"; then
    if [[ "$voice_before" != "$voice_after" ]]; then
      echo "Voice code changed — rolling voice workers (draining one at a time)"
      sudo systemd-run --no-block --collect --unit="${SERVICE_NAME}-voice-rollout-$(date +%s)" \
        /bin/bash -c "systemctl restart ${SERVICE_NAME}-voice@3001 && systemctl restart ${SERVICE_NAME}-voice@3011"
    else
      echo "Voice code unchanged — voice workers keep running (no calls touched)"
    fi
  fi
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
