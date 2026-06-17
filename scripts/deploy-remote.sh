#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# WEBEE — Atomic EC2 deploy script
#
# Runs ON THE EC2 HOST after the pre-built release tarball has been uploaded
# by GitHub Actions. This script NEVER runs npm run build.
#
# What it does:
#   1. Creates a new timestamped release folder
#   2. Extracts the pre-built dist/ tarball into it
#   3. Installs production-only Node deps (npm ci --omit=dev — fast, no build)
#   4. Atomically switches the `current` symlink to the new release
#   5. Restarts the systemd service
#   6. Runs a structured health check against /api/health
#   7. Rolls back to the previous release if the health check fails
#   8. Prunes old releases (keeps last 5)
#
# Required env (passed by GitHub Actions):
#   TARBALL   — absolute path of the uploaded tarball on THIS host
#   GIT_SHA   — git commit SHA being deployed
#
# Optional env (all have sensible defaults):
#   RELEASES_ROOT  default: /var/www/webee/releases
#   CURRENT_LINK   default: /var/www/webee/current
#   SERVICE_NAME   default: webee
#   APP_PORT       default: 3000
#   HEALTH_RETRIES default: 6
#   HEALTH_TIMEOUT default: 15  (seconds per curl attempt)
#   KEEP_RELEASES  default: 5
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

TARBALL="${TARBALL:?TARBALL env var must be set to the uploaded tarball path}"
GIT_SHA="${GIT_SHA:-unknown}"
RELEASES_ROOT="${RELEASES_ROOT:-/var/www/webee/releases}"
CURRENT_LINK="${CURRENT_LINK:-/var/www/webee/current}"
SERVICE_NAME="${SERVICE_NAME:-webee}"
APP_PORT="${APP_PORT:-3000}"
HEALTH_RETRIES="${HEALTH_RETRIES:-6}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-15}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"

HEALTH_URL="http://127.0.0.1:${APP_PORT}/api/health"
TIMESTAMP=$(date +%Y%m%d%H%M%S)
RELEASE_DIR="${RELEASES_ROOT}/${TIMESTAMP}"

log()  { echo "[deploy $(date +%H:%M:%S)] $*"; }
warn() { echo "[deploy $(date +%H:%M:%S)] WARN: $*" >&2; }
die()  { echo "[deploy $(date +%H:%M:%S)] ERROR: $*" >&2; exit 1; }

# ── Record previous release for rollback ─────────────────────────────────────
PREVIOUS_RELEASE=""
if [[ -L "${CURRENT_LINK}" ]]; then
  PREVIOUS_RELEASE=$(readlink -f "${CURRENT_LINK}" 2>/dev/null || true)
  log "Previous release: ${PREVIOUS_RELEASE:-none}"
fi

# ── Rollback on any error ─────────────────────────────────────────────────────
rollback() {
  if [[ -z "${PREVIOUS_RELEASE}" ]]; then
    warn "No previous release to roll back to — manual intervention required."
    return
  fi
  log "Rolling back to ${PREVIOUS_RELEASE}…"
  ln -sfn "${PREVIOUS_RELEASE}" "${CURRENT_LINK}"
  if command -v systemctl >/dev/null 2>&1; then
    sudo systemctl restart "${SERVICE_NAME}" || warn "Service restart failed during rollback"
  fi
  log "Rollback complete."
  rm -rf "${RELEASE_DIR}" 2>/dev/null || true
}

trap '
  EXIT_CODE=$?
  if [[ $EXIT_CODE -ne 0 ]]; then
    echo "[deploy] Deploy failed (exit ${EXIT_CODE}) — rolling back…" >&2
    rollback
  fi
  exit $EXIT_CODE
' EXIT

# ── 1. Create release folder ──────────────────────────────────────────────────
log "Creating release: ${RELEASE_DIR}"
mkdir -p "${RELEASE_DIR}"

