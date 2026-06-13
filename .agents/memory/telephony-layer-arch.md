---
name: Telephony Layer Architecture
description: Key decisions for the provider-agnostic telephony layer (Twilio-first) built alongside Retell.
---

## Rule
Use entirely separate DB tables (`telephony_configs`, `phone_numbers`, `telephony_calls`, `call_events`, `campaigns`) — never modify or join into Retell's `calls` table.

**Why:** Retell owns `calls`. Mixing them would break existing Retell webhooks and dashboard queries.

## Architecture
- `src/lib/telephony/types.ts` — `TelephonyProvider` interface + all shared types.
- `src/lib/telephony/twilio.provider.ts` — `TwilioProvider` implements the interface; any new carrier only requires a new file + a new case in the factory.
- `src/lib/telephony/provider-factory.ts` — `createTelephonyProvider(config)` returns the right provider; agents/campaigns call this, not Twilio directly.
- `src/lib/telephony/telephony.functions.ts` — all `createServerFn` CRUD functions for phone numbers, calls, campaigns, settings.

## Public Webhooks (no auth)
- `POST /api/public/telephony/inbound` — Twilio hits this on inbound call; responds with TwiML `<Connect><Stream …/>`; creates `telephony_calls` row.
- `POST /api/public/telephony/status` — call status transitions; updates `telephony_calls.status` + inserts `call_events`.
- `POST /api/public/telephony/recording` — recording ready; writes `recording_url` to the call row.
- All use `supabaseAdmin` (service role) since there is no user auth context.

## Audio Bridge (WebSocket)
- `telephony-stream.plugin.ts` — Vite dev plugin, mirrors hyperstream-relay pattern. Path: `/api/telephony/stream/:callId`.
- Protocol: Twilio sends μ-law 8 kHz chunks as base64 JSON; bridge decodes μ-law → PCM16 → resample to 24 kHz → OpenAI Realtime; response PCM16 24 kHz → resample to 8 kHz → μ-law encode → Twilio.
- Same codec pattern must be implemented in the srvx production server handler if deploying to non-dev.

## How to apply the migration
```bash
supabase db push
# or via Supabase dashboard SQL editor:
# paste contents of supabase/migrations/20260613_telephony_layer.sql
```

## Dashboard pages
- `/phone-numbers` — list/add/delete numbers, assign agent.
- `/telephony-calls` — call history with recording player + transcript viewer.
- `/campaigns` — outbound bulk call campaigns with stats.
- `/telephony-settings` — Twilio credentials + webhook URL display.
- Sidebar section: "Telephony" group added between main nav and Admin.
