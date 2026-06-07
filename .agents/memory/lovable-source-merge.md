---
name: Merging from the user's Lovable source app
description: Where templates/analytics live in the old Lovable project and how to bring them over.
---

# Merging content from the Lovable source app

The user's old app (uploaded zip "WE_BE_SMART_DASH") shares a **near-identical
TanStack Start + Supabase structure** with this repo (same route paths, same
`getRetellAnalytics` server fn returning `{configured, agentIds, calls, error}`
that the analytics page aggregates client-side with recharts).

**Analytics merge pattern that worked:** copy the page + its `PageShell`
(`PageHeader/StatCard/PanelCard/EmptyState`, deps: cn + Button + lucide) and only
fix the import path (`@/lib/dashboard.functions` -> `@/lib/dashboard/analytics.functions`).
No data-layer changes needed because the server-fn contract is identical.

**Agent templates are NOT in the code.** The Lovable codebase has migrations but no
`agent_templates` table and no template seed inserts. Templates created on
www.webespokeaibuilder.com are **live database rows**, so a code upload can't carry
them. To import them, get a data export of that table (or read access to the old
Supabase project) and insert into this app's `agent_templates` table
(scope/owner_user_id/name/description/flow_data/settings/variables).

**What worked for the template migration:** ask the source app to export the rows as
raw JSON (paste/attach a file), then upsert into this app's Supabase with a small
node script using `@supabase/supabase-js` + `VITE_SUPABASE_URL` +
`SUPABASE_SERVICE_ROLE_KEY`, `onConflict: "id"`, forcing `scope:"global",
owner_user_id:null`. Keeping source UUIDs makes re-imports idempotent.

**Don't rely on a Lovable "public API" for cross-app data.** Its `/api/public/*`
routes are page routes, not server routes, so they return the SPA shell for
HTML/`*/*` requests and `{"error":"Only HTML requests are supported here"}` (500)
for `Accept: application/json`. That error == a page route receiving a non-HTML
request. A JSON export is far more reliable than trying to consume that endpoint.

**Note:** the exported flow_data/settings embed the user's real Cal.com/Retell
keys — it's their own data going into their own app, fine to import as-is.
