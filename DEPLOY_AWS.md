# Deploying to AWS

This app is a server-rendered (SSR) TanStack Start + Vite application. It builds
to a Node SSR server (`dist/server/server.js`) plus a folder of static client
assets (`dist/client/`), and is served by `srvx` as a normal long-running Node
process. That makes it a containerized Node service on AWS — **not** a static
S3/CloudFront site.

A `Dockerfile` and `.dockerignore` are included and ready to use.

---

## TL;DR

```bash
# Build the image (VITE_* values are baked into the client bundle here)
docker build \
  --build-arg VITE_SUPABASE_URL="https://YOUR-PROJECT.supabase.co" \
  --build-arg VITE_SUPABASE_PUBLISHABLE_KEY="YOUR_SUPABASE_ANON_KEY" \
  -t webespoke-ai:latest .

# Run it locally to verify (Supabase URL/key are also needed at RUNTIME for SSR)
docker run --rm -p 8080:8080 \
  -e VITE_SUPABASE_URL="https://YOUR-PROJECT.supabase.co" \
  -e VITE_SUPABASE_PUBLISHABLE_KEY="YOUR_SUPABASE_ANON_KEY" \
  -e SUPABASE_SERVICE_ROLE_KEY="..." \
  -e RETELL_API_KEY="..." \
  webespoke-ai:latest

# Open http://localhost:8080
```

Then push the image to **Amazon ECR** and run it on **App Runner** (simplest) or
**ECS Fargate** (more control).

---

## How the build works

| Output | What it is |
| --- | --- |
| `dist/server/server.js` | The SSR entry (wrapped with branded error handling). |
| `dist/server/assets/*`  | Server-side route/component chunks. |
| `dist/client/*`         | Static JS/CSS/favicon served to the browser. |

- Build: `npm run build`
- Start (AWS): `npm run start:aws` — binds `0.0.0.0` and reads the `PORT` env var (defaults to 8080 in the container).
- The default `npm run start` binds `127.0.0.1` (loopback only) and is **not** suitable for AWS. Always use `start:aws` in the container — the `Dockerfile` already does.
- Node **22.12+** is required.

> **Static asset serving:** both start scripts pass `--static=../client`. srvx
> resolves the static dir **relative to the entry file** (`dist/server/`), so
> `../client` correctly points at `dist/client/`. Using `--static dist/client`
> silently serves no assets (it looks for `dist/server/dist/client`), which ships
> HTML with no JS/CSS. Don't "simplify" this back. Verified: `/`, `/assets/*`,
> `/favicon.ico`, and SSR routes all return 200 with the current scripts.

> The dev-only SSR warning you may see in the Replit console
> (`Cannot use 'in' operator ... TSS_SERVER_FUNCTION_FACTORY`) comes from Vite's
> dev module runner and **does not occur in the production build** — verified:
> the built server SSRs authenticated routes with HTTP 200.

---

## Environment variables

### Build time (baked into the public client bundle — pass as `--build-arg`)

These are public values (the same ones the browser already sees). They must be
present when `vite build` runs, or the client will fail with "Missing Supabase
environment variable(s)".

| Variable | Required | Notes |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | ✅ | Your Supabase project URL. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | ✅ | Supabase anon/publishable key. |
| `VITE_PAYMENTS_CLIENT_TOKEN` | optional | Only if using the Stripe payments UI. |

### Runtime (server-only secrets — pass as container env vars, never build args)

| Variable | Required | Purpose |
| --- | --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Admin Supabase access for server functions. |
| `RETELL_API_KEY` | ✅ | Platform Retell workspace (agent builder / Go Live). |
| `PORT` | ✅ | Port to listen on. The container sets `PORT=8080` via Docker `ENV`; override it to match your platform's expected port if needed. Don't assume AWS auto-injects it. |
| `VITE_SUPABASE_URL` | ✅ | Also needed at runtime for SSR (server reads it as a fallback). |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | ✅ | Same — needed for SSR. |
| `RESEND_API_KEY` | optional | Email notifications (e.g. workspace approval, webform leads). |
| `RESEND_FROM` | recommended if `RESEND_API_KEY` is set | Must be an address on a domain verified in Resend (Settings > Domains), e.g. `"Name <notify@yourdomain.com>"`. Without it, sends fall back to `onboarding@resend.dev`, which Resend silently refuses to deliver to anyone except the account owner — notification emails (workspace approvals, webform leads) will appear to send successfully in logs but never arrive. |
| `RETELL_WEBHOOK_SECRET` | optional | Verify inbound Retell webhooks. |
| `RETELL_SIGNATURE_VERIFICATION_ENABLED` | optional | `"true"` to enforce webhook signature checks. |
| `PUBLIC_SITE_URL` / `PUBLIC_BASE_URL` | recommended | Your public HTTPS URL (used in emails, booking links, redirects). |
| `SITE_NAME` | optional | Branding in outbound emails. |
| `SENDER_DOMAIN` | optional | Verified email sender subdomain. |
| `SEED_ADMIN_EMAIL` | optional | Where admin alerts are sent. |
| `RETAIL_WORKSPACE_ID` / `RETELL_RETAIL_API_KEY` | optional | Only for shared "retail" deploy mode. |

> Pass `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` **both** as build
> args (for the client bundle) **and** as runtime env vars (for SSR).

---

## Option A — App Runner (recommended, least ops)

