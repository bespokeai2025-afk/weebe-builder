---
name: GrowthMind Content Intelligence foundation
description: Versioned Business DNA + proposals, Meta social OAuth (encrypted tokens), autonomy modes, activity log — patterns and traps.
---

# GrowthMind Content Intelligence foundation

- **Schema**: migration `20260819000000_growthmind_content_intelligence.sql` (applied live via `scripts/apply-growthmind-content-intelligence-migration.mjs`, Mgmt API). 10 new `growthmind_*` tables, all RLS members SELECT-only + REVOKE writes (server-only via `supabaseAdmin`). `growthmind_social_connections.access_token_encrypted` is excluded from the authenticated role's **column grants** — tokens are unreachable via PostgREST even with SELECT policy.
- **DNA versioning**: every `upsertBusinessDna` bumps `dna_version` and snapshots the full row into `growthmind_dna_versions`. GrowthMind proposals (`growthmind_dna_proposals`) are applied only through `resolveDnaProposal` with a `PROPOSAL_ALLOWED_COLUMNS` whitelist — never widen it casually.
- **Auto-draft rule**: `generateInitialDna` returns suggestions only; UI prefills EMPTY fields; nothing saves without explicit user Save. Preserve this — spec forbids silent DNA mutation.
- **Meta OAuth pattern**: mirrors Google Ads OAuth (HMAC state derived from service-role key, 15-min TTL, origin allowlist, admin-only). **Why:** callback runs under `supabaseAdmin`, so the callback route MUST re-check `state.userId` is still an owner/admin member before any writes (architect flagged this; fixed). Token crypto in `meta-token.server.ts` (AES-256-GCM, key = sha256 of service-role key). IG publishing uses the linked Page's token.
- **Autonomy modes**: `workspace_settings.growthmind_mode` observe/recommend(default)/assistant/operator; operator requires owner/admin, permissions all default OFF, leaving operator revokes enablement (mirrors HiveMind).
- **Activity log**: `logGrowthMindActivity` (never-throws, admin client) — call it from every new CI mutation path; categories are a closed union in `growthmind.activity.server.ts`.
- **Hydration trap**: rendering `window.location.origin` or `toLocaleString()` in these SSR routes causes mismatches — gate with a `mounted` flag.
