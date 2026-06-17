#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# WEBEE — Manual rollback script
#
# Run this ON THE EC2 HOST to roll back to the previous (or a specific) release.
#
# Usage:
#   bash scripts/rollback.sh                 # roll back to previous release
#   bash scripts/rollback.sh 20240617142300  # roll back to a specific timestamp
#
# Optional env:
#   RELEASES_ROOT  default: /var/www/webee/releases
#   CURRENT_LINK   default: /var/www/webee/current
#   SERVICE_NAME   default: webee
#   APP_PORT       default: 3000
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

RELEASES_ROOT="${RELEASES_ROOT:-/var/www/webee/releases}"
CURRENT_LINK="${CURRENT_LINK:-/var/www/webee/current}"
SERVICE_NAME="${SERVICE_NAME:-webee}"
APP_PORT="${APP_PORT:-3000}"
TARGET_RELEASE="${1:-}"

log()  { echo "[rollback $(date +%H:%M:%S)] $*"; }
die()  { echo "[rollback $(date +%H:%M:%S)] ERROR: $*" >&2; exit 1; }

# ── List available releases ───────────────────────────────────────────────────
log "Available releases in ${RELEASES_ROOT}:"
ls -1dt "${RELEASES_ROOT}"/[0-9]* 2>/dev/null | while read -r r; do
  SHA=$(cat "${r}/.deploy_sha" 2>/dev/null || echo "unknown")
  CURRENT_MARKER=""
  if [[ -L "${CURRENT_LINK}" ]] && [[ "$(readlink -f "${CURRENT_LINK}")" == "${r}" ]]; then
    CURRENT_MARKER=" ← current"
  fi
  echo "  $(basename "${r}")  SHA: ${SHA}${CURRENT_MARKER}"
done

# ── Determine target ──────────────────────────────────────────────────────────
if [[ -n "${TARGET_RELEASE}" ]]; then
  ROLLBACK_TO="${RELEASES_ROOT}/${TARGET_RELEASE}"
  [[ -d "${ROLLBACK_TO}" ]] || die "Release not found: ${ROLLBACK_TO}"
else
  # Default: the second-most-recent release
  CURRENT=$(readlink -f "${CURRENT_LINK}" 2>/dev/null || true)
  ROLLBACK_TO=$(ls -1dt "${RELEASES_ROOT}"/[0-9]* 2>/dev/null \
    | grep -v "^${CURRENT}$" \
    | head -1)
  [[ -n "${ROLLBACK_TO}" ]] || die "No previous release found to roll back to."
fi

log "Rolling back to: ${ROLLBACK_TO}"
SHA=$(cat "${ROLLBACK_TO}/.deploy_sha" 2>/dev/null || echo "unknown")
log "SHA: ${SHA}"

# ── Confirm ───────────────────────────────────────────────────────────────────
read -r -p "Confirm rollback to $(basename "${ROLLBACK_TO}") (SHA: ${SHA})? [y/N] " CONFIRM
[[ "${CONFIRM}" =~ ^[Yy]$ ]] || { log "Cancelled."; exit 0; }

# ── Switch symlink ────────────────────────────────────────────────────────────
log "Switching current → ${ROLLBACK_TO}"
ln -sfn "${ROLLBACK_TO}" "${CURRENT_LINK}"

# ── Restart service ───────────────────────────────────────────────────────────
log "Restarting ${SERVICE_NAME}…"
if command -v systemctl >/dev/null 2>&1; then
  sudo systemctl restart "${SERVICE_NAME}"
  sleep 2
  sudo systemctl is-active --quiet "${SERVICE_NAME}" \
    || die "Service failed to start after rollback"
else
  die "systemctl not found — restart the app manually."
fi

# ── Verify ────────────────────────────────────────────────────────────────────
HEALTH_URL="http://127.0.0.1:${APP_PORT}/api/health"
for attempt in 1 2 3 4 5 6; do
  HTTP_CODE=$(curl -o /dev/null -w "%{http_code}" -fsS \
    --max-time 15 "${HEALTH_URL}" 2>/dev/null || echo "000")
  if [[ "${HTTP_CODE}" == "200" ]]; then
    log "✓ Health check passed (HTTP 200)"
    break
  fi
  if [[ "${attempt}" -eq 6 ]]; then
    die "Health check failed after rollback (HTTP ${HTTP_CODE}) — manual intervention required"
  fi
  log "Attempt ${attempt}/6: HTTP ${HTTP_CODE} — retrying…"
  sleep 5
done

log "Rollback complete. Active release: ${ROLLBACK_TO} (SHA: ${SHA})"
