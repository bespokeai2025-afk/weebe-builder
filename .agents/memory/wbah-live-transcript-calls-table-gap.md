---
name: WBAH live transcript — calls table gap
description: WBAH webhook processor routes early to wbah_calls and never writes to the `calls` table; fetchRecentCompletedCalls only reads `calls`, so completed WBAH transcripts vanished from the Live Calls panel the moment each call ended.
---

## Rule
The WBAH webhook pipeline returns early (`return wbahResult` at ~line 585 of retell-webhook.processor.ts), so no WBAH call ever lands in the `calls` table. The SSE endpoint's `fetchRecentCompletedCalls` reads only `calls` → zero completed cards for WBAH workspace.

## Fix applied
Added `fetchRecentEndedLiveSessions(workspaceId, 20min)` to `live-call-sessions.server.ts`. The SSE loop now runs it in parallel with `fetchRecentCompletedCalls` and merges the results (deduped by call_id, preferring `calls` table entries). This surfaces WBAH completed cards from the already-correct `live_call_sessions` snapshot table.

**Why:** WBAH agents are not in the WEBEE `agents` table and are handled by a completely separate post-call pipeline. The `calls` table write only happens in the shared non-WBAH path.

**How to apply:** Any new workspace that bypasses the shared webhook path will need the same treatment — check whether its completed calls appear in `calls`. If not, `live_call_sessions` is the fallback.
