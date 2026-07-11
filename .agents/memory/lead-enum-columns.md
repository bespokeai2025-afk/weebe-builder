---
name: leads table enum columns
description: leads.source (lead_source) and leads.status (lead_status) are Postgres enums — any insert with a free-text value 422s the whole row.
---

## The rule
`leads.source` is enum `lead_source` and `leads.status` is enum `lead_status`. Never write unvalidated strings into either column — Postgres rejects the entire insert with `invalid input value for enum …`, which surfaces as a 422/500 to public form posters and API callers.

- `lead_status` labels: `need_to_call, calling, completed, interested, not_interested, not_connected, do_not_call, qualified` — there is NO `new`; the app's entry status is `need_to_call` (displayed as "New Lead").
- `lead_source` labels (after 2026-07-08 migration `20260708120000_lead_source_webform_values.sql`, applied live): original `website, inbound, outbound, referral, import` + all webform source types (`website_form`, `landing_page`, `facebook_lead_form`, `google_ads_lead_form`, `tiktok_lead_form`, `linkedin_lead_form`, `zapier`, `make`, `custom_form`, `webee_website_form`) + `api`.
- Free-text source detail belongs in `leads.source_type` (text), not `source`.

**Why:** The public webform endpoint wrote its free-text `source_type` ("website_form") into the enum `source` column and `status: "new"` — every webform submission on every account 422'd. The developer API endpoints (`/api/v1/contacts`, `/api/v1/campaigns`) had the identical bug with `"api"`/`"new"`.

**How to apply:** Any new code inserting into `leads` must use `toLeadSourceEnum()` (exported from `webforms.server.ts`) for `source` and a valid `lead_status` label (entry = `need_to_call`). If a new source label is added to the DB enum, mirror it in `LEAD_SOURCE_ENUM_VALUES` (drift only mislabels, never fails).

## Supabase builder `.catch()` trap
supabase-js query builders are thenables that do NOT throw on DB errors and (for bare `.insert()`) do NOT have `.catch()` — `insert(...).catch(...)` crashes with TypeError at runtime, and try/catch around an awaited builder is dead code for DB errors. Best-effort inserts must destructure `{ error }` and log it; that's how the `entity_notes` column mismatch (`content` vs actual column `body`) stayed invisible.
