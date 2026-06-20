---
name: WBAH leads table inflation & read performance
description: Why WBAH lead reads time out and how to fix perf (incl. how to run Supabase DDL from the sandbox).
---

The WBAH (`webuyanyhouse`) `leads` table is massively inflated (~190k+ rows) from the
known dedup issue, even though the source CRM has only ~1.5k unique sellers. The user
has DECLINED to fix the dedup/data layer, so reads must cope with the bloat.

## Symptom
`listLeads` does `select("*").eq(workspace_id).order("updated_at", desc).range(...)`.
With no index supporting the sort, the ORDER BY times out (~8s, "canceling statement
due to statement timeout") → server fn throws → `useQuery(throwOnError:false)` →
`data` undefined → leads render empty → "leads dont load". The write side (sync
upsert) hits the same timeout under the bloat — that is the user-owned dedup problem,
not a read bug.

## Durable lessons
- **Supabase DDL CAN be run from the sandbox** via the Management API:
  `POST https://api.supabase.com/v1/projects/{ref}/database/query` with
  `Authorization: Bearer $SUPABASE_ACCESS_TOKEN` and body `{ "query": "..." }`.
  `ref` = subdomain of `VITE_SUPABASE_URL`. This contradicts the older "DDL can't run
  via JS client" note — that limitation is only for the supabase-js/PostgREST client,
  NOT this Management API path. Use plain `CREATE INDEX` (not CONCURRENTLY — the
  endpoint may wrap in a tx); 190k rows builds in ~15s.
- **`DATABASE_URL` / `PG*` env vars point to the EMPTY local Replit Postgres, NOT
  Supabase.** Querying them returns "relation does not exist". Real data is only via
  `VITE_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (PostgREST) or the Management API.
- **`process.env` is undefined inside the code_execution sandbox.** Use `bash` +
  `node -e` (or `node` scripts) where `process.env` and `@supabase/supabase-js` work.
- **Index pattern:** the fix here was `CREATE INDEX idx_leads_workspace_updated ON
  public.leads (workspace_id, updated_at DESC)` — mirrors existing `leads_status_idx`
  (workspace_id,status) and `calls_started_at_idx` (workspace_id,started_at DESC).
  `sentiment` and `callback_date` have NO index, so count-by-sentiment is ~7s and a
  full-workspace exact count times out — relevant if touching `getOverviewStats`.

## Scaling rule for list reads on this table
Fetch-all-then-filter-client-side does NOT scale: 5000 rows = 5 sequential PostgREST
pages (1000-row cap each) ≈ 37s and ~17MB (≈3.4MB per 1000 rows — `select("*")` pulls
huge `meta`/transcript JSON), and deep-offset pages spike past the statement timeout.
Cap list fetches to a single 1000-row page (~4.4s). The proper long-term fix is
server-side filtering + keyset pagination + a narrow column projection (drop the heavy
`meta.transcript` from list payloads).
