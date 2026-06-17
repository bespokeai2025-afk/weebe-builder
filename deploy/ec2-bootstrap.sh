#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# WEBEE — One-time EC2 host bootstrap
#
# Run this ONCE on a fresh EC2 instance (Amazon Linux 2023 or Ubuntu 22.04+)
# to create the directory layout expected by deploy-remote.sh.
#
# After running:
#   1. Create /var/www/webee/.env with your runtime secrets (see DEPLOY_AWS.md)
#   2. Push to main — GitHub Actions will build + deploy automatically
#
# Usage:
#   bash deploy/ec2-bootstrap.sh
#   bash deploy/ec2-bootstrap.sh ubuntu  # pass deploy user as first arg
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

DEPLOY_USER="${1:-deploy}"
WEBEE_ROOT="/var/www/webee"

echo "[bootstrap] Creating directory layout at ${WEBEE_ROOT}…"
sudo mkdir -p "${WEBEE_ROOT}/releases"
sudo chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "${WEBEE_ROOT}"
sudo chmod 750 "${WEBEE_ROOT}"

echo "[bootstrap] Creating placeholder .env (you MUST populate this before deploying)…"
if [[ ! -f "${WEBEE_ROOT}/.env" ]]; then
  sudo -u "${DEPLOY_USER}" tee "${WEBEE_ROOT}/.env" > /dev/null << 'ENVEOF'
# WEBEE runtime secrets — fill these in before the first deploy.
# See DEPLOY_AWS.md → Environment variables → Runtime for the full list.

NODE_ENV=production
PORT=3000

VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=

RETELL_API_KEY=
PUBLIC_SITE_URL=
ENVEOF
  echo "[bootstrap] Created ${WEBEE_ROOT}/.env — populate it now."
else
  echo "[bootstrap] ${WEBEE_ROOT}/.env already exists — skipping."
fi

# Install the systemd service unit
echo "[bootstrap] Installing systemd service…"
sudo cp "$(dirname "$0")/webespoke.service" /etc/systemd/system/webee.service
sudo systemctl daemon-reload
sudo systemctl enable webee
echo "[bootstrap] Service 'webee' registered (not started yet — deploy first)."

echo ""
echo "Bootstrap complete. Next steps:"
echo "  1. Edit ${WEBEE_ROOT}/.env with your production secrets"
echo "  2. Configure GitHub Actions secrets (see DEPLOY_AWS.md)"
echo "  3. Push to main — the pipeline will build and deploy automatically"
echo "  4. After the first deploy: sudo systemctl start webee"
