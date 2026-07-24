---
name: Mind API dual-auth pattern
description: How /api/v1/minds/* authenticates (user JWT vs HMAC) and the traps hit while building/verifying it
---

# Mind API dual-auth (/api/v1/minds/*)

Rule: mobile/external Mind endpoints accept EITHER a Supabase user JWT (RLS-bound client, optional `X-Workspace-Id` checked against workspace membership, fail-closed) OR the existing HMAC API key (server-to-server; `supabaseAdmin` with explicit `workspace_id` filters on every query). User-consequential endpoints (tools/execute, conversations, approvals) must set `requireUser: true` — HMAC alone is not enough. tools/execute never forwards `explicitApproval`, so sensitive tools always come back `approval_required`.

**Why:** API-key path bypasses RLS, so any unfiltered admin query is a cross-tenant leak; and letting an API key approve/execute would bypass the human approval workflow.

**How to apply:** new /api/v1 Mind endpoints go through `mind-auth.middleware.ts`; delegate to the same shared cores the web serverFns use (never re-implement query logic in the route file).

Traps learned:
- `supabase.auth.getClaims()` THROWS on malformed JWT segments (doesn't return `{error}`) — wrap in try/catch or bad tokens become 500s.
- WEBESPOKE_ADMIN_EMAIL/PASSWORD secrets are NOT Supabase login creds (they're for the external WeeBespoke app). For live API verification, create a throwaway auth user + workspace via service-role admin API (workspaces insert needs `slug` and `owner_id`), then clean up; `auth.admin.deleteUser` can fail with "Database error deleting user" when FK'd rows remain — harmless for a test user but note it.
