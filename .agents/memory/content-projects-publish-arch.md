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
