---
name: External-agent live-transcript ingest
description: How WEBEE surfaces a LIVE transcript for a Retell agent NOT deployed through WEBEE (its webhook stays on external n8n).
---

# External-agent live-transcript ingest

Some Retell agents belong to older/external setups: their Retell `webhook_url`
points at an external automation (n8n) feeding a legacy dashboard, and WEBEE only
learns of their calls later via the WBAH API sync. Such an agent has NO row in
WEBEE's `agents` table, so the normal webhook processor's `resolveAgent()`
returns null and drops every event — live transcript can't work for it through
the standard managed-webhook path.

**Pattern:** do NOT repoint the agent. n8n fans out a COPY of each Retell event
to a dedicated WEBEE endpoint `POST /api/public/retell-live-ingest`, which is
DISPLAY-ONLY (writes solely to `live_call_sessions`, reusing
upsertLiveCallSession/markLiveCallSessionEnded). It never touches
calls/leads/CRM/analytics or the WBAH sync, so it can't create duplicate call
logs or disturb any existing pipeline.

**Auth:** shared secret header `x-webee-live-ingest-secret` (env
`WEBEE_LIVE_INGEST_SECRET`), NOT a Retell signature — the payload is relayed by
n8n so the original signature is absent/unverifiable. 503 when unset, 401 on bad
secret, else always 200 (non-blocking so a WEBEE hiccup can't fail the n8n step).

**Agent→workspace link is a HARDCODED allow-map inside the endpoint file** (only
listed agents accepted; all others ignored; caller cannot pick a workspace).

**Why an in-code allow-map, not an `agents` row or
`workspace_settings.retell_default_agent_id`:** an agents row would make the
external agent show in the workspace builder UI and risk a later redeploy
overwriting its prompt/flow; setting the workspace default agent would change
tenant routing. The allow-map keeps this strictly display-only with zero
builder/UI/tenancy side effects — honouring "don't change
model/prompt/voice/tools/flow/workspace logic".

**How to apply:** to add another externally-hosted agent, add an entry to the
allow-map in `src/routes/api/public/retell-live-ingest.ts` and have that agent's
n8n forward the same events. Requires a production republish to go live.

## WBAH concrete topology (the live wiring)

- **Two Retell accounts, same n8n webhook.** The allow-mapped agent
  `agent_0440750bb59597eef7352901bf` ("WBAH Client qualification agent outbound")
  lives in the **platform** account (`RETELL_API_KEY`) — that is the account that
  actually runs the calls. WBAH's *own* Retell key holds a parallel copy of the
  same-named agent under a DIFFERENT id (`agent_50598858538a69272a4bf04bf8`), plus
  siblings (Tried-to-contact, New-Leads, Rebooking). Don't assume the workspace
  key contains the mapped agent — it 404s there; check the platform key.
- **WBAH's own Retell API key** is stored in `workspace_settings.retell_workspace_id`
  (misnamed column — it holds the key, not a workspace id); read via
  `requireWbahRetellKey()`.
- **n8n instance:** `https://bespoke.app.n8n.cloud` (public API base `/api/v1`,
  header `X-N8N-API-KEY`; PUT /workflows/{id} accepts only `{name,nodes,connections,settings}` and does NOT toggle `active`).
- **The workflow that receives WBAH Retell events** is `yR3vAIdZNLovD8jx`,
  confusingly named *"Test Gyana - Receive Data From Retell ... (CALLBACK SUPPORT)"*
  — it IS the live production receiver (authoritative proof: every WBAH agent's
  `webhook_url` = `bespoke.app.n8n.cloud/webhook/392d5d13-7ee2-4fa0-ad46-7736ba4603bf`,
  which is this workflow's Webhook-trigger path). Don't be fooled by the "Test" name.
- **Forwarder node** "WEBEE Live Ingest" (httpRequest, `onError:continueRegularOutput`)
  is hung as an extra parallel branch off the "Webhook" trigger's `main[0]` — no
  existing node/connection touched, webhook path preserved. **Raw Retell payload is
  at `$json.body`** (downstream nodes read `$json.body.call`), so the node posts
  `={{ JSON.stringify($json.body) }}`.
- **Why:** identifies exactly where a future change (new agent, moved webhook,
  broken forward) must land, and records that the platform vs workspace Retell key
  split is real — a lesson that cost several 404s to learn.
