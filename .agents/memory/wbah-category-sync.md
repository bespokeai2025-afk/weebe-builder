---
name: WBAH multi-category lead sync
description: How the Disqualified / Tried-To-Contact / Rebooking lead categories are classified and why new wbah_* PII tables must have RLS.
---

# WBAH multi-category lead sync

Syncs WeeBespoke leads into three WEBEE categories (disqualified, tried_to_contact,
rebooking) stored in `wbah_categorized_leads` (+ `wbah_category_sync_log`), surfaced
as sub-tabs on the Data page.

## Classification is heuristic, not authoritative
The WeeBespoke Enterprise **call-output** API does not expose lead filter-status
fields, so the engine cannot map a lead to a category by a server-provided status.
It builds a status-code map where it can, then falls back to heuristics on
`disconnectionReason` / `callStatus` / `sentiment`.
**Why:** the get-userCall-lead source only carries Neutral/Positive sentiment with
no negative/callback signal, so this sync lands ~everything in `tried_to_contact`
and ~0 in disqualified/rebooking.

## Disqualified is NOT fed by this sync anymore — see wbah-disqualified-derivation.md
The Disqualified sub-tab + KPI are now derived **live** from the `wbah_calls` table
as "clients that need to be called" = every contact NOT booked
(`booking_status <> 'success'`), deduped per contact — NOT from
`wbah_categorized_leads`. So its count in `wbah_categorized_leads` is NOT the metric
to trust; the tab bypasses it. tried_to_contact / rebooking still read
`wbah_categorized_leads`.

## New wbah_* PII tables MUST enable RLS
Any new `wbah_*` table holding lead PII must `ENABLE ROW LEVEL SECURITY` with a
workspace-members SELECT policy, mirroring the existing `wbah_calls` table.
**Why:** these tables sit in Supabase's public schema; without RLS the anon/public
API can read/modify tenant PII. A review flagged a missing-RLS migration as a
blocking multi-tenant data-exposure risk.
**How to apply:** server functions read AND write via the service-role client
(`supabaseAdmin`), which bypasses RLS — so a SELECT-only policy is sufficient and
does not break sync/read. Mirror the wbah_calls policy exactly.

## Sync idempotency
Upsert keyed on the `(workspace_id, external_lead_id)` unique index via
`.upsert(batch, { onConflict: "workspace_id,external_lead_id" })` — atomic and safe
when the manual Sync button overlaps the scheduled plugin tick. imported/updated
counts are advisory under concurrency; the row state is authoritative.

## Admin gating
Sync is admin-only and enforced server-side (`triggerWbahCategorySync` throws
"Admin access required"). The UI additionally hides the Sync / Sync All buttons via
a small `getWbahCategorySyncAccess` server fn returning `{ canSync }`; never rely on
the UI gate alone.
