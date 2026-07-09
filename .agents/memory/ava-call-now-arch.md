---
name: Call Ava Now homepage flow
description: OTP-verified homepage call requests → Retell outbound Ava call → conditional lead creation; key gating and pitfalls.
---

# Call Ava Now architecture

Homepage CTA → `CallAvaNowModal` (2-step) → `/api/public/ava-call/request` (provider-aware OTP)
→ `/api/public/ava-call/verify` (atomic claim → Retell `v2/create-phone-call` with
`override_agent_id` = live Ava agent). Audit table `ava_call_requests` (RLS deny-all =
service-role only). Core logic in `src/lib/lead-gen/ava-call.server.ts` + provider chain in
`src/lib/lead-gen/ava-otp-provider.server.ts`; shared HTTP handlers in
`src/lib/lead-gen/ava-call-http.server.ts`.

**Marketing-site alias endpoints:** the main Webespoke site (webespokeai.com — separate
Lovable-built SPA, NOT this codebase) has its own "Call Ava" widget that POSTs
`/api/public/ava-call/request-otp` and `/verify-and-call` with a different contract:
`businessWebsite` instead of `website`, and verify sends `{email, phone, otp}` (NO requestId).
Both alias routes exist here (CORS `*`); verify falls back to latest `pending_verification`
row by email+E.164 phone (`verifyAvaCallOtpByContact`). CRITICAL: the widget uses RELATIVE
URLs, so its requests hit the Lovable static host, which answers SPA HTML with HTTP 200 — the
widget treats that as success and plays a fake "Ava is speaking" animation with no OTP ever
sent. The Lovable site must point those two fetches at `https://webeebuilder.com/...`
(absolute) or proxy `/api/public/ava-call/*` there; nothing in this repo can fix that routing.

**OTP provider chain (env-driven):** Twilio Verify (`TWILIO_VERIFY_SERVICE_SID`) → Twilio SMS
(`TWILIO_PHONE_NUMBER`) → Resend email → 503 `{code:"no_provider"}` (modal shows "Book a Demo
instead" → opens the in-app `TalkToUsForm` popup). SMS send failure falls back to email at
runtime (`fallback:true` in response; the emailed code's hash IS stored, so verify still runs
locally). `twilio_verify` channel stores NO local `otp_hash` — verify dispatches: local hash if
present → else Twilio Verify check → else 410. Response includes `{channel, fallback}`; modal
copy is channel-aware. Envs: `OTP_SECRET` (mixed into sha256 hash), `OTP_EXPIRY_MINUTES` (1-60,
default 10), `AVA_OTP_FROM_EMAIL` (needs Resend-verified domain — only admin.webespokeai.com is
verified, so leave unset). Dev mode: `AVA_OTP_DEV_MODE=true` (+`AVA_OTP_DEV_CODE`, default
123456) — hard-blocked when NODE_ENV=production; channel comes back "dev".

**Abuse controls:** consent required (422 without), 3/hr rate limit per IP AND email AND phone
(`checkRateLimit` in webforms.server.ts, now windowMs-aware), 2 calls/day per phone AND per
email.

**Rules that must hold:**
- These requests NEVER create `need_to_call` leads. Lead created/promoted only when the
  post-call webhook shows booked appointment AND positive/neutral sentiment → `qualified`,
  `source_type=homepage_ava_call`, dedupe by email/phone.
- Idempotent via atomic `processed_at IS NULL` claim; never demote; `do_not_call` leads keep
  their status (details still recorded in meta/notes).
- Webhook processor gates ALL generic lead-writing blocks (no-answer, lead_gen,
  client_qualification, CRM dispatch) on `!isAvaHomepageCall` — the live Ava agent is ALSO a
  registered client_qualification agent in the admin workspace, so without gating every Ava
  homepage call would create leads through the generic path. WBAH untouched.

**Pitfalls learned:**
- `workspace_members` has NO PostgREST relationship to a `users` table — joining
  `users!inner(email)` fails with "Could not find a relationship". Resolve admin workspace via
  `supabaseAdmin.auth.admin.listUsers()` → membership rows (prefer `role=owner`), or set
  `WEBEE_ADMIN_WORKSPACE_ID` env (preferred in prod; listUsers caps at perPage 200).
- `sendResendEmail` returns `{ success }`, NOT `{ ok }` — checking `.ok` silently treats every
  successful send as a failure.
- Verify must atomically transition `status` away from `pending_verification`
  (`.eq("status","pending_verification").select()` + row-count check) or concurrent verifies
  double-trigger paid calls; any failure after the claim must mark the row `failed` or it
  sticks in `call_triggering`.
- Prod needs REPUBLISH for the new public routes; OTP emails need verified `RESEND_FROM`.
