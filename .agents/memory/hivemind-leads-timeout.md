---
name: HiveMind lead reads time out on bloated leads table
description: Why HiveMind reported "0 leads" for WBAH and the count-not-order rule for any lead aggregate over the shared leads table
---

HiveMind/dashboard lead aggregates read the shared `leads` table. For WBAH that table
is dup-exploded (~397k rows, essentially the entire table — every other workspace
combined has ~1 lead). Any query that adds `ORDER BY created_at/updated_at` forces a
Parallel Seq Scan + top-N heapsort (no supporting index): ~3.9s at superuser, >8s under
the `authenticated` role (statement_timeout = 8s; anon = 3s; service_role = none),
worsened by RLS overhead, cold cache, and the constant WBAH sync hammering the DB.

**The silent failure:** on timeout the PostgREST call sets `le.error` and code like
`const leads = le.data ?? []` collapses to `[]` → every derived metric becomes 0 →
HiveMind answers "0 leads". The error is swallowed (only console.error'd).

**Rule:** for a lead TOTAL over the `leads` table, never fetch-rows-then-count and never
`ORDER BY`. Use a non-ordered `{ count: "exact" }` select and read `.count`. Isolate any
"most recent N" ordered query as a small, best-effort side query (or sort an already
fetched sample in JS) so its failure can't zero the headline number. This mirrors the
Leads page `getOverviewStats` (count:exact for totals; ordered query only for a 5-row
recent list).

**Why:** PostgREST caps any response at 1000 rows here, so fetch-and-count under-reports
anyway; and the ORDER BY is the specific thing that breaches the 8s timeout.

**Filtered counts time out too:** it is not only `ORDER BY` — a `count:exact` over WBAH's
`leads` *with a secondary filter* (e.g. `sentiment=positive`) also takes ~9-10s and 500s at
service-role. So any per-sentiment / per-source / per-status EXACT count is unsafe here.
HiveMind's sentiment and lead-source breakdowns are therefore derived in JS from the same
≤1000-row sample already fetched (no extra queries): exact for normal workspaces, and shown
as percentages + scaled estimates (with an explicit "sample of N total" caveat) for large
ones. Only the plain workspace-wide total uses `count:exact` (the one count cheap enough).

**Latent landmines (audit, don't blindly fix):** `leads.functions.ts` `getOverviewStats`
still has an ordered `recentLeads` query and `listLeads` orders by `updated_at`;
`hivemind.functions.ts` has ordered lead/event list queries. All are large-WBAH timeout
exposure. The dup-explosion itself is a separate, destructive cleanup (see
wbah-leads-dedup-explosion.md) — not part of the read-side fix.

**Note:** after the fix, WBAH's headline `leads.total` is exact (~397k, dup-inflated, and
matches the Leads-page KPI) but secondary breakdowns (active/idle/needCall/sales/
stageCounts/today/week/month) are still computed from a capped 1000-row unordered sample
— treat those as best-effort, not exact, for very large workspaces.
