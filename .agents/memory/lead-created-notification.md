---
name: lead_created notification event
description: How new-lead email/in-app notifications work and the traps hit while building them
---

# lead_created notification event

- New leads emit a `lead_created` notification via `notifyNewLead()` (src/lib/lead-gen/lead-notify.server.ts), which wraps `emitCampaignNotification`. Best-effort, never throws, WBAH-excluded.
- **Rule:** any NEW lead-insert path must call `notifyNewLead` on its create branch only (never update/dedupe branches), or document the exclusion (bulk syncs are excluded on purpose).
- **Why:** user wants an email for every new lead; bulk syncs would spam thousands of emails.
- Defaults have email OFF — a workspace only gets emails if a `workspace_notification_settings` row for `lead_created` has `email_enabled=true` (admin's Workspace seeded with immediate email on).
- **Trap:** the service-role client lives at `@/integrations/supabase/client.server` (NOT `admin.server`). A wrong dynamic-import path inside a best-effort try/catch fails completely silently — no log, no notification. If a best-effort hook "does nothing", verify its import paths first.
- Adding a notification event key needs BOTH the shared catalog (`NOTIFICATION_EVENT_KEYS` + labels) AND widening the `workspace_notification_settings_event_key_check` DB constraint.
