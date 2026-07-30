---
name: Retell v3/list-calls omits transcripts
description: v3 list responses have no transcript fields; transcripts must be fetched per-call via GET /v2/get-call
---

Retell's July 2026 list-API migration (POST /v3/list-calls) **dropped `transcript` and
`transcript_object` from list responses** (call_analysis/call_cost/recording_url remain).
Transcripts are only available per-call via `GET /v2/get-call/{call_id}`.

**Why:** the WBAH calls sync stored null transcripts for EVERY call from 2026-07-24 (migration day)
onward, and re-upserts clobbered previously stored transcripts — a total post-call-transcript
blackout that looked like a webhook/n8n problem but was purely the list-API shape change.

**How to apply:**
- Any sync that lists Retell calls and wants transcripts must add a per-call get-call enrichment
  pass (bounded, concurrency ~4, 429/5xx retry) — see `enrichMissingTranscripts` in
  `wbah-retell-calls-sync.ts`.
- Upserts sourced from list responses must PRESERVE the existing `transcript` when the incoming
  value is null/empty (it's in the sync's preserve list alongside booking fields).
- Baseline: ~30–35% of WBAH calls genuinely have no transcript at Retell (unanswered/voicemail);
  100% missing on recent days = ingestion bug, ~30% missing = normal.
