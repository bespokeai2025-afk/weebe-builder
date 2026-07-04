---
name: WATI optional connector pattern
description: How WATI is implemented as an additive optional integration — gating rules, file map, and migration note.
---

## Rule
WATI is strictly optional. Every WATI UI element is gated behind a `wati-connection` query that checks `wati_connections` table for a connected row. If the row is absent, the UI is identical to pre-WATI.

**Why:** Architecture doc mandates WATI never be required. Platform must work fully with Meta/Twilio alone.

**How to apply:** Any new WATI feature must: (1) query `getWatiConnection`, (2) render nothing (or a "connect WATI" hint) if `!watiConnected`, (3) never modify runtime/builder/Retell/HyperStream.

## File map
- Server functions: `src/lib/whatsapp/wati.functions.ts` — connect/disconnect/test/sync + list queries
- Settings UI: `src/components/whatsapp/WatiIntegrationSettings.tsx` — injected at bottom of WhatsAppSettings.tsx
- Campaigns: `WhatsAppCampaigns.tsx` — WATI campaigns section appended after native campaigns
- Templates: `WhatsAppTemplates.tsx` — WATI templates grid appended; source badges on native templates
- Contacts: `WhatsAppContacts.tsx` — "Import from WATI" button; source='wati' in SOURCES array
- Analytics: `WhatsAppAnalytics.tsx` — Provider breakdown card; WATI row added when connected
- Webhook: `src/routes/api/webhook/wati-inbound.ts` — normalizes WATI events → whatsapp_messages table

## Migration
File: `supabase/migrations/20260614000000_wati_connector.sql`
Tables: wati_connections, wati_templates, wati_campaigns, wati_contacts, wati_sync_logs
Must be applied manually in Supabase SQL Editor — cannot run via JS client.

## Split-brain credential store + endpoint derivation
There are TWO WATI credential stores and they are NOT interchangeable:
- `wati_connections` (api_key + tenant_id) — the CANONICAL store. `connectWati` / the settings `whatsapp:wati` form write here, and it is what populates `wati_templates` (so the builder template picker is gated on it). Runtime send code MUST read this table.
- `provider_settings` (Universal Provider Framework, credentials JSON) — the settings form never writes `apiEndpoint` here, so reading it for WATI silently returns null. Keep only as a secondary source.

**Why:** A runtime path that resolved WATI creds from `provider_settings` looked correct and passed LSP, but returned null for every normally-onboarded workspace → WATI template/media sends silently fell back to plain text. The picker (reads wati_connections) and the sender (read provider_settings) were split-brained.

**How to apply:** To build a WATI provider config at runtime, read `wati_connections` where status='connected', then set `apiEndpoint = https://live-mt-server.wati.io/{tenant_id}` — the tenant ROOT WITHOUT `/api/v1`, because `wati.adapter.ts` appends `/api/v1/...` to every call (sendSessionMessage, sendSessionFile, sendTemplateMessage, getContacts). `watiBase()` in wati.functions.ts includes `/api/v1` and is for that file's direct fetches only — do NOT feed it to the adapter or you get a double `/api/v1`.

## Media & template sends
- WATI has no send-by-URL for session files: media (`msg.mediaUrl`) is fetched server-side and POSTed as multipart to `/api/v1/sendSessionFile/{to}?caption=...`.
- Approved templates: builder `wa_template` node has optional `watiTemplateName` + `watiTemplateParams`; runtime sends via WATI `sendTemplate` when a WATI config resolves, else free-text `templateBody` fallback (wrap the WATI call in try/catch so a WATI API error still advances the turn). Only trim TRAILING empty params — filtering all empties breaks WATI positional {{1}}/{{2}} mapping.
