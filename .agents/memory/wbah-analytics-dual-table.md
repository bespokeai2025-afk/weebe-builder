---
name: WBAH analytics dual-table pattern
description: getOverviewStats and getRetellAnalytics both require a wbah_calls branch; the standard calls table has zero WBAH rows.
---

## The rule

Any dashboard/analytics function that queries the `calls` table for call KPIs **must** also have a WBAH branch that queries `wbah_calls` instead.

**Why:** WBAH (webuyanyhouse) call data is synced from the WeeBespoke API into `wbah_calls`, not the standard `calls` table. The `calls` table has 0 rows for this workspace. Querying only `calls` returns 0 for every call KPI.

**How to apply:** Detect isWbah by checking `workspaces.slug = 'webuyanyhouse'` before the main query block, then branch all call-related queries.

## getOverviewStats fix (leads.functions.ts)

- `callsTotalRes` → `wbah_calls` count (no is_voicemail filter — wbah_calls has no such field)
- `callsCompletedRes` → `wbah_calls` where `call_status = 'completed'`
- `callsFailedRes` → `wbah_calls` where `call_status IN ('failed','no_answer','busy')`
- `completedCallsRes` → `wbah_calls` phone field (not `to_number` — wbah_calls uses `phone`)
- `callsRes` (row fetch for duration) → `Promise.resolve([])` for WBAH; duration fetched separately paginated
- `voicemailsRes` → `Promise.resolve({ count: 0 })` for WBAH
- `totalCallSeconds` → separate paginated fetch of `duration_seconds` from `wbah_calls`

## getRetellAnalytics fix (analytics.functions.ts)

Normalized wbah_calls shape for computeAnalytics:
- `direction`: from `call_type` field ("inbound"/"outbound")
- `start_timestamp`: `new Date(started_at).getTime()` (milliseconds)
- `duration_ms`: `duration_seconds * 1000`
- `call_analysis.user_sentiment`: Title-case of `sentiment` ("positive"→"Positive")
- `call_analysis.call_successful`: `call_status === "completed" ? true : false`
- `call_analysis.in_voicemail`: always `false` (no voicemail concept in wbah_calls)
- `agent_id`: use `agent_name` as the key (no real agent_id in wbah_calls)
- `_provider`: `"WBAH"` sentinel

`configured` flag set to `true` when `wbahCalls.length > 0` so analytics page renders for WBAH.

## wbah_calls call_status values

Normalised by sync code (`normaliseWbahCall`):
- `"completed"` — raw: "ended", "call_analyzed", "completed"
- `"no_answer"` — raw: "not_connected", "voicemail", "no_answer", "missed"
- `"failed"` — raw: "failed"
- fallback: raw value or "completed"
