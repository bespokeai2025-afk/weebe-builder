---
name: WBAH crm-contacts webhook mirror
description: Fix and known bugs around wbah_crm_contacts population from the post-call webhook pipeline.
---

# WBAH crm-contacts webhook mirror

## The fix (shipped)
`src/lib/wbah/post-call/wbah-calls-upsert.server.ts` — `upsertWbahCallFromWebhook` now upserts a `wbah_crm_contacts` row after every WBAH call webhook, using `ignoreDuplicates: true` (existing WeeBespoke CRM rows are never overwritten). Agent `role` maps to `lead_status`: `new_leads_dialer→New`, `tried_to_contact→Tried To Contact`, `rebooking→Rebook Initial Consultation`.

**Why:** The People tab reads from `wbah_crm_contacts`. Before this fix, contacts whose call came in via Retell webhook but were not pre-loaded by WeeBespoke's `get-all-calldata` CRM sync were invisible — no contact row, no results shown.

## Known issues (tasks #593, #594)

### lead_origin column missing (#593)
`wbah-booked-calls-sync` tries to upsert `lead_origin` into `wbah_crm_contacts` but the column doesn't exist in the table → error on every webhook. Non-fatal but pollutes logs. Fix: either add the column via migration or remove it from the upsert payload.

### get-userCall-lead pagination bug (#594)
`src/lib/integrations/webespokeEnterprise/wbah-leads-sync-tick.ts` `fetchAllLeadRecords` reads pagination from `p1.data.pagination` (line 319). The WeeBespoke API actually returns pagination at the **top level** (`response.pagination`, not `response.data.pagination`). Result: `totalItems` = 0, only page 1 of 60 is ever fetched, leads table stale since June 2026.

**Fix:** change `(p1.data as any)?.pagination` to read from the top-level `pagination` field returned by `apiFetch`.

## Data sources architecture
- `wbah_crm_contacts` — populated by two paths:
  1. `syncWbahCrmContactsToDb` (from `get-all-calldata`, 24 pages, ~1189 CRM contacts) — throttled 5 min, triggered on People page load
  2. `upsertWbahCallFromWebhook` (post-call webhook, `ignoreDuplicates=true`) — for any contact not in CRM feed
- `get-all-calldata` = WeeBespoke's Dynamics CRM export (booked + TTC + disqualified contacts)
- `get-userCall-lead` = WeeBespoke's new leads feed (2987 records, 60 pages) — feeds WEBEE `leads` table via sync tick
