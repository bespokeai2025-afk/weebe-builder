---
name: WBAH "not showing latest calls" — dialing stopped vs sync bug
description: Before treating a stale WBAH Calls page as a sync/display bug, confirm calls were actually placed after the cutoff — check BOTH wbah_calls AND WBAH's own Retell API newest timestamp; they track the same calls.
---

# "Calls not showing the latest" can mean the dialer stopped, not a bug

When the WBAH Calls page (`/calls`, workspace `webuyanyhouse`) appears frozen at
an old date, do NOT assume the WeeBespoke→`wbah_calls` sync is broken. First prove
whether newer calls exist **at the source of truth (Retell)**.

**Why:** `wbah_calls` (mirrored from WeeBespoke `get-user-history`) and WBAH's OWN
Retell account hold the SAME underlying calls. If BOTH agree on the same newest
timestamp, no data is missing — the outbound campaign simply stopped placing
calls. A "fix" that pulls from Retell will surface 0 rows because Retell is frozen
too. A 30-day aggregate (e.g. analytics "7398 calls/30d") is NOT proof of recent
activity; that window can end at the cutoff.

**How to apply — checks that distinguish the two causes:**
- Retell newest, no filter: `POST /v2/list-calls {limit:5, sort_order:"descending"}`
  with WBAH's key (`workspace_settings.retell_workspace_id`). If newest ≈ the
  `wbah_calls` max, calling stopped.
- Retell time filter works in **milliseconds**: `filter_criteria.start_timestamp.lower_threshold`.
  `lower_threshold: <ms>+1` returns only strictly-newer calls (0 ⇒ nothing new).
- Corroborate with `wbah_calls` per-day counts and the main `calls` /
  `live_call_sessions` tables. A declining ramp then 0 (e.g. 739→512→147→0 over
  Jul 2–5) = campaign wound down / paused / ran out of leads, an OPERATIONAL issue.

**If (and only if) Retell is genuinely AHEAD of the stalled mirror** (the true
"sync lag" recurrence — e.g. WeeBespoke single-session token churn stalls our
sync while Retell keeps dialing), the correct fix is to merge Retell calls
STRICTLY newer than `wbah_calls`' max into `listWbahCallsLive` (disjoint time
window ⇒ no double-count, satisfying the analytics double-count invariant). Only
build that when Retell actually has newer rows; otherwise it's a no-op adding
per-open Retell overhead.
