# Deploying WEBEE to AWS

WEBEE is a server-rendered TanStack Start + Vite application. It builds to a
Node SSR server (`dist/server/server.js`) and static client assets
(`dist/client/`), served by `srvx` as a long-running Node process.

---

## How deployments work

### The golden rule

> **`npm run build` never runs on the production server.**

The full build happens on GitHub Actions (free CI runners with no impact on
live traffic). The built artifact is uploaded to EC2 as a tarball. The server
only runs `npm ci --omit=dev` (install prod deps — fast, no compilation).

### Atomic release flow

```
GitHub Actions runner                      EC2 host
─────────────────────────                  ──────────────────────────────────
1. npm ci                                  (nothing running yet)
2. npm run build (real VITE_* values)
3. tar -czf release.tar.gz dist/ …
4. scp release.tar.gz → /tmp/             5. mkdir releases/{timestamp}/
                                           6. tar -xzf release.tar.gz → releases/{timestamp}/
                                           7. npm ci --omit=dev
                                           8. ln -sfn releases/{timestamp} current
                                           9. systemctl restart webee
                                          10. GET /api/health → 200? → done ✓
                                                               → fail → rollback ✗
```

The `current` symlink is updated atomically in step 8. If the health check
fails, the deploy script switches the symlink back to the previous release and
restarts the service — customers see only a brief restart, never a broken build.

---

## Quick start (first deploy)

### 1. Bootstrap the EC2 host (one-time only)

```bash
# SSH into your EC2 instance
ssh ubuntu@your-ec2-host

# Clone the repo so you have the bootstrap script
git clone <your-repo-url> /tmp/webee-setup && cd /tmp/webee-setup

# Run the bootstrap (creates /var/www/webee/ layout + systemd service)
bash deploy/ec2-bootstrap.sh ubuntu   # pass your OS user (ubuntu / ec2-user)

# IMPORTANT: edit the permanent .env with real secrets
sudo nano /var/www/webee/.env
```

### 2. Add GitHub Actions secrets

Go to **GitHub → your repo → Settings → Secrets and variables → Actions**.

#### Secrets (sensitive — use "Secrets" tab):
| Secret | Value |
|---|---|
| `EC2_HOST` | Your EC2 public IP or hostname |
| `EC2_SSH_KEY` | Contents of your deploy private key (`~/.ssh/id_rsa`) |
| `EC2_USER` | OS user on EC2 (e.g. `ubuntu`, `ec2-user`) |
| `EC2_SSH_PORT` | SSH port (default: `22`) |
| `EC2_RELEASES_ROOT` | `/var/www/webee/releases` |

#### Variables (public — use "Variables" tab):
These are the public Supabase values baked into the client bundle at build time.
| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://YOUR-PROJECT.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Your Supabase anon/publishable key |
| `VITE_SUPABASE_ANON_KEY` | Same as above |
| `VITE_PAYMENTS_CLIENT_TOKEN` | Stripe publishable key (optional) |

### 3. Deploy

```bash
git push origin main
# GitHub Actions builds and deploys automatically.
# Watch progress: GitHub → Actions → Deploy to EC2
```

### 4. Rollback (if needed)

```bash
# SSH into EC2:
bash scripts/rollback.sh            # roll back to previous release
bash scripts/rollback.sh 20240617   # roll back to a specific timestamp
```

Or from GitHub: **Actions → Deploy to EC2 → Run workflow** on a previous commit SHA.

---

## Directory layout on EC2

```
/var/www/webee/
├── .env                     ← runtime secrets (permanent — never overwritten)
├── current -> releases/20240617142300/   ← symlink; updated on each deploy
└── releases/
    ├── 20240617142300/      ← active release
    │   ├── dist/
    │   │   ├── server/server.js
    │   │   └── client/
    │   ├── node_modules/    ← prod deps only (no devDeps)
    │   ├── package.json
    │   └── .deploy_sha      ← commit SHA (read by /api/health)
    ├── 20240616091500/      ← previous release (kept for rollback)
    └── …                   ← up to 5 releases kept; older ones pruned
```

---

## Environment variables

### Build-time (baked into the public client bundle)

Set as **GitHub Actions Variables** (not Secrets — these are public values).

| Variable | Required | Notes |
|---|---|---|
| `VITE_SUPABASE_URL` | ✅ | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | ✅ | Supabase anon key |
| `VITE_SUPABASE_ANON_KEY` | ✅ | Same as above (both names used) |
| `VITE_PAYMENTS_CLIENT_TOKEN` | optional | Stripe publishable key |

