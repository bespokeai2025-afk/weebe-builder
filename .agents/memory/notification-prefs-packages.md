---
name: Notification preferences & package caps
description: Event catalog expansion, package-based notification caps/defaults, and the DB check-constraint trap on event keys.
---

# Notification preferences expansion & package defaults

- **Event catalog lives in two places**: `NOTIFICATION_EVENT_KEYS` in `notification-engine.shared.ts` AND a Postgres CHECK constraint on `workspace_notification_settings.event_key`. Adding a new event key REQUIRES a migration widening the constraint or seeding/settings writes silently fail (upsert error caught + warned only). Constraint name: `workspace_notification_settings_event_key_check`. `workspace_notifications` (the log table) has NO such check.
- **Why:** e2e seeding wrote 0 rows with no visible error until the raw upsert was tested with `.select()`.
- **Package caps** are fail-closed: `notificationCapsForPackage()` (packages.shared) + `loadNotificationCaps()` (engine, reads workspace_subscriptions). Unknown/missing package = no email, no custom recipients. Enforced in three layers: write-time (updateNotificationSetting throws), send-time (emit clamps via `clampSettingsToCaps`), and UI (locked switches). Note package key aliases exist ("pro" → "receptionist_pro") — caps map uses canonical keys only.
- **Defaults seeding** (`seedNotificationDefaults` in entitlements.server.ts) runs on every `provisionWorkspacePackage` and is insert-only (`ignoreDuplicates: true`) so admin-customised rows are never overwritten.
- **Emit points pattern:** all best-effort try/catch dynamic imports of `emitCampaignNotification`; qualified-lead + appointment emits guard with `isWbahWorkspaceId`. Email provider failure alert uses event key `email_provider_failing` (renamed from generic needs_admin_attention).
- **How to apply:** any new notification event = shared catalog + labels/severities + DB constraint migration (Mgmt API apply) + optionally package defaults.
