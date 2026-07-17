---
name: WEBEE secrets & prod deploy gotchas
description: Platform quirks for env vars/secrets and how prod↔Supabase failures present; how to diagnose a "can't log in to production" report.
---

# Secret vs shared env var collision
**Rule:** You cannot reliably keep a Secret and a *shared env var of the same name* at once. The shared env var occupies the key slot; a Secret added under that same name is shadowed and is lost on the next restart, and deleting the shared env var takes the value with it (the Secret does not "reappear").
**Why:** Observed repeatedly with `WEBESPOKE_ADMIN_EMAIL` — deleting the shared env var made the key resolve to nothing even right after the user added a same-named Secret; `viewEnvVars().secrets[key]` returns `true` whenever the key is resolvable in `process.env` (env var OR secret), so it gives a false positive when only the env var exists.
**How to apply:** To move a value env-var→Secret cleanly: delete the shared env var FIRST, then have the user add the Secret while no env var exists, then restart. To keep something working right now, leave it as the shared env var. Never store a *password* in a shared env var (`.replit` is git-tracked) — keep passwords as Secrets only. `setEnvVars` cannot set Secrets.

# WEBESPOKE_ADMIN_* are external-API creds, not app login
`WEBESPOKE_ADMIN_EMAIL` (shared env var) + `WEBESPOKE_ADMIN_PASSWORD` (Secret) authenticate to the WeeBespoke enterprise API for WBAH sync. They do NOT gate user login. If dev WBAH sync succeeds (fetches calls/leads, refreshes token), both values are present and correct.

# VITE_ vars bake at build → republish after secret/env change
Browser Supabase client (`src/integrations/supabase/client.ts`) reads `VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY` (server falls back to `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY`). `import.meta.env.VITE_*` is replaced at BUILD time, so changing a secret/env var does NOT reach the live deployment until it is **republished**. An autoscale deployment is an immutable build; check `uptimeMs` from the health endpoint to see how old it is.

# Diagnosing "can't log into production"
Login is browser→Supabase (`signInWithPassword`), but right after it navigates to `_authenticated` routes guarded by `requireSupabaseAuth` middleware which calls `resolveWorkspaceIdForUser` — a **server-side DB query**. So if the prod server can't reach Supabase, login looks broken for ALL accounts even though auth itself may succeed.
**Tool:** `GET https://<domain>/api/monitoring/health` (public, no auth) returns `checks.database` and `checks.environment`. `database.ok=false` with "Could not query the database for the schema cache. Retrying." + multi-second latency = prod server cannot reach Supabase.
**Key discriminator:** if dev can write to Supabase but prod's health DB check times out, Supabase is UP and the fault is the prod deployment's connection (stale instance, or Supabase Network Restrictions/IP allowlist blocking the autoscale egress, or compute/connection-pool limits) — NOT app config. First action: republish (fresh instance + ships latest code/env). If still failing, check Supabase project: network restrictions, paused/compute, connection limits.

Note (2026-07-16): prod secret values can arrive malformed as `NAME="value"` pasted whole into the value — Upstash init logged UrlError and caching silently disabled (every heavy page recomputed, 10-35s server fns). redis.server.ts now sanitizes (strips NAME= prefix + quotes) via cleanEnvValue(); reuse that pattern for any env-configured client.

Update 2: the TOKEN secret contained the ENTIRE pasted block (URL line + token line in one value) — a plain "strip NAME= prefix" cleaner is not enough. cleanEnvValue() now regex-extracts the value anchored to the requested name anywhere in the blob. Also: when Upstash rejects auth (WRONGPASS), every cache call is a failing HTTP round-trip; disableOnAuthError() kills the client for the process lifetime after the first auth error.