### Runtime (server-only secrets — live in `/var/www/webee/.env`)

| Variable | Required | Purpose |
|---|---|---|
| `NODE_ENV` | ✅ | Set to `production` |
| `PORT` | ✅ | Port to listen on (default: `3000` behind Nginx) |
| `VITE_SUPABASE_URL` | ✅ | Also needed at runtime for SSR |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | ✅ | Also needed at runtime for SSR |
| `VITE_SUPABASE_ANON_KEY` | ✅ | Also needed at runtime for SSR |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Admin DB access for server functions |
| `RETELL_API_KEY` | ✅ | Platform Retell workspace key |
| `PUBLIC_SITE_URL` | recommended | Used in emails, booking links, redirects |
| `RESEND_API_KEY` | optional | Transactional email notifications |
| `RETELL_WEBHOOK_SECRET` | optional | Verify inbound Retell webhooks |
| `COMMIT_SHA` | auto | Injected by `deploy-remote.sh` via `.env.deploy` |

---

## Health check endpoint

```
GET /api/health
```

Returns `200 OK` with JSON when healthy, `503` when degraded:

```json
{
  "status": "ok",
  "version": "1.0.0",
  "commit_sha": "abc1234",
  "environment": "production",
  "uptime_s": 3600,
  "response_ms": 12,
  "timestamp": "2024-06-17T14:23:00.000Z",
  "checks": {
    "database": { "ok": true, "latencyMs": 8 },
    "environment": { "ok": true }
  }
}
```

Use this URL for:
- AWS ALB / App Runner health checks
- Uptime monitoring (UptimeRobot, BetterStack, etc.)
- Post-deploy verification in `deploy-remote.sh`

---

## Build artefacts

| Output | What it is |
|---|---|
| `dist/server/server.js` | SSR entry point |
| `dist/server/assets/` | Server-side route chunks |
| `dist/client/` | Static JS/CSS/favicon served to browsers |

**Static asset path note:** both start scripts pass `--static=../client`.
`srvx` resolves this path **relative to the entry file** (`dist/server/`),
so `../client` correctly resolves to `dist/client/`. Do not change this
to `dist/client` or `--static dist/client` — it silently serves no assets.

---

## Container option (ECR + ECS / App Runner)

The `Dockerfile` is a two-stage build and is production-ready for container
deployments. See the original options below.

### Option A — App Runner (least ops)

```bash
AWS_REGION=us-east-1
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR="$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/webee"

aws ecr create-repository --repository-name webee --region $AWS_REGION
aws ecr get-login-password --region $AWS_REGION \
  | docker login --username AWS --password-stdin "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"

docker build \
  --build-arg VITE_SUPABASE_URL="https://YOUR-PROJECT.supabase.co" \
  --build-arg VITE_SUPABASE_PUBLISHABLE_KEY="YOUR_ANON_KEY" \
  -t "$ECR:latest" .
docker push "$ECR:latest"
```

Then: Console → App Runner → Create service → ECR source → port `8080` → add
runtime env vars → health check path `/api/health`.

### Option B — ECS Fargate

Same ECR push as above. Create a Fargate task definition (0.5 vCPU / 1 GB),
service behind an ALB, health check path `/api/health`, Route 53 → ALB.

---

## Post-deploy checklist

- [ ] `GET /api/health` returns `{ "status": "ok" }`
- [ ] App loads at your HTTPS URL — sign-in page renders
- [ ] Log in → Agents page loads (confirms SSR + server functions + Supabase)
- [ ] Add your AWS domain to Supabase Auth → URL configuration (for OAuth/magic links)
- [ ] Set `PUBLIC_SITE_URL` to the live URL (emails + booking links)
- [ ] Point Retell webhooks at `https://YOUR-DOMAIN/...` + set `RETELL_WEBHOOK_SECRET`

---

## Gotchas

- **Not a static site.** Don't deploy `dist/client` to S3 alone — the SSR
  server must be running.
- **Two lockfiles** (`package-lock.json` + `bun.lock`) exist; the Dockerfile
  and deploy script use npm. If you standardise on Bun, update accordingly.
- **Supabase stays put.** AWS hosts the app; Supabase remains your
  database/auth provider. Only the EC2/container domain needs whitelisting.
- **Secrets management:** prefer AWS Secrets Manager or SSM Parameter Store
  over plaintext values in task definitions or `.env` files.
