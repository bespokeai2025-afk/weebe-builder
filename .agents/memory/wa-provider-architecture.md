---
name: WhatsApp provider architecture
description: Three-provider WA setup (Twilio/WATI/Meta), how creds are stored, webhook routing, and the agent gate pattern.
---

## Providers
- **Twilio** — creds in `workspace_settings` (`twilio_account_sid`, `twilio_auth_token`, `whatsapp_phone_id`). Webhook auto-registered via Twilio API on save. Inbound: POST form-urlencoded + `X-Twilio-Signature`.
- **WATI** — creds in `wati_connections` table (separate row per workspace, `status=connected`). Webhook auto-registered via WATI `POST /api/v1/updateWebhook` on connect.
- **Meta** — creds in `workspace_settings` (`meta_phone_number_id`, `meta_waba_id`, `meta_access_token`, `meta_verify_token`). Webhook is manual: user pastes callback URL + verify token into Meta Developer Portal → App → WhatsApp → Configuration → Webhook, then subscribes to `messages` field. Inbound: GET for hub.challenge, POST JSON `{object:"whatsapp_business_account"}`.

**Migration required for Meta:** `20260615000000_meta_wa_fields.sql` (ADD COLUMN IF NOT EXISTS × 4).

## Active provider detection
`getWAProviderStatus` checks all three and returns `{ twilioConfigured, watiConnected, metaConfigured, isConfigured, provider }`.
`isConfigured` gates the Agents tab — if false, a setup wall is shown.

## Webhook handler
Single route: `GET|POST /api/public/whatsapp-webhook/{workspaceId}`
- GET → Meta hub.challenge verification (matches `meta_verify_token`)
- POST JSON → Meta message handler
- POST form-urlencoded → Twilio handler (verifies HMAC-SHA1 signature)

## Runtime send routing
`runtime.ts` reads `whatsapp_provider` from workspace_settings, calls `sendMeta()` (Graph API v19.0) or `sendTwilio()` accordingly.

**Why:** Meta requires a manual webhook verification step that can't be automated server-side (OAuth app review process). Twilio and WATI are fully automated.
