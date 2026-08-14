---
name: Canonical lead origin system
description: lead_origin + origin_provider columns on leads table; shared derivation module; creation paths; UI filter.
---

## Rule
`lead_origin` and `origin_provider` are the canonical fields for how a lead FIRST entered WEBEE.
They are SEPARATE from `source` (enum), `status`, `sentiment`, and `campaign`.

**Why:** The `source` enum is incomplete (no 'retell' value, no 'voice_call'), has schema drift,
and mixes channel with provider. New columns allow clean semantics without breaking existing code.

## DB columns (added migration 20260814000000_lead_origin.sql)
- `leads.lead_origin` text — one of: whatsapp | voice_call | web_form | manual | csv_import | crm | email | sms | campaign | api | unknown
- `leads.origin_provider` text — WATI | WEBEE Voice | WeeBespoke | Website | CSV | API | CRM | null
- Index: `leads_lead_origin_ws_idx ON leads(workspace_id, lead_origin) WHERE NOT NULL`

## Shared module
`src/lib/leads/lead-origin.shared.ts`
- `deriveLeadOrigin(lead)` — reads lead_origin column first, falls back to source/buzzchat evidence
- `ORIGIN_FILTER_OPTIONS` — for UI dropdowns
- `ORIGIN_META` — labels, icons, tones

## Creation paths (all stamp lead_origin at insert time)
- WhatsApp/WATI: `src/lib/whatsapp/lead-sync.server.ts` → whatsapp / WATI
- WBAH CRM: `wbah-leads-sync-tick.ts` buildLeadRow → crm / WeeBespoke
- WBAH booked calls: `wbah-leads-sync-tick.ts` buildBookedCallRow → voice_call / WEBEE Voice
- Webforms: `src/lib/lead-gen/webforms.server.ts` → web_form / Website
- CSV import: `src/lib/whatsapp/csv-import-batch.server.ts` → csv_import / CSV
- API v1 POST: `src/routes/api/v1/leads.ts` → api / API

## v1 API
- GET: returns `leadOrigin`, `originProvider`, `originLabel` (computed); `?origin=` filter param
- POST: sets lead_origin='api', origin_provider='API'

## Web UI
- `src/routes/_authenticated/leads.index.tsx`: `leadOriginBadgeSpec()` uses deriveLeadOrigin; Origin badge on name column; "All Sources" filter dropdown
- Server-side: `listLeads` accepts `origin` param → `.eq('lead_origin', origin)`

## Backfill result (Aug 2026 — 498,161 leads)
- voice_call: 496,431 (WBAH call records — via workspace_id batch update)
- csv_import: 1,715 (actual CSV/WhatsApp imports)
- unknown: 12
- whatsapp: 2 (BuzzChat / WATI)
- crm: 1

## Pitfall
WBAH leads have source='import' but lead_origin='voice_call'. The import batch was fast (~25 batches × 20k), 
but a single UPDATE on 400k rows killed the DB connection — always batch large UPDATEs.