App Runner runs your container, gives you HTTPS + a public URL, and autoscales.

1. **Create an ECR repo and push the image**

   ```bash
   AWS_REGION=us-east-1
   ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
   ECR="$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/webespoke-ai"

   aws ecr create-repository --repository-name webespoke-ai --region $AWS_REGION
   aws ecr get-login-password --region $AWS_REGION \
     | docker login --username AWS --password-stdin "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"

   docker build \
     --build-arg VITE_SUPABASE_URL="https://YOUR-PROJECT.supabase.co" \
     --build-arg VITE_SUPABASE_PUBLISHABLE_KEY="YOUR_ANON_KEY" \
     -t "$ECR:latest" .
   docker push "$ECR:latest"
   ```

2. **Create the App Runner service** (Console → App Runner → Create service):
   - Source: the ECR image you pushed.
   - Port: **8080**.
   - Add the **runtime** environment variables from the table above. Store
     secrets in **AWS Secrets Manager** and reference them rather than pasting
     plaintext.
   - Health check path: `/` (HTTP 200).
   - Deploy. App Runner gives you an HTTPS URL — set that as `PUBLIC_SITE_URL`
     and redeploy if email/booking links need it.

3. **Updates**: rebuild, `docker push` a new tag, and trigger a new deployment
   (or enable automatic deployments on `:latest`).

---

## Option B — ECS Fargate (more control)

1. Push the image to ECR (same as Option A step 1).
2. Create an **ECS cluster** (Fargate).
3. Create a **Task Definition**:
   - Container image: your ECR URI.
   - Container port: **8080**.
   - Environment variables / secrets: the runtime vars above (use Secrets
     Manager / SSM Parameter Store for secrets).
   - CPU/memory: 0.5 vCPU / 1 GB is a fine starting point.
4. Create a **Service** behind an **Application Load Balancer**:
   - Target group protocol HTTP, port 8080, health check path `/`.
   - Attach an **ACM** certificate to the ALB listener for HTTPS (443).
5. Point your domain (Route 53) at the ALB.

---

## Option C — Single EC2 instance (what production uses)

One Ubuntu instance running the app under systemd behind nginx, deployed by
`.github/workflows/deploy.yml` on every push to `main`.

**First-time setup** (once per server):

1. Launch Ubuntu 24.04 with at least 8 GB RAM (the build uses a 5.6 GB heap;
   the bootstrap adds swap on smaller instances), 30 GB disk. Attach an
   **Elastic IP** so the address survives stop/start. Security group: 22, 80, 443.
2. Point the domain's A records (apex and `www`) at the Elastic IP.
3. On the server, give it read access to the repo with a deploy key and clone:
   ```bash
   ssh-keygen -t ed25519 -N "" -f ~/.ssh/github_deploy
   cat ~/.ssh/github_deploy.pub   # add on GitHub: repo → Settings → Deploy keys (read-only)
   printf 'Host github.com\n  IdentityFile ~/.ssh/github_deploy\n' >> ~/.ssh/config
   sudo mkdir -p /var/www/html && sudo chown "$USER" /var/www/html
   git clone git@github.com:<owner>/<repo>.git /var/www/html/webespoke
   ```
4. Copy `.env` to `/var/www/html/webespoke/.env` (set the public URLs to the domain).
5. `bash deploy/bootstrap-ec2.sh <domain>` (add `--worker` for the automation worker).
6. `sudo certbot --nginx -d <domain> -d www.<domain> --redirect` once DNS resolves.

**Automatic deploys:** add the repository secrets `EC2_HOST` (Elastic IP),
`EC2_USER` (`ubuntu`), `EC2_SSH_KEY` (a private key whose public half is in the
server's `~/.ssh/authorized_keys`) and `EC2_DEPLOY_PATH`
(`/var/www/html/webespoke`). Each push to `main` then runs
`scripts/deploy-remote.sh` on the server.

The service must start through `scripts/prod-entry.mjs` (as
`deploy/webespoke.service` does): that entry mounts the voice WebSockets.
Starting `dist/server/server.js` directly serves pages but no voice calls.

---

## Post-deploy checklist

- [ ] App loads at your HTTPS URL; the **sign-in page** renders.
- [ ] Log in → **My Agents** loads (confirms SSR + server functions + Supabase).
- [ ] Create/save an agent works (confirms `SUPABASE_SERVICE_ROLE_KEY`).
- [ ] In Supabase Auth → URL config, add your AWS domain to the **allowed
      redirect URLs** (Google OAuth / magic links will fail otherwise).
- [ ] Set `PUBLIC_SITE_URL` to the live URL so emails/booking links are correct.
- [ ] If using Retell webhooks, point them at `https://YOUR-DOMAIN/...` and set
      `RETELL_WEBHOOK_SECRET`.

---

## Notes & gotchas

- **This is not a static site.** Don't deploy `dist/client` to S3 alone — the
  app needs the running SSR server.
- **Supabase stays where it is.** AWS hosts the app; Supabase remains your
  database/auth. Just make sure the AWS domain is whitelisted in Supabase Auth.
- **Secrets management:** prefer AWS Secrets Manager / SSM over plaintext env
  vars in task definitions.
- **Two lockfiles** (`package-lock.json` + `bun.lock`) exist; the Dockerfile
  uses npm. If you standardize on Bun later, update the Dockerfile accordingly.
