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
