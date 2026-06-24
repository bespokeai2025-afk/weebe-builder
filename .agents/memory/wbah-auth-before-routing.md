---
name: WBAH auth must precede DataSourceRouter engine routing
description: In WBAH server fns, run requireWbahCbs (membership/admin gate) BEFORE getXData() engine routing, or engine-routed rows leak to non-members (IDOR).
---

# requireWbahCbs must run before the DataSourceRouter engine path

**Rule:** Any WBAH server fn that tries `getCampaignData/getPeopleData/getCallData`
(the api-engine `DataSourceRouter`) and only falls back to the direct WeeBespoke
API must call `requireWbahCbs(context.userId)` (the membership / platform-admin
gate) FIRST — before the router attempt — and reuse that `cbs` for the fallback.

**Why:** The engine branch returns workspace data when `routed.source === "engine"`
without touching `requireWbahCbs`. If the membership check only lives in the direct
fallback, an authenticated non-member who can invoke the server fn receives WBAH
data via the engine path = broken access control (IDOR). Currently latent only
because the `workspace_api_profiles` table doesn't exist, so `resolveProfile`
errors and the router always returns `source:"fallback"` — but the moment a profile
table/mapping is added, the gap becomes live.

**How to apply:** Pattern is fixed in `getWbahCampaigns`
(`wbah-workspace.server.ts`). The SAME gap still exists in `listWbahLeads` and
`listWbahCalls` (they call `getPeopleData`/`getCallData` before `requireWbahCbs`) —
fix them the same way if/when engine routing is enabled. Membership gating must be
path-independent; never let the data source determine whether auth runs.
