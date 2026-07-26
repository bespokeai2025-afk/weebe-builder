---
name: HiveMind WBAH calls source
description: HiveMind WBAH call metrics must come from wbah_calls with London day window and explicit unavailable semantics
---

HiveMind's WBAH call metrics are sourced from `wbah_calls`, not the standard `calls` table (which has only legacy WBAH rows → silent "0 calls today" bug).

**Rules:**
- Europe/London day/month windows (BST/GMT aware) on `started_at`, matching the WBAH dashboard.
- Qualified = sentiment positive; voicemail = end_reason voicemail_reached; connected ≈ total − voicemail.
- `wbah_calls` has NO retell_call_id column — the provider call id IS the row id when it looks like `call_<hex>`; dedup on that.
- Failure semantics: any fetch error, sync staler than 6h, or page-cap hit (5×1000) returns an error status and the context renders "Current WBAH call activity is unavailable or delayed." with an instruction NOT to report a count. Never silent zeros.

**Why:** silent fallbacks to the near-empty `calls` table made the COO exec confidently wrong; the explicit-unavailable pattern is the standard for any future WBAH data block.

**How to apply:** any new HiveMind/executive metric for WBAH must read wbah_calls (or the appropriate WBAH-native source) inside the isWbah branch and reuse the shared/server module split in `src/lib/hivemind/wbah-call-metrics.*`.
