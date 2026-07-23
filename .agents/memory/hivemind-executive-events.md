---
name: HiveMind executive event backbone
description: Per-workspace executive event stream + deterministic classifier + CAS reconciliation sweeps (Executive OS Stage 1)
---

# HiveMind executive event backbone (Stage 1)

- `hivemind_executive_events` (unique `(workspace_id, dedup_key)`, RLS members-SELECT, writes REVOKEd — server/service-role only) + `hivemind_reconciliation_state` (unique `(workspace_id, job_key)`).
- **Publish rule:** `publishExecutiveEvent(sb, {...})` in `executive-events.shared.ts` is sb-injected, NEVER throws, dedups via upsert `ignoreDuplicates`. Any new business-event source should publish here best-effort (wrap in try/catch anyway at call sites).
- **Mirror runs before notification prefs:** the notification-engine mirror publishes to the stream BEFORE user preference checks — the stream is complete regardless of notification settings. Keep that ordering.
- **Classification is deterministic** (catalog + severity upgrade: severity critical → classification critical always). AI analysis is a later stage; don't add AI calls to the classifier.
- **Reconciliation reads LOCAL tables only**, never external APIs. Jobs claimed per (workspace, job) via CAS on `last_run_at` (insert w/ ignoreDuplicates then conditional update) — multi-instance safe.
- **Why:** observe-only Stage 1 of the Executive OS; later stages (tasks #394–#397) build AI reasoning + approval-gated execution on this stream.
- **Schema traps hit:** `calendar_bookings` uses `start_at` (not start_time) and statuses `pending|accepted|...` (no "confirmed"); `workspaces` inserts need `slug`. e2e fixtures need real workspace rows (FK) — see `tests/e2e/executive-events.e2e.test.ts` pattern; `RECON_JOBS_FOR_TEST` export lets tests run jobs against the real schema.
- Retention: 180d rule in log-retention; migration applied via `scripts/apply-executive-events-migration.mjs` (wired into post-merge.sh).
