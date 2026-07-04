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
