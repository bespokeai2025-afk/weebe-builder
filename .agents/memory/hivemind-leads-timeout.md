---
name: HiveMind lead reads time out on bloated leads table
description: Why HiveMind reported "0 leads" for WBAH and why its lead numbers must come from wbah_calls, not the leads table
---

HiveMind's lead aggregates used to read the shared `leads` table. For WBAH that table is
dup-exploded to ~400k rows (essentially the entire table — every other workspace combined
has ~1 lead). Under the `authenticated` role (statement_timeout = 8s; anon = 3s;
service_role = none) even a *plain* `{ count: "exact" }` with no order and no filter
breaches 8s on that table (RLS overhead, cold cache, constant WBAH sync hammering the DB).

**The silent failure:** on timeout the PostgREST call sets `le.error`, and `const leads =
le.data ?? []` (and `le.count ?? 0`) collapses to empty/0 → every derived metric becomes 0
→ HiveMind answers "0 leads". The error is only console.error'd, so it looks like real data.

**Resolution (the rule that actually holds):** for WBAH, do NOT touch the `leads` table at
all from HiveMind. Detect WBAH up front (slug `webuyanyhouse`, with a hardcoded
workspace-id fallback so an RLS/transient slug-lookup miss can't re-enable the doomed path)
and derive lead numbers from the small, clean `wbah_calls` table (~12k rows) — exactly like
the dashboard's `listWbahPositiveNeutralLeads`: page wbah_calls latest-first, dedup per
phone (first-seen = that contact's most recent call), keep sentiment positive/neutral. That
yields ~1,510 leads (~37 positive), matching the dashboard's Positive/Neutral Leads KPI.
Wrap the derivation in the same short-TTL `cacheWrap` (60s) the dashboard uses so HiveMind
doesn't rescan all calls per request.

**Why wbah_calls, not leads:** the `leads` table is both dup-inflated AND has no
`last_called_at`; the authoritative WBAH lead universe lives in `wbah_calls`. See
wbah-leads-window-source.md and wbah-leads-dedup-explosion.md.

**Client-bundle safety:** `hivemind.ai.ts` is imported by client routes, so the
service-role client (`supabaseAdmin`) and `redis.server` `cacheWrap` must be pulled in via
**dynamic import** inside the helper, never a top-level import.

**General rule for any OTHER workspace's lead aggregates over the shared `leads` table:**
never `ORDER BY` and never add a secondary filter to a `count:exact` — both breach the
timeout on a bloated table. Use a single unfiltered `count:exact` for the headline total and
derive per-sentiment/source/status breakdowns in JS from a capped ≤1000-row unordered
sample (best-effort, shown as % + scaled estimate with a "sample of N total" caveat).

**Latent landmines (audit, don't blindly fix):** `leads.functions.ts` `getOverviewStats`
still has an ordered `recentLeads` query and `listLeads` orders by `updated_at`;
`hivemind.functions.ts` has ordered lead/event list queries — all large-WBAH timeout
exposure. The dup-explosion itself is a separate destructive cleanup, not part of this
read-side fix.
