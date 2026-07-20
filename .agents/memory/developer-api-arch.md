---
name: WEBEE Developer API layer
description: Customer-facing /api/v1/* REST API, auth middleware, rate limiting, and outbound webhook delivery engine.
---

## Architecture

- **Auth**: `src/lib/developer-api/v1-auth.middleware.ts` — reads `Authorization: Bearer lvb_xxx` header, SHA-256 hashes it, looks up in `workspace_api_tokens` table, checks `revoked_at` IS NULL. Attaches `workspace_id` to request context.
- **Rate limiting**: 60 requests/minute per token using `api_rate_limit_log` table (upsert per token_id + minute window). Returns 429 with `Retry-After: 60` when exceeded.
- **Webhook delivery**: `src/lib/developer-api/webhook-delivery.server.ts` — HMAC-SHA256 signs payload with `X-WEBEE-Signature: sha256=<hex>` header; queries `workspace_webhooks` filtered by event_type; retries on non-2xx.
- **Endpoints** (all under `src/routes/api/v1/`): `leads.ts`, `calls.ts`, `agents.ts`, `campaigns.ts`, `knowledge.ts`, `webhooks.ts`
- **Developer UI**: `/settings/developer` — API Keys tab (list/create/revoke), Documentation tab (curl examples for all 9 endpoints), Webhook Security tab (verification code example).
- **Nav entry**: "Developer API" with Code2 icon added to sidebar dropdown (visible to all users, not admin-only).

## DB

**Migration**: `supabase/migrations/DEVELOPER_API_MIGRATION.sql` — must be applied manually in Supabase SQL Editor.
- Adds `workspace_webhooks` table (id, workspace_id, name, event_type, target_url, secret, enabled)
- Adds `webhook_deliveries` table (id, webhook_id, event_type, payload, status, status_code, attempts)
- Adds `api_rate_limit_log` table (token_id, window_start, request_count)
- Adds `permissions_json` + `expires_at` columns to `workspace_api_tokens`

**Why:** `workspace_api_tokens` already existed with `lvb_` prefix token format — reused as-is. New columns allow scoped permissions and expiry in future.

## createToken server fn

`src/lib/workspace/api-tokens.functions.ts` — `createToken` only takes `{ name: string }` (no permissions yet — DEVELOPER_API_MIGRATION.sql adds permissions_json column, apply migration first). Returns `{ id, name, prefix, created_at, plaintext }` — `plaintext` is the full `lvb_xxx` token shown once.

**How to apply:** When calling `createFn({ data: { name } })`, extract `result.plaintext` for display.

- 2 latent launch bugs fixed 2026-07-20: hashToken used require() in ESM (every authed v1 request crashed) and most v1 routes lacked the VITE_SUPABASE_URL fallback. Lesson: any new v1 route must copy the env-fallback + top-level-import pattern from leads.ts; the API had never been exercised end-to-end before.
