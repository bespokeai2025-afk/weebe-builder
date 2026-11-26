#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu EC2 instance for Webespoke. Safe to re-run.
#
#   cd /var/www/html/webespoke            # the cloned repo, with its .env in place
#   bash deploy/bootstrap-ec2.sh <domain> [--worker]
#
# Installs Node (the version in .nvmrc), nginx and certbot; adds swap when the instance has too
# little memory for the build; builds the app; installs the systemd service and the nginx site.
# --worker also installs the automation worker service. HTTPS is the step after this one (the
# script prints the command): certbot needs the domain's DNS to point at this server first.
#
# Later deploys are scripts/deploy-remote.sh, run by .github/workflows/deploy.yml on push to main.
set -euo pipefail

DOMAIN="${1:-}"
WITH_WORKER=false
[[ "${2:-}" == "--worker" ]] && WITH_WORKER=true
if [[ -z "$DOMAIN" || "$DOMAIN" == --* ]]; then
  echo "Usage: bash deploy/bootstrap-ec2.sh <domain> [--worker]" >&2
  exit 1
fi

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_USER="$(id -un)"
APP_GROUP="$(id -gn)"
NODE_MAJOR="$( (cut -d. -f1 < "$APP_DIR/.nvmrc" | tr -dc '0-9') 2>/dev/null || true)"
NODE_MAJOR="${NODE_MAJOR:-22}"
# The build is given this much heap in package.json; below it, the build is killed part-way.
BUILD_HEAP_MB="$( (grep -oE 'max-old-space-size=[0-9]+' "$APP_DIR/package.json" | grep -oE '[0-9]+' | sort -n | tail -1) || true)"
BUILD_HEAP_MB="${BUILD_HEAP_MB:-4096}"

step() { printf '\n==> %s\n' "$*"; }

if [[ ! -f "$APP_DIR/.env" ]]; then
  echo "ERROR: $APP_DIR/.env is missing. Copy it to the server first (see DEPLOY_AWS.md)." >&2
  exit 1
fi
if grep -qE '^(PUBLIC_APP_URL|WEBESPOKE_API_BASE_URL|PUBLIC_SITE_URL|PUBLIC_BASE_URL)=.*localhost' "$APP_DIR/.env"; then
  echo "WARN: .env still has localhost URLs — set them to https://$DOMAIN (emails, booking links and webhooks use them)." >&2
fi

step "System packages"
sudo apt-get update -y
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl git nginx certbot python3-certbot-nginx

step "Node $NODE_MAJOR"
if ! command -v node >/dev/null || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt "$NODE_MAJOR" ]]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash -
  sudo apt-get install -y nodejs
fi
node --version

step "Memory for the build (${BUILD_HEAP_MB} MB heap)"
MEM_MB="$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)"
SWAP_MB="$(awk '/SwapTotal/ {print int($2/1024)}' /proc/meminfo)"
NEED_MB=$(( BUILD_HEAP_MB + 2048 ))
if (( MEM_MB + SWAP_MB < NEED_MB )); then
  ADD_MB=$(( NEED_MB - MEM_MB - SWAP_MB + 1024 ))
  echo "RAM ${MEM_MB} MB + swap ${SWAP_MB} MB < ${NEED_MB} MB — adding ${ADD_MB} MB swap at /swapfile"
  if [[ ! -f /swapfile ]]; then
    sudo fallocate -l "${ADD_MB}M" /swapfile
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
  fi
  sudo swapon /swapfile 2>/dev/null || true
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
else
  echo "RAM ${MEM_MB} MB + swap ${SWAP_MB} MB is enough"
fi

step "Install and build"
cd "$APP_DIR"
npm install
npm run build

step "systemd service"
install_unit() {
  local src="$1" name="$2"
  sed -e "s#/var/www/html/webespoke#${APP_DIR}#g" \
      -e "s#^User=.*#User=${APP_USER}#" \
      -e "s#^Group=.*#Group=${APP_GROUP}#" \
      "$src" | sudo tee "/etc/systemd/system/${name}.service" >/dev/null
}
install_unit deploy/webespoke.service webespoke
if $WITH_WORKER; then
  install_unit deploy/webee-automation-worker.service webee-automation-worker
fi
sudo systemctl daemon-reload
sudo systemctl enable webespoke
sudo systemctl restart webespoke
if $WITH_WORKER; then
  sudo systemctl enable webee-automation-worker
  sudo systemctl restart webee-automation-worker
fi

step "Health check"
for attempt in $(seq 1 20); do
  if curl -fsS --max-time 5 -o /dev/null http://127.0.0.1:3000/; then
    echo "App answers on 127.0.0.1:3000"
    break
  fi
  if (( attempt == 20 )); then
    echo "ERROR: app did not answer — see: sudo journalctl -u webespoke -n 80 --no-pager" >&2
    exit 1
  fi
  sleep 3
done

step "nginx site for $DOMAIN"
sed "s#__DOMAIN__#${DOMAIN}#g" deploy/nginx.conf.example | sudo tee /etc/nginx/sites-available/webespoke >/dev/null
sudo ln -sf /etc/nginx/sites-available/webespoke /etc/nginx/sites-enabled/webespoke
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx

PUBLIC_IP="$(curl -fsS --max-time 3 https://checkip.amazonaws.com 2>/dev/null || true)"
cat <<EOF

Done. The app is running behind nginx on port 80.

Next:
  1. Point DNS at this server: A records for ${DOMAIN} and www.${DOMAIN} -> ${PUBLIC_IP:-<this server's Elastic IP>}
  2. When "dig +short ${DOMAIN}" shows that IP, turn on HTTPS:
       sudo certbot --nginx -d ${DOMAIN} -d www.${DOMAIN} --redirect
  3. Logs:  sudo journalctl -u webespoke -f
EOF
