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
The webhook "signing key" is NOT a separate secret — `verifyRetellSignature`
uses the Retell API key itself (platform `RETELL_API_KEY`, falling back to the
per-workspace key). So the flag is safe to flip on whenever `RETELL_API_KEY`
exists. It's currently set in the `shared` env (covers dev + prod).

**Applied state (as of this project):** the migration
(`20260724000000_live_call_sessions.sql`) is already applied to Supabase and all
deployed agents are already subscribed to `transcript_updated` — `SUPABASE_ACCESS_TOKEN`
is NOT present, so DDL can't be re-run via the Management API; the table + unique
constraint were verified via a service-role `onConflict` upsert instead.
