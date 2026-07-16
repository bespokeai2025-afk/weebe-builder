---
name: Master Admin oversight & package matrix persistence
description: package_definitions DB rows override code PACKAGE_CATALOG; admin oversight pages; migration report rules
---

# Rule
`package_definitions` DB rows override the code `PACKAGE_CATALOG` at runtime. All server-side
package resolution must go through `packages-catalog.server.ts` (`packageByKeyServer`,
`getEffectivePackageCatalog`, `notificationCaps/DefaultsForPackageServer`) — never call
`packageByKey()` directly in server code for entitlement decisions.

**Why:** Master Admin edits packages in the DB without deploys; code-only lookups would silently
ignore admin changes. Overlay semantics: scalars replace when non-null, JSON maps replace whole
when non-empty; unknown keys fail closed to trial; ~30s cache — call
`invalidatePackageCatalogCache()` + `invalidateEntitlementsCache()` after any package_definitions
write.

**How to apply:**
- `loadNotificationCaps` (shared) also reads `package_definitions.notification_caps_json` via the
  passed sb client (shared file can't import the server module).
- `workspace_access_audit_logs.workspace_id` is now NULLABLE — platform-level audits (package
  edits, migration runs) use NULL; per-workspace read policy won't show them (admin fns read via
  service role).
- Admin package CHANGE uses upsert WITHOUT ignoreDuplicates (provisioning uses
  ignoreDuplicates:true and never updates).
- Migration report apply is insert-only legacy_full for workspaces missing a subscription row;
  WBAH is skipped by rule; suspension action blocked for WBAH.
- Oversight fns live in `src/lib/admin/platform-oversight.functions.ts`
  (requireSupabaseAuth + requirePlatformAdmin); UI at /admin/packages and /admin/resellers.
- Limits use a -1 DB sentinel = UNLIMITED (blank in admin UI → -1); overlayLimit maps -1→null,
  NULL→code default. page_access_json/action_access_json overlay explicit caps; matrix returns
  effectivePageCaps/effectiveActionCaps (explicit-or-feature-derived) so the editor never
  defaults to blanket "full".
