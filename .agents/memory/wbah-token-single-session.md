---
name: WBAH single-active-session token expiry
description: WeeBespoke admin login is single-session + short-lived; long multi-page WBAH fetches must refresh-on-401, and concurrent syncs invalidate each other.
---

# WBAH / WeeBespoke token: single active session, short-lived

**Rule:** The WeeBespoke admin account (`/admin/login`) holds ONE active session.
Any re-login invalidates every other token currently in use for that account.
The access token is also short-lived — at high concurrency it dies after only
~60–120 pages. So any *long* multi-page WBAH fetch (e.g. calls = ~1100 pages for
~11k records) MUST keep a **mutable** token and **re-login on the first 401/403 of
a batch**, then continue + retry the failed pages with the fresh token. Otherwise
every page after expiry silently 401s and is dropped, and the table only creeps up
via upsert-union across many ticks (looked like "stuck at a few hundred calls").

Also: never trust the API's `pagination.totalPages` — derive page count from
`totalItems ÷ actualPageSize` (see webespokeapi-totalpages-bug.md).

**Why:** The People-page Calls tab was stuck at a few hundred of ~11,011 calls
(token expired mid-run → ~1000 pages 401'd). After adding mid-run re-login to the
calls sync, the CONCURRENT category-sync silently fetched 0 leads — the calls
sync's re-login invalidated the single session token the category sync was holding.
Schedules align because the 30-min category interval is a multiple of the 5-min
calls interval, and all plugins run in the same dev process, so the collision
recurs every cycle, not just once.

**How to apply:** Every WBAH/WeeBespoke multi-page fetch (calls, leads, category,
buyers) must INDEPENDENTLY be resilient to 401 (refresh-on-failure + bounded
retry), because they share one session and re-logins thrash each other. The
ping-pong of re-logins is acceptable as long as each fetch's retries are bounded
(short fetches recover within a few passes). A longer-term cleaner fix would be a
shared token coordinator or non-overlapping schedule, but per-fetch resilience is
the prod-safe pattern (prod runs each sync as a separate pg_cron HTTP invocation,
so in-process coordination would not work there anyway).

**Live page fetches also need this, not just background syncs.** The same single-
session thrash surfaces in the UI as a user-facing "Token expired — reconnect
required" error whenever a *live* WeeBespoke call (not a DB read) runs with a token
a concurrent sync just invalidated. Gotcha: the `aGet`/`aPost`/`aPatch` shorthand
helpers in `client.server.ts` call `authenticatedFetch` WITHOUT the optional
`reloginFn`, so on a 401 they only try a token *refresh* and then return the
"Token expired" string — they cannot full-relogin inline. The proactive relogin in
`requireWbahCbs` is throttled (once/30min via module-level `_wbahReloginAt`), so a
token that dies inside that window can't self-heal on its own. Fix pattern:
`requireWbahCbs` exposes a `reloginFn` (full login w/ stored admin creds, persists
to DB + closure + `_wbahReloginAt`); thread it through the specific client fn used
by the live path (it's an optional last arg, backward-compatible). Fetch page 1
sequentially WITH the reloginFn so it heals the shared closure token before any
parallel page batch launches (reduces, doesn't fully eliminate, concurrent
relogins). The WBAH People `/data` tabs (Disqualified/Tried/Rebooking) are the live
path: `listWbahCategorizedLeads → getWbahCrmLoadedContacts → wbahGetAllCallDataPaged`
(the get-all-calldata feed is the only source with not-yet-called contacts).

**Single-shot live reads/mutations need reloginFn too — not just multi-page.** The
`/data → Campaigns` tab (`WbahCallSchedulingSection → getWbahCampaigns → GET
/campaigns`) and every campaign mutation (create/update/pause/resume/voicemail/
delete) + `wbahGetAgents` are single-request live calls, but they 401 under the
same concurrent-sync token churn. They previously passed only `getTokens,
saveNewAccessToken` (no `reloginFn`), so a 401 returned `data:null` and the read
did `extractWbahArray(null) → []` and returned WITHOUT throwing → UI silently
showed "No campaigns yet" instead of mirroring the dashboard. Fix: thread
`cbs.reloginFn` through ALL campaign client fns (added optional `rl?: Relogin` to
`aPost/aPatch/aDel` too, not just `aGet`) and make `getWbahCampaigns` throw on
`!res.ok` so genuine failures surface instead of looking like an empty mirror.
