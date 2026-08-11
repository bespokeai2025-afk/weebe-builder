---
name: Webhook side-effect dedup
description: How to fire once-only side effects (notifications) from at-least-once webhook deliveries
---
Rule: never gate a webhook side effect (notification, email) on a read-then-write pre-check — concurrent duplicate deliveries both pass the check and double-fire. Use an atomic insert-detect: supabase `.upsert(row, { onConflict, ignoreDuplicates: true }).select("id")` = INSERT ... ON CONFLICT DO NOTHING RETURNING; only the caller that gets a row back fires the side effect.

**Why:** WATI (and most providers) deliver webhooks at-least-once and sometimes in parallel; architect review caught a double-notify race in the WhatsApp-reply notification.

**How to apply:** any webhook handler that persists a row keyed by a provider id and wants a once-only side effect. Example: `whatsapp_reply_received` notification in the WATI inbound webhook route (`upsertWhatsappMessage` with `insertOnly`). New notification event keys still need BOTH the shared catalog and the `workspace_notification_settings_event_key_check` constraint migration (see notification-prefs-packages.md).
