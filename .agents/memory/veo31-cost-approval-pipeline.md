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
- **Blocker (re-verified 2026-07-29 via live submit attempt):** Veo `:predictLongRunning` submit returns 403 "Your project has been denied access. Please contact support." (last successful render 2026-06-16). Note: GET model metadata returns 200 — it is NOT a valid access probe; only a real submit reveals the denial. The user must contact Google support / fix billing-allowlist on the GEMINI_API_KEY project. Live-spend e2e tests are env-gated (`VEO_LIVE=1`, phased runner `tests/e2e/veo31-live-phase.e2e.test.ts`); a failed submit leaves fixture ws rows behind — clean up `workspaces.name LIKE 'veo31 live %'` and their jobs/members/ledger rows.
