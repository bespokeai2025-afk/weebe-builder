---
name: Mobile API v1 surface & personal notification mutes
description: v1 endpoint conventions (dual-auth, cores-only), personal per-user notification mute layer, and notification oversight Mind tools.
---

## v1 endpoint conventions
- Dual-auth routes use `authenticateMindApiRequest(request, permission, { requireUser? })` — JWT + X-Workspace-Id (membership fail-closed) or workspace API key. `requireUser: true` = JWT-only (person-scoped data: notifications, prefs, assignment).
- Routes NEVER inline business logic — they call plain async cores (`lead-assignment.server.ts`, `notifications.functions.ts` cores, filter engine). Permission enforcement (requireAction / resolvePermissions / assignedRecordsOnly) lives inside the cores so no caller can forget it.
- `GET /api/v1/leads` accepts `?filter=` (canonical saved-views FilterConfig, validated with `validateFilterConfig`; `assigned_to_me` disallowed for API-key callers) and date-only ranges resolved at workspace-timezone day boundaries (WBAH = Europe/London, DST-safe next-day−1ms).
- Assigned-records-only JWT callers are row-filtered with `.eq("assigned_to", userId)` applied LAST; permission resolution failure = refuse (fail closed).

## Personal notification mutes
- `workspace_user_notification_prefs` (PK ws+user, per-user RLS): member-level mutes of NON-critical events. Critical events are never mutable (rejected loudly, not dropped).
- Delivery: `emitCampaignNotification` filters member recipients via `getMutedUserIds` — FAIL OPEN, never affects custom-email recipients, workspace policy, or the executive mirror.
- **Why:** workspace settings are policy; individuals needed per-person opt-out without admins losing delivery guarantees.
- TRAP: `user-notification-prefs.server.ts` is reachable from the vite-config plugin chain (engine → campaign-scheduler.plugin). It must keep RELATIVE imports — an `@/` import there breaks `vite build` at config load (esbuild bundles even dynamic imports of the config chain).

## Oversight Mind tools
- hivemind.inspect_notification_config / detect_notification_gaps: read-only registry tools; findings advisory → proposal-only recommendations.
- systemmind.validate_notification_config (read) + provision_notification_definitions (write, `notification_settings` action key, re-checked in run-path): provisioning is insert-only (`ignoreDuplicates`) — never overwrites admin customization.
- Acceptance sweep script: `scripts/acceptance-578-sweep.test.ts` + `vitest.acceptance578.config.ts` (run manually against live DB; not in the component glob).
