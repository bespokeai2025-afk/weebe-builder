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
