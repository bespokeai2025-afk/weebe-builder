---
name: WBAH pipeline derivation
description: Why the Pipeline board derives WBAH cards from wbah_calls, and the stage-move writeback gotcha that follows.
---

# WBAH pipeline derivation

`getPipelineLeads` branches on `workspaces.slug === "webuyanyhouse"`. For WBAH it must
derive cards from the clean `wbah_calls` table, NOT the `leads` table.

**Why:** WBAH's `leads` table is dup-inflated (~400k rows); any `ORDER BY` over it
breaches the Postgres statement timeout, so the pipeline never loads. wbah_calls is
small/clean. Same reason the dashboard/`/leads` window already derive from wbah_calls
(`listWbahPositiveNeutralLeads`).

**How to apply:**
- WBAH pipeline = dedup wbah_calls per phone (latest-first, first-seen wins), keep
  `sentiment === "positive"` only (that IS the "qualified" definition for WBAH), map
  booked (appointment_date / calendly_booking_url present) → `bookings` stage, else
  `qualified`. Cache 60s. No transcript fetch needed (skip it — it's the slow part).
- Standard workspaces: read `leads` with `select("*")` + defensive `mapLead`, NOT a
  hard-coded column list. A single missing optional column (monthly_revenue/
  call_outcome/state_name/…) used to make every fallback tier fail and break the page
  for ALL standard accounts. Detect pipeline_stage via `"pipeline_stage" in row`.

**Gotcha — stage-move writeback is a no-op for WBAH:** pipeline cards carry the row
`id`. WBAH card ids are `wbah_calls.id`, but `setLeadPipelineStage`/`setSaleDoneAmount`
update the `leads` table by `id` → zero rows match → returns `{ok:true}` while nothing
persists, so an optimistic drag reverts on refetch. This is inherent to the data model;
WBAH pipeline is effectively read-only for stage moves. If you ever need WBAH DnD to
persist, add a WBAH-specific store keyed by wbah_calls.id — do NOT point it at `leads`.
