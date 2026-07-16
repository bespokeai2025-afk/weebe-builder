---
name: Campaign notifications + Team Access RBAC
description: Notification engine defaults/digests, 8-role fail-closed permission model, and where guards must be re-applied.
---
- Notification engine (`notification-engine.shared.ts`) is sb-injected so it runs from server fns AND the public campaign-executor endpoint. Defaults when no settings row: enabled, in-app on, email OFF, immediate. Digests write `delivery_status='digest_queued'` rows; the executor tick batches them per (workspace,user,frequency) via Resend.
- Report-writer is the single lifecycle hook: report types map to notification events; `cancelled`→paused, `safety_blocked`→daily_cap_hit only when skipped_by_cap>=matched, run_summary/retried→none.
- **Why fail-closed matters:** `resolvePermissions` returns NO_ACCESS (role `suspended`) on any lookup error, null ids, or non-membership; guards (`requireAction`/`requirePageAccess`) throw PermissionDeniedError. Never "default allow" on a query error.
- **How to apply:** any NEW high-risk server fn (campaign activation/resume, go-live, SystemMind approvals, exports, user management) must call `requireAction` from `permissions.server.ts`; UI gating alone is not enforcement.
- Role source of truth is `workspace_member_roles.role_key` (8 roles) synced back to the legacy workspace_members enum for compatibility; custom per-workspace roles require a workspace_role_permissions override row before assignment.
- Owner is immutable (can't edit/remove/demote; always in approval-roles list); users can't change their own role. All permission mutations audit to workspace_access_audit_logs (best-effort, non-blocking).
- **Owner role_key is never assignable** (role assignment, invites) AND the resolver ignores a role_key of "owner" unless the legacy workspace_members.role is actually owner — both layers required or a rogue role row grants owner-equivalent perms.
- assigned_records_only roles get `.eq(assigned_to, userId)` filters at query level (see listLeads) — replicate for other record lists if extended.
- e2e sanity: `npx tsx scripts/test-notifications-rbac.mjs` (service-role, self-cleaning).