# ── 2. Extract pre-built artifact ────────────────────────────────────────────
log "Extracting ${TARBALL} → ${RELEASE_DIR}"
tar -xzf "${TARBALL}" -C "${RELEASE_DIR}"

# Stamp the release with deploy metadata (read by /api/health → COMMIT_SHA)
echo "${GIT_SHA}"   > "${RELEASE_DIR}/.deploy_sha"
echo "${TIMESTAMP}" > "${RELEASE_DIR}/.deploy_timestamp"
echo "COMMIT_SHA=${GIT_SHA}" >> "${RELEASE_DIR}/.env.deploy"

# ── 3. Install production-only dependencies (NO build step) ──────────────────
log "Installing production deps (npm ci --omit=dev)…"
cd "${RELEASE_DIR}"

# Point npm to the shared cache to speed up cold installs.
npm ci --omit=dev --prefer-offline 2>&1 | tail -5

# ── 4. Link .env ──────────────────────────────────────────────────────────────
# The canonical .env lives at /var/www/webee/.env — outside all release folders
# so it survives rollbacks and re-deploys.
WEBEE_ROOT=$(dirname "${CURRENT_LINK}")
if [[ -f "${WEBEE_ROOT}/.env" ]]; then
  log "Linking ${WEBEE_ROOT}/.env"
  ln -sf "${WEBEE_ROOT}/.env" "${RELEASE_DIR}/.env"
else
  warn ".env not found at ${WEBEE_ROOT}/.env — the service may fail to start."
  warn "Create it at ${WEBEE_ROOT}/.env before deploying."
fi

# ── 5. Atomic symlink switch ──────────────────────────────────────────────────
log "Switching current → ${RELEASE_DIR}"
ln -sfn "${RELEASE_DIR}" "${CURRENT_LINK}"

# ── 6. Restart service ────────────────────────────────────────────────────────
log "Restarting ${SERVICE_NAME}…"
if command -v systemctl >/dev/null 2>&1; then
  sudo systemctl restart "${SERVICE_NAME}"
  sleep 2
  sudo systemctl is-active --quiet "${SERVICE_NAME}" \
    || die "Service ${SERVICE_NAME} failed to become active after restart"
else
  warn "systemctl not found — restart the app process manually."
fi

# ── 7. Health check ───────────────────────────────────────────────────────────
log "Health check: ${HEALTH_URL}"
for attempt in $(seq 1 "${HEALTH_RETRIES}"); do
  HTTP_CODE=$(curl -o /dev/null -w "%{http_code}" -fsS \
    --max-time "${HEALTH_TIMEOUT}" \
    "${HEALTH_URL}" 2>/dev/null || echo "000")

  if [[ "${HTTP_CODE}" == "200" ]]; then
    log "✓ Health check passed (HTTP 200) on attempt ${attempt}/${HEALTH_RETRIES}"
    break
  fi

  if [[ "${attempt}" -eq "${HEALTH_RETRIES}" ]]; then
    die "Health check failed after ${HEALTH_RETRIES} attempts (last status: HTTP ${HTTP_CODE})"
  fi

  log "Attempt ${attempt}/${HEALTH_RETRIES}: HTTP ${HTTP_CODE} — retrying in 5s…"
  sleep 5
done

# ── 8. Clean up tarball ───────────────────────────────────────────────────────
log "Removing uploaded tarball: ${TARBALL}"
rm -f "${TARBALL}"

# ── 9. Prune old releases ─────────────────────────────────────────────────────
log "Pruning old releases (keeping last ${KEEP_RELEASES})…"
ls -1dt "${RELEASES_ROOT}"/[0-9]* 2>/dev/null \
  | tail -n "+$((KEEP_RELEASES + 1))" \
  | xargs --no-run-if-empty rm -rf

DEPLOYED_SHA=$(cat "${RELEASE_DIR}/.deploy_sha" 2>/dev/null || echo "${GIT_SHA}")
log "Deploy complete — SHA: ${DEPLOYED_SHA} | Release: ${RELEASE_DIR}"
