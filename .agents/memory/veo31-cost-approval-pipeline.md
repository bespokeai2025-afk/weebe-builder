---
name: Veo 3.1 cost-approval video pipeline
description: GrowthMind paid video render pipeline — approval consume semantics, ledger CAS rule, and the current Google-side Veo 403 blocker.
---

# Veo 3.1 cost-approval video pipeline

- Paid renders (Veo 3.1 premium $0.75/s, fast $0.15/s via Gemini v1beta `:predictLongRunning`) go through `growthmind_video_jobs`: plan (free) → awaiting_approval → atomic approval consume (CAS on `status=awaiting_approval AND approval_consumed_at IS NULL`) → rendering → ready/failed.
- **Rule:** paid work is NEVER auto-retried; retry creates a NEW job needing a NEW approval. Submit failure ledgers $0 and the approval stays consumed.
- **Ledger CAS rule:** every terminal transition (ready/failed/timeout) must win a CAS update (`.in("status",["rendering","archiving"]).select()`) before writing `ai_usage_ledger`, or concurrent background poll + on-demand poll double-ledger the same render.
- **Why:** ledger rows drive AccountsMind cost reporting; duplicates distort real spend.
- User-supplied reference-image URLs are fetched server-side → SSRF guard mandatory (`assertSafePublicUrl` from gads-deep-analysis.server).
- **Blocker (as of 2026-07-29):** the Google project behind GEMINI_API_KEY returns 403 PERMISSION_DENIED for ALL Veo models (last successful render 2026-06-16). Live-spend e2e tests are env-gated (`VEO_LIVE=1`, phased runner `tests/e2e/veo31-live-phase.e2e.test.ts`); re-run once the user restores Veo access.
