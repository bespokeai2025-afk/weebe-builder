---
name: Webform Lead Capture System
description: Architecture of the webform lead capture system — DB tables, public endpoints, field mapping, TalkToUs form.
---

## Tables
- `webform_sources` — one row per form endpoint; `form_token` is the public identifier (48-char hex).
- `webform_submissions` — raw + mapped payloads per submission, linked to lead.
- `leads` extended with: `source_type`, `source_detail`, `source_page`, `utm_source`, `utm_medium`, `utm_campaign`, `referrer`, `external_source_id`.
- `webform_rate_limits` — in-DB rate limiting (key, count, window_start).
- Migration: `20260722000001_webform_lead_capture.sql` — manual apply in Supabase SQL Editor.

## Key files
- `src/lib/lead-gen/webforms.server.ts` — core engine: field mapping, spam check, dedup, lead creation, email notify.
- `src/lib/lead-gen/webforms.functions.ts` — TanStack server fns (list/create/update/delete/stats).
- `src/routes/api/public/webforms.$formToken.ts` — POST /api/public/webforms/:token (JSON/urlencoded/multipart).
- `src/routes/api/public/contact.ts` — POST /api/public/contact (WEBEE Talk to Us, 5 req/min).
- `src/routes/_authenticated/leads.webforms.tsx` — management UI at /leads/webforms.
- `src/components/landing/TalkToUsForm.tsx` — modal form component + `useTalkToUs()` hook.

## Notes
- `entity_notes` (not `notes`) is the correct table name in this codebase.
- TanStack Start API route pattern: `server: { handlers: { POST: async ({ request, params }) => {} } }` inside `createFileRoute(...)({...})`.
- Default field mapping covers 20+ common HTML name attributes → canonical lead fields.
- Honeypot fields: `_hp`, `website_url`, `fax`, `url2`, `address2` — any non-empty value = spam drop.
- WEBEE internal contact form auto-seeds a `webform_sources` row on first use (source_type: `webee_website_form`).

**Why:** Website forms need a zero-config POST endpoint; field mapping handles the variety of HTML name attrs across different form builders.
