---
name: srvx static serving + AWS prod start
description: How the production server serves static assets and SSR; the srvx --static path gotcha.
---

# Production serving (srvx) — static asset path gotcha

The app builds to a Node SSR server (`dist/server/server.js`) + static client
assets (`dist/client/`), served in prod by `srvx`. Start scripts in
`package.json`: `start` (binds 127.0.0.1, for Replit) and `start:aws` (binds
0.0.0.0, for containers/AWS).

**Rule:** the `--static` flag value is resolved **relative to the entry file's
directory** (`dist/server/`), NOT the cwd.

**Why:** srvx CLI does `resolve(dirname(entry), cliOpts.static || "public")`. So
`--static dist/client` looks for `dist/server/dist/client` (nonexistent),
silently falls back to no static dir, and ships HTML with no JS/CSS/favicon while
`/` still returns 200. The correct value is `--static=../client` (→ `dist/client`).

**How to apply:** keep `--static=../client` in both start scripts. If assets/
favicon 404 in prod but `/` is 200, this is the cause. Smoke test in CI/container:
`/`, one `/assets/*.js`, `/favicon.ico`, and an SSR route must all return 200.

# Related facts
- The dev-only SSR error `Cannot use 'in' operator ... TSS_SERVER_FUNCTION_FACTORY`
  comes from Vite's dev module runner and does NOT occur in the production build
  (verified: built server SSRs authenticated routes with 200).
- `VITE_*` Supabase vars are baked into the client bundle at BUILD time AND needed
  at runtime for SSR (server reads `process.env.SUPABASE_URL || VITE_SUPABASE_URL`).
- AWS artifacts: `Dockerfile` (multi-stage, VITE_* as build args), `.dockerignore`,
  `DEPLOY_AWS.md` (App Runner / ECS Fargate / EC2 guide).
