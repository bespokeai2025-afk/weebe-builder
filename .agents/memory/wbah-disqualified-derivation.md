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
WBAH data is now **read on demand only** (when our People/Calls page is opened).
**Trade-off:** DB-backed WBAH tables (leads / wbah_calls / categorized) go stale
without these — accept it; protecting the source dashboard takes priority. On-demand
reads still mint one session per use, so they can still bump the dashboard once when
actively used — that's intentional and far better than 24/7 churn. Do NOT re-enable
the plugins to "fix staleness" without first solving the shared-single-session
problem (e.g. a dedicated service account for our app).
