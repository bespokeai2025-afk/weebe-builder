---
name: Qualified-page definition split + PrefetchOnLogin cache-key alignment
description: How "qualified" is defined per workspace type, and why prefetch args must match page query args exactly.
---

# "Qualified" means different things for WBAH vs standard workspaces

- **WBAH** (slug `webuyanyhouse`): the `/qualified` page is built directly on the real call log (`wbah_calls`), deduped per contact (digits-normalized phone, newest-first by `started_at`). A contact is qualified when its **latest call sentiment is `positive`** OR it **booked an appointment** (non-empty `calendly_booking_url` on ANY of its calls). The booking call's appointment fields are merged onto the row even when a later neutral follow-up is the latest call. Server fn: `listWbahQualifiedLeads`. (Older `sentiment='positive'`-only definition is retired.)
- **WBAH agent attribution:** `wbah_calls.agent_name` is NULL for EVERY row (the WeeBespoke sync never returns agent) and `meta` is `{}`. Per-agent data (the `/qualified` agent filter + Agent column) must be enriched from WBAH's OWN Retell API (`/v2/list-calls`, digits-normalized `to_number` → latest agent). Cache the phone→agent map separately (`webee:wbah-agent-map:{ws}`, 1h) so the short qualified-leads cache doesn't re-page Retell; enrichment is best-effort (try/catch) and the filter/column hide gracefully when agents are null.
- **Standard (all other) workspaces**: a lead is qualified by **lead status** (`status IN ('interested','qualified')`) — the SAME definition the dashboard KPI uses in `getOverviewStats` (`leads.functions.ts`).

**Why:** Standard accounts never populate `leads.sentiment='positive'`; they mark progress via `status`. They also do not reliably set `qualification_status='qualified'` (that field holds qualification-agent outcomes like `partially_qualified`). Applying the WBAH sentiment filter — or an AND on `qualification_status='qualified'` — to standard accounts hides every qualified lead (the `/qualified` table comes up empty even though the dashboard shows a non-zero Qualified count).

**How to apply:** Any server fn or query that lists/counts "qualified" leads must branch on `isWbah` (look up `workspaces.slug`). Keep WBAH on sentiment; keep standard on `status IN ('interested','qualified')`. Note `getQualificationStats` still uses older funnel semantics (`qualification_status IS NOT NULL`, qualified = `status='qualified'`), so its KPI cards can diverge from the table/dashboard for standard workspaces — reconcile only if asked.

# PrefetchOnLogin warms the EXACT React Query keys the pages use

**Rule:** `PrefetchOnLogin.tsx` calls `prefetch([...key], () => fn({ data }))` using the same query keys the route components use (e.g. `['leads-qualified','']`). The prefetch's server-fn args MUST match the page's query args. If they differ, the warmed cache serves the prefetched (wrong) data to the page for the full `staleTime` (commonly 5 min) before refetch.

**Why:** A bug where the page query was fixed but the prefetch still passed an old filter (`qualificationStatus:'qualified'`) re-introduced the empty/incorrect result via cache, even though the page query itself was correct.

**How to apply:** When you change a route's `useQuery` args, grep `PrefetchOnLogin.tsx` for the same query key and update the prefetch call in lockstep. The WBAH vs non-WBAH prefetch branches there are gated on `isWbah`.
