---
name: Website Ava web-call lead capture
description: Browser (Retell web-call) "Talk to Ava" flow on the marketing site — session endpoint, webhook routing, lead rules, security decisions.
---

# Website Ava web-call lead capture

- Public endpoint `POST /api/public/ava-web-call` creates the Retell web-call session server-side (platform key never client-side), with honeypot + per-IP rate limit + AVA_CALL_CORS, and attaches attribution metadata (`source: website_ava`, visitor/UTM/gclid).
- The webhook processor previously ignored ALL `web_call` events. Now `isWebsiteAvaWebCall` (source === "website_ava" OR agent_id === live Ava agent) routes `call_analyzed` to `processAvaWebCallAnalyzed`; every other web call stays ignored as builder test traffic. Consequence: builder-preview calls made with the LIVE Ava agent can create leads in the admin workspace — use a different agent for builder testing.
- **Never trust `metadata.workspace_id` for routing.** Webhook signature verification accepts any workspace's Retell key, so payload metadata is attacker-influenceable; website leads are ALWAYS hard-routed to `resolveAdminWorkspaceId()`.
- Web calls run the same atomic `claimWebhookDelivery` dedup ledger claim as phone calls (fail-open on ledger error); second layer is a `meta.retell_call_id` contains-check on leads.
- Lead qualifies on booked OR positive sentiment OR explicit follow-up request OR qualified flag; blocked on negative sentiment. `leads.phone` is NOT NULL — email-only web visitors insert `phone: ""`.
- E2E test recipe: signed webhook via HMAC-SHA256(body+ts, RETELL_API_KEY), header `x-retell-signature: v=<ts>,d=<hex>`.
- Live Ava agent (conversation-flow) books via Retell's NATIVE `book_appointment_cal` tool with a Cal.com key + event type EMBEDDED in the flow JSON — NOT via /api/public/retell/book. Rotating the Cal key requires updating the flow too.
- Booking-failure trap: LLM can pass the spoken/spelled-out email ("N A T ... at icloud dot com") → Cal.com 400 email_validation_error. Fixed via CRITICAL BOOKING EMAIL RULE in flow global_prompt (v12). Diagnose via Retell get-call transcript_with_tool_calls under the ADMIN WORKSPACE key (workspace_settings.retell_workspace_id), not the platform RETELL_API_KEY.
- Version pin: AVA_AGENT_VERSION shared env var; after publishing a new agent version, bump the pin AND republish prod for it to take effect. Note: Ava's live agent lives under the admin WORKSPACE Retell key (workspace_settings), not the platform key — sign test webhooks with that key.
- Hardening (July 2026): webhook routes return 401 (not 200) when the signature is invalid; dedup key is `event_type:call_id` (payload-byte differences in retries still dedupe); Ava web-call processing requires the signing key to belong to the admin workspace or platform (several workspaces can SHARE one Retell key, so signed-by is a SET and authz is membership, not first match).
- Booking truth: only a successful `book_appointment*` tool result in `transcript_with_tool_calls` sets `booking_confirmed`; post-call extracted booking claims land as `unconfirmed` with a logged discrepancy. Web calls also upsert a `calls` row (enum call_status uses `in_progress`/`completed` — "ongoing"/"ended" are invalid).
- Session hardening: `WEBEE_WORKSPACE_ID` pins + validates the target workspace; `AVA_AGENT_VERSION` pins the published agent version in create-web-call; workspace/source dynamic variables are server-forced.
