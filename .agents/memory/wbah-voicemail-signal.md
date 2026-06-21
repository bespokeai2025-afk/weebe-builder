---
name: WBAH voicemail signal
description: How a "voicemail result" is identified for WBAH calls, and how the Calls page filters them.
---

WBAH calls (`wbah_calls` table) have **no `is_voicemail` boolean** — that column only
exists on the native `calls` table, where `listCalls` filters voicemails server-side
via `.eq("is_voicemail", false)`.

For WBAH, a voicemail "result of call" is encoded in `disconnection_reason` /
`end_reason` as `"voicemail_reached"` (verified against live data: ~40% of rows;
`call_status` only ever holds completed / no_answer / ongoing — never "voicemail").

**Decision / how to apply:** Any "remove voicemail calls" requirement on the WBAH
Calls page is done **client-side** by testing `/voicemail/i` against
`disconnection_reason`/`end_reason`. Apply it at the `rows` level (before the KPI
counts and the table derive from it) so the cards and list stay consistent — mirroring
the native path where the server already excluded voicemails before the data arrives.
The 3-state pill (exclude=default / all / only) is shared by both paths.

**Why:** native vs WBAH use different data sources with different voicemail signals;
treating them the same (looking for `is_voicemail` or `call_status==="voicemail"` on
WBAH) silently matches nothing.
