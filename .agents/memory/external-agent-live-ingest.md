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

- **Two Retell accounts, same n8n webhook.** Two same-named copies of the
  qualification agent exist: `agent_0440750bb59597eef7352901bf` on the **platform**
  account (`RETELL_API_KEY`) and `agent_50598858538a69272a4bf04bf8` on WBAH's **own**
  workspace key (plus siblings Tried-to-contact, New-Leads, Rebooking). As of
  2026-07-06 the **active dialer is agent_50598 (workspace key), version 27** — recent
  outbound calls all use it; agent_0440 has NO recent WBAH calls. (An older note here
  said agent_0440 "runs the calls"; that is no longer true — verify via recent call
  history before assuming.) Both ids are in the ingest allow-map, but
  `transcript_updated` is enabled ONLY on agent_50598 (the live dialer); if a future
  campaign switches to agent_0440, enable it there too or transcripts go dark.
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

## n8n relay status: ONLINE (verified 2026-07-06)

An earlier note claimed `bespoke.app.n8n.cloud` was OFFLINE ("404 - No workspace
here"). That is NO LONGER TRUE. Verified 2026-07-06 by POSTing a synthetic
`transcript_updated` to the production webhook and reading n8n execution history
(public API `/api/v1/executions?workflowId=...&includeData=true`): the run succeeded
and the "WEBEE Live Ingest" branch forwarded to WEBEE. Always re-check liveness
before assuming — don't trust a stale "offline" note.

## The live-transcript chain has THREE independent parts (all required)

1. **Retell** — the ACTIVE dialer agent must subscribe `transcript_updated` (opt-in,
   NOT in Retell's default started/ended/analyzed set). Set via
   `PATCH /update-agent/{id}` with `webhook_events` = the union. PATCHing an
   UNPUBLISHED draft (is_published:false) edits it in place (version number
   unchanged) and touches nothing else (flow_id/voice/model preserved).
2. **n8n** — the relay must forward events to `/api/public/retell-live-ingest` AND
   must NOT leak `transcript_updated` into legacy branches. The "started/ended"
   branch must POSITIVELY whitelist `event=="call_started" OR "call_ended"` — a
   catch-all `event != "call_analyzed"` silently forwards transcript chunks (and
   call_failed/transferred) to the legacy UAT dashboard. Update via full PUT
   (`{name,nodes,connections,settings}`; active state preserved); deep-diff nodes +
   connections to prove ONLY the intended node changed.
3. **WEBEE ingest allow-map** — `LIVE_INGEST_AGENTS` in `retell-live-ingest.ts` must
   contain the dialer's agent_id. This is CODE, baked into the immutable Replit
   Autoscale build, so **prod requires a REPUBLISH** to pick up allow-map additions.
   Diagnose prod's live map by POSTing a synthetic `transcript_updated` with the
   secret header and checking for `{"ignored":"unmapped agent"}` vs a processed
   `{"ok":true,"event":...}`. Dev (current code) and prod (last published build) can
   disagree — that gap == "needs republish".

**Read path (no code change needed):** `live-calls-sse.ts` ticks ~every 1.5s calling
`fetchActiveLiveCallSessions` (returns ringing/in_progress within 15 min) and prefers
the session transcript; an ingest upsert with `call_status:"ongoing"` derives
`in_progress` and surfaces immediately.

## 4th requirement: transcript_updated carries the transcript at the TOP LEVEL

Retell's real `transcript_updated` body is `{event, call, transcript_with_tool_calls,
event_timestamp}` — the transcript array is a **SIBLING of `call`**
(`body.transcript_with_tool_calls`), NOT inside `body.call`. `body.call` has only
call metadata (no `transcript`/`transcript_object`/`transcript_with_tool_calls`).
Post-call events (call_ended/analyzed) DO carry the transcript inside `call`; only
the live `transcript_updated` puts it at top level.

Both live callers build `call = payload.call ?? payload` and pass `call` to the
transcript extractor, which reads ONLY from `call` — so live rows silently store
`transcript_len:0` ("Waiting for Retell transcript_updated event…") even while the
events themselves flow correctly through Retell → n8n → prod ingest. The rule:
before extracting a live transcript, merge the top-level
`transcript_with_tool_calls`/`transcript_object`/`transcript` onto `call` (only when
`call` lacks them, so post-call events are unaffected). This applies to BOTH the
external ingest path AND the managed-agent webhook path (both had the identical
latent bug). `transcript_with_tool_calls` mixes roles
(agent/user/node_transition/tool_call_*); the extractor keeps only agent/user with
string content.

**Diagnosis trap:** a synthetic test that nests the transcript INSIDE `call` will
pass while real calls fail — always replay a REAL n8n payload (top-level array). The
resurrection guard also silently drops a replayed `transcript_updated` for an
already-ended call_id, so test with a FRESH call_id + `call_status:"ongoing"`.
**Prod requires a REPUBLISH** (ingest baked into the Autoscale build).

## Managed (WEBEE-builder) agents already get live transcript — no WBAH-style wiring

For agents created/deployed THROUGH the WEBEE builder (managed path, distinct from
the external n8n ingest above) the whole chain is already coded and needs no new work:
- **Deploy** (`retell.functions.ts`): both `deployAgentToRetell` and the Go-Live clone
  `goLiveAgent` set `webhook_url = {PUBLIC_BASE_URL}/api/public/voice-webhook` (only
  `if (!agent.webhook_url)`; `agent` = `{...data.agent}`, and builder agents arrive with
  no webhook_url so it's always injected) AND union `transcript_updated` into
  `webhook_events`. Neither `webhook_url` nor `webhook_events` is in `READONLY_KEYS`, so
  they survive update-mode too. `PUBLIC_BASE_URL` must be set in PROD (dev uses
  `REPLIT_DEV_DOMAIN`); a live prod agent pointing at `webeebuilder.com/.../voice-webhook`
  confirms prod has it.
- **Processor** (`retell-webhook.processor.ts`): `transcript_updated` branch maps agent→
  workspace via `resolveAgent` then `upsertLiveCallSession` — fixed by the same
  top-level `mergeWebhookTranscript` merge as the ingest path.
- **Read/display** is workspace-AGNOSTIC: `live-calls-sse.ts` adds `live_call_sessions`
  rows to cards WITHOUT the platform-key fail-closed filter (comment: "already
  workspace-scoped… makes the transcript appear instantly"). No WBAH hardcoding.

**Operational caveat:** an agent deployed BEFORE the 2026-07-03 `transcript_updated`
subscription code has `webhook_events:null` (= Retell default started/ended/analyzed,
no transcript) and needs a one-time re-deploy from the builder to enable; NEW agents
get it automatically. **Retell `get-agent`/`list-agents` returns `webhook_events:null`
whenever it's unset** (default set) — null does NOT prove the field is broken, only that
it was never explicitly set; verify by checking an agent known to have it (e.g. WBAH's
agent_50598 returns the explicit array).
