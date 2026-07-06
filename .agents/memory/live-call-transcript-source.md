---
name: Live in-call transcript source (Retell managed agents)
description: The only way to stream a Retell managed-agent transcript DURING a call, how it's wired, and the traps.
---

# Live in-call transcript for the dashboard Live Calls panel

**Rule:** For Retell MANAGED agents there is exactly ONE source of an in-progress
transcript: the `transcript_updated` webhook event. REST `/v2/get-call` (and
`/v2/list-calls`) do NOT return a transcript mid-call — it is gated until the
call ends/analyzes. So REST can only DETECT ongoing calls + metadata; the live
transcript must come from the webhook.

**Why:** We are not Retell's LLM backend, so the LLM WebSocket is unavailable.
The previous dashboard only showed the transcript post-call because it relied on
REST/`calls` table, both empty during the call.

**How to apply:**
- `transcript_updated` is NOT in Retell's default `webhook_events` (default =
  `call_started,call_ended,call_analyzed`). It must be explicitly added on
  create/clone (union, never replace, so post-call events keep firing) and
  backfilled on already-deployed agents. It fires MANY times/call carrying the
  FULL cumulative transcript (so length is monotonic within a call).
- Store one snapshot row per call in `live_call_sessions`
  (UNIQUE `workspace_id,retell_call_id`). Display-only/transient — keep it OUT
  of `SUPPORTED_RETELL_EVENTS` and the `calls` table so analytics/leads/CRM are
  never touched. Handle the branch BEFORE `recordWebhookEvent` so it doesn't
  bloat the webhook event log; wrap all writes in try/catch.
- **Unordered webhooks:** a `transcript_updated` can arrive AFTER `call_ended`.
  The upsert MUST refuse to resurrect an ended/failed row (guard on existing
  `call_status`), or you get a ghost "LIVE" card for up to the stale-cleanup
  window and the real completed card gets suppressed.
- Exclude `call_type === web_call` — those are builder preview tests, same as
  the calls-table path ignores them.
- SSE reads `live_call_sessions` every tick (cheap, workspace-scoped) and
  throttles Retell REST to ~5s. Merge: prefer session transcript, append
  sessions REST hasn't surfaced yet (`live_transcript=true`), keep the
  fail-closed platform-key agent filter on the REST path.

**Security:** the public webhook route is only protected when
`RETELL_SIGNATURE_VERIFICATION_ENABLED=true`. It defaults to DISABLED
(`… !== "true"`). If unset in prod, anyone can POST fake transcripts into
`live_call_sessions`. Ensure the env var is set in production secrets.

**Routing blocker (why live transcript can silently do nothing):** Retell
agent-level `webhook_url` OVERRIDES the account-level webhook — if it is set,
the account webhook is NOT triggered for that agent. Many WBAH/production Retell
agents (e.g. "WBAH Client qualification agent outbound") have their `webhook_url`
pointed at an EXTERNAL n8n endpoint (`bespoke.app.n8n.cloud/webhook/...`), so
Retell delivers ALL their events — including `transcript_updated` — to n8n and
NEVER to WEBEE. Result: 0 rows in `live_call_sessions`, panel shows the fallback,
and no code change on our side can fix it. Verify the exact agent's live config
with `GET https://api.retellai.com/get-agent/<id>` (Bearer RETELL_API_KEY) before
assuming the feature is broken. Fixes require a routing decision: repoint the
agent to WEBEE and forward to n8n, or have n8n forward to WEBEE — both touch
production lead routing, so get user consent.
The webhook "signing key" is NOT a separate secret — `verifyRetellSignature`
uses the Retell API key itself (platform `RETELL_API_KEY`, falling back to the
per-workspace key). So the flag is safe to flip on whenever `RETELL_API_KEY`
exists. It's currently set in the `shared` env (covers dev + prod).

**Applied state (as of this project):** the migration
(`20260724000000_live_call_sessions.sql`) is already applied to Supabase and all
WEBEE-DEPLOYED agents are subscribed to `transcript_updated` — `SUPABASE_ACCESS_TOKEN`
is NOT present, so DDL can't be re-run via the Management API; the table + unique
constraint were verified via a service-role `onConflict` upsert instead.

**CONFIRMED root cause for WBAH "live card shows, transcript empty":** the WBAH
outbound agents are EXTERNAL (not WEBEE-deployed), so they were NEVER subscribed
to `transcript_updated`. `GET /get-agent` on BOTH
(`agent_0440…` on platform `RETELL_API_KEY`, `agent_50598…` on the WBAH workspace
key) returns NO `webhook_events` field at all → Retell applies its defaults
(`call_started,call_ended,call_analyzed`), which exclude `transcript_updated`.
So Retell never emits an in-progress transcript to n8n, `live_call_sessions`
stays empty (verified 0 rows), and the live card comes only from the REST
`list-calls` ongoing detection (which has no mid-call transcript). Both agents'
`webhook_url` = the same n8n webhook. **The ONLY fix is to add `transcript_updated`
to the dialling agent's `webhook_events` (UNION, never replace) — but that floods
the WBAH n8n workflow with many events/call, so FIRST confirm that workflow
branches on event type (only acts on call_ended/analyzed) or you risk duplicate
CRM/callback runs. Needs user confirmation before touching the agent.** n8n public
API (`/api/v1`) currently 404s ("No workspace here"); the webhook subsystem is
separate and unaffected by that.
