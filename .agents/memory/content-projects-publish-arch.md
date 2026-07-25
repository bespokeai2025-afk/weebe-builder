---
name: Content Studio projects + Meta publishing
description: GrowthMind adaptation→project handoff, approval state machine, HiveMind routing, idempotent Meta publish jobs
---

# Content Studio handoff, approval & Meta publishing

- One `growthmind_content_projects` row per recommendation. `createProjectFromRecommendation` MUST check for an existing project FIRST and return it regardless of recommendation status (UI shows "Open project" for later statuses); status/compliance gates apply only to fresh creation.
- Approval rules (`content-approval.shared.ts`) can force a `growthmind_publish_content` HiveMind action to `sensitive=true` per-row. `approveHiveMindAction` must honor persisted `sensitive`/`sensitive_category` from the row and never downgrade to the static action-type classification — otherwise rule-forced approvals bypass entitlement checks.
- `approveContentProjectPublish` must run `validatePublishPreconditions` BEFORE transitioning to `approved`, or a validation failure strands the project in `approved` with no job.
- Publish job idempotency = SHA-256 over (workspace, project, connection, targetType, mediaUrl, caption); live job with same key wins; 23505 race → reuse. Tick registered in BOTH campaign-scheduler.plugin.ts (ssrLoadModule for @/ aliases) and prod campaign-executor route.
- IG publish: container create → poll → publish, resumable via `ig_creation_id` in job payload. FB: feed/photos/videos. Retry backoff 5min·2^n.
- New sensitive operator category "publishing" in action-safety.shared.ts; submit-time forced category is `client_communication`.

**Why:** the three rules above were architect-flagged critical defects (broken open-existing handoff, approval sensitivity bypass, stranded approved state) — keep them when extending.
**How to apply:** any new handoff-to-project flow, HiveMind-routed approval, or publish-job kind should follow these patterns.

## Verification lessons (mocked e2e vs live)
- Full pipeline is verifiable without a live Meta account: `tests/e2e/meta-content-publish.e2e.test.ts` mocks ONLY graph.facebook.com at global fetch (pass everything else through — supabase-js uses fetch too) and runs the real approve→job→execute→retry code against the real DB in a throw-away workspace.
- Connection account_type is `instagram_professional` (schema CHECK + OAuth callback); any code checking `instagram_business` silently never matches — that exact bug hid the IG publish-permission validation.
- Duplicate prevention (same media+caption published in last 7 days) fires BEFORE idempotency-key reuse: re-approving already-published identical content throws by design; idempotency reuse only applies while a job is still live (scheduled/publishing).
- The reel container-processing test sleeps 60s (12 polls × 5s) — run that test name separately; the bash 120s cap kills a full-suite run.
