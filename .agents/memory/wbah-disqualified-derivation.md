---
name: WBAH People = single Disqualified list (mirrors WeeBespoke source dashboard)
description: All non-booked WBAH People contacts from the CRM get-all-calldata feed show as ONE Disqualified list — no Tried-To-Contact / Rebooking split. The WeeBespoke source dashboard lists them as one People set, and the 3 background sync plugins were disabled to stop kicking the human admin out of that dashboard.
---

# WBAH People = one Disqualified list, mirroring the WeeBespoke source

The WBAH `/data` People section shows **all non-booked CRM-loaded contacts as a
single "Disqualified" list**. There is NO 3-way split anymore.

**Why:** The WeeBespoke source dashboard (where the API originates) lists these as
one People set of ~365 leads with `Opportunity: 0` across the board — i.e. none
converted. The user wants our app to mirror that one list, not invent
Disqualified / Tried-To-Contact / Rebooking buckets that buried Disqualified at ~32.
`classifyWbahCrmContact()` now unconditionally returns `"disqualified"`; the
Tried-To-Contact and Rebooking sub-tab buttons + KPI cards were removed from
`data.tsx`, and `handleFetchWbahCatCounts()` probes only the `disqualified` count.

**How to apply:** If the user wants a different breakdown later, re-introduce logic
in `classifyWbahCrmContact` (the dedup / booked-exclusion / `__cat` tagging pipeline
in `getWbahCrmLoadedContacts` is unchanged and still feeds it). `WBAH_CATEGORY_TABS`
still lists all three as the `WbahCategoryTab` *type* source; the ttc/rb state vars
and render ternaries remain as unreachable dead paths (changing the array ripples
into typed setters — leave it unless you intend that refactor).

## Data source (unchanged, still durable)
- Source is the live CRM **`get-all-calldata`** feed (NOT `wbah_calls`, NOT the lead
  APIs, NOT `wbah_categorized_leads`). It is the ONLY feed carrying not-yet-called
  (`callId === null` ⟺ `callStatus === "need_to_call"`) contacts AND a per-record
  CRM load date (`createdAt`).
- `getWbahCrmLoadedContacts`: fetch all pages (batches of 8), retry a failed page
  once then **throw** (never partial), dedup by phone keeping latest `createdAt`,
  exclude already-booked (`booking_status === "success"`), cache 60s per workspace.
- Pagination here IS reliable (unlike `get-user-history` — see
  webespokeapi-totalpages-bug), but still guarded with
  `totalPages = max(api.totalPages, ceil(totalItems / pageSize))`.

## We were hindering the WeeBespoke dashboard — background syncs DISABLED
Three Vite dev plugins (`wbahLeadsSync` ~5min, `wbahCallsSync` ~5min,
`wbahCategorySync` ~30min) each logged into WeeBespoke with the **shared admin
account** on a schedule. WeeBespoke is single-active-session (see
wbah-token-single-session), so the constant background churn kept invalidating the
human admin's dashboard session 24/7, breaking ITS own Dynamics → People pull.

**Rule:** All three are commented out in `vite.config.ts` (imports + plugins array).
WBAH data is now **read on demand only** (when our People/Calls/Leads page is opened).
On-demand reads reuse the STORED token and only mint a new session on a 401, so they
bump the dashboard at most once every ~30 min (token lifetime) — far better than 24/7
churn. Do NOT re-enable the timed plugins to "fix staleness" without first solving the
shared-single-session problem (e.g. a dedicated service account for our app).

## Calls + Leads now pull LIVE on open (option 3 — replaces the stale-DB trade-off)
The user chose to make the **Calls page AND Leads page live on open**, like People.
- `refreshWbahCallsIncremental()` (wbah-leads-sync-tick.ts): walks `get-user-history`
  newest-first with the STORED token (401-only relogin — happy path never forces a
  login), upserts each page via `buildCallRow`/`upsertCallRows` (idempotent), and
  STOPS when a page holds only already-known ids (`.in("id", pageIds)` check, min 3
  pages, cap 40). Backlog >40 pages converges over subsequent opens.
- Guarded by a **module-level in-flight Promise + 55s last-run timestamp** — this is
  the real dedup because Redis is unconfigured (`cacheWrap` no-ops in dev; see the
  `require is not defined` in redis.server.ts) and `cacheWrap` has no in-flight dedup.
- `listWbahCallsLive` (NEW cache key `webee:wbah-calls-live`, 60s) = refresh INSIDE
  the factory → then `readWbahCallsRows()` (extracted plain read, OUTSIDE any cache so
  the refresh isn't masked). Calls page + `PrefetchOnLogin` use it; page staleTime 60s,
  no refetchInterval.
- `listWbahPositiveNeutralLeads` calls the same guarded refresh inside its 60s factory
  before deriving. Leads page WBAH branch: staleTime 60s, refetchInterval false.
- Both refreshes are `try/catch` (serve DB snapshot on failure) and gated on
  `workspaceId === WBAH_WORKSPACE_ID`.
- **Still stale (out of scope):** `data.tsx` People→Calls sub-tab uses
  `listWbahCallsFromDb` (2-min DB snapshot); it benefits indirectly from page-open
  upserts. Repoint to `listWbahCallsLive` if the user reports staleness there.
