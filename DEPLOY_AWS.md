# Deploying WEBEE to AWS

WEBEE is a server-rendered TanStack Start + Vite app. It builds to a Node SSR
server (`dist/server/server.js`) and static client assets (`dist/client/`),
served by `srvx` as a long-running Node process packaged inside a Docker
container.

---

## Recommended: Docker + AWS App Runner

App Runner is the simplest production option — no servers to manage, no SSH
keys, automatic HTTPS, automatic scaling.

**How it works:**

```
git push main
   │
   ▼
GitHub Actions
   1. Typecheck + verify build
   2. docker build (with real VITE_* values baked in)
   3. docker push → Amazon ECR
   │
   ▼
AWS App Runner
   4. Pulls new image from ECR
   5. Blue/green swap with built-in health check (/api/health)
   6. Auto-rollback if health check fails
   │
   ▼
Live at https://your-service.region.awsapprunner.com
```

---

## One-time setup (≈ 10 minutes)

### Step 1 — Install the AWS CLI (if you haven't)

```bash
# macOS
brew install awscli

# Windows — download from:
# https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2-windows.html
```

### Step 2 — Configure it with your AWS credentials

```bash
aws configure
# Enter: AWS Access Key ID, Secret, region (e.g. us-east-1), output format (json)
```

If you don't have AWS credentials yet:
1. Go to **console.aws.amazon.com**
2. IAM → Users → Create user → Attach `AdministratorAccess` (for setup only)
3. Security credentials → Create access key → copy both values

### Step 3 — Run the setup script

```bash
bash deploy/apprunner-setup.sh
```

This creates everything automatically:
- ECR repository for Docker images
- IAM role for App Runner to pull from ECR
- IAM user + policy for GitHub Actions (scoped: push images + trigger deploys)
- App Runner service pointed at ECR, with health check on `/api/health`

At the end it prints a table like this:

```
╔══════════════════════════════════════════════════════════════════╗
║  SECRETS TAB                                                     ║
║  AWS_ACCESS_KEY_ID        AKIA...                                ║
║  AWS_SECRET_ACCESS_KEY    abc123...                              ║
║  APP_RUNNER_SERVICE_ARN   arn:aws:apprunner:...                  ║
║  VARIABLES TAB                                                   ║
║  AWS_REGION               us-east-1                              ║
║  ECR_REPOSITORY           webee                                  ║
║  VITE_SUPABASE_URL        https://xxx.supabase.co                ║
║  VITE_SUPABASE_ANON_KEY   eyJ...                                 ║
╚══════════════════════════════════════════════════════════════════╝
```

### Step 4 — Add those values to GitHub

Go to: **github.com → your repo → Settings → Secrets and variables → Actions**

- Copy the **SECRETS** rows into the **Secrets** tab
- Copy the **VARIABLES** rows into the **Variables** tab

### Step 5 — Push to deploy

```bash
git push origin main
```

GitHub Actions builds and deploys automatically. Watch progress at:
**github.com → your repo → Actions → Deploy to App Runner**

---

## After the first deploy

Your app is live at the App Runner URL shown in:
**AWS Console → App Runner → webee → Default domain**

```
https://xxxxxxxxxx.us-east-1.awsapprunner.com
```

To use a custom domain: App Runner → your service → Custom domains → Add domain.

**Post-deploy checklist:**

- [ ] `GET https://your-url/api/health` returns `{ "status": "ok" }`
- [ ] Sign-in page loads
- [ ] Log in → Agents page loads (confirms SSR + Supabase)
- [ ] Add your App Runner URL to Supabase Auth → URL configuration
- [ ] Set `PUBLIC_SITE_URL` in App Runner → your service → Configuration → Environment variables

---

## Environment variables

### Build-time (baked into the public client bundle)

Set as **GitHub Actions Variables** (non-sensitive — the browser already sees these).

| Variable | Required | Notes |
|---|---|---|
| `VITE_SUPABASE_URL` | ✅ | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | ✅ | Supabase anon key |
| `VITE_SUPABASE_ANON_KEY` | ✅ | Same value as above |
| `VITE_PAYMENTS_CLIENT_TOKEN` | optional | Stripe publishable key |

### Runtime (server-only secrets)

Set in the **App Runner service configuration** (AWS Console → App Runner → your service → Configuration → Environment variables). The setup script sets these for you during first-time setup.

| Variable | Required | Purpose |
|---|---|---|
| `NODE_ENV` | ✅ | `production` |
| `PORT` | ✅ | `8080` (App Runner exposes this) |
| `VITE_SUPABASE_URL` | ✅ | Also needed at runtime for SSR |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | ✅ | Also needed at runtime for SSR |
| `VITE_SUPABASE_ANON_KEY` | ✅ | Also needed at runtime for SSR |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Admin DB access for server functions |
| `RETELL_API_KEY` | ✅ | Platform Retell workspace key |
| `PUBLIC_SITE_URL` | recommended | Your live URL (emails, booking links) |
| `RESEND_API_KEY` | optional | Transactional emails |
| `RETELL_WEBHOOK_SECRET` | optional | Verify inbound Retell webhooks |

---

## Health check endpoint

```
GET /api/health
```

Returns `200 OK` when healthy, `503` when degraded:

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

App Runner uses this for its built-in health check (configured in the setup
script). If the new container fails this check, App Runner automatically keeps
the previous version running.

---

## Build notes

| Output | What it is |
|---|---|
| `dist/server/server.js` | SSR entry point |
| `dist/client/` | Static JS/CSS/favicon served to browsers |

**Static asset path:** both `start` scripts pass `--static=../client`.
`srvx` resolves this relative to the entry file (`dist/server/`), so
`../client` correctly points at `dist/client/`. Do not change to
`--static dist/client` — it silently serves no assets.

---

## Alternative: EC2 (manual server)

Scripts for EC2 atomic deploys are still available in `scripts/` if you
prefer a self-managed server. See the git history of `DEPLOY_AWS.md` for
the EC2 setup guide, or use:

```bash
bash deploy/ec2-bootstrap.sh      # one-time host setup
bash scripts/rollback.sh          # roll back to previous release
```
