/**
 * Auto-provisioning of workspace notification settings rows.
 *
 * INVARIANTS:
 *   • INSERT-ONLY — rows an admin already customised are NEVER touched
 *     (ignoreDuplicates upsert on (workspace_id, event_key)).
 *   • Idempotent — safe to call from any hook, any number of times.
 *   • Never throws — provisioning is best-effort everywhere it is hooked
 *     (package assignment, settings page open, sweeps).
 *   • Only APPLICABLE events (per workspace capabilities) get rows.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  defaultSettingsForEvent,
} from "./notification-engine.shared";
import {
  getWorkspaceNotificationCapabilities,
  applicableEventKeys,
} from "./notification-capabilities.server";

const sb = supabaseAdmin as any;

/**
 * Materialize catalogue-default settings rows for every applicable event that
 * has no row yet. Returns the event keys newly provisioned (empty on no-op).
 * Audits when anything was inserted.
 */
export async function provisionWorkspaceNotifications(
  workspaceId: string,
  reason: string,
): Promise<string[]> {
  try {
    const caps = await getWorkspaceNotificationCapabilities(workspaceId);
    const events = applicableEventKeys(caps);
    if (events.length === 0) return [];
    const now = new Date().toISOString();
    const rows = events.map((eventKey) => {
      const d = defaultSettingsForEvent(eventKey);
      return {
        workspace_id: workspaceId,
        event_key: eventKey,
        enabled: d.enabled,
        email_enabled: d.emailEnabled,
        in_app_enabled: d.inAppEnabled,
        recipients: d.recipients,
        frequency: d.frequency,
        updated_at: now,
      };
    });
    const { data: inserted, error } = await sb
      .from("workspace_notification_settings")
      .upsert(rows, { onConflict: "workspace_id,event_key", ignoreDuplicates: true })
      .select("event_key");
    if (error) {
      console.warn("[notify-provision] insert failed (non-fatal):", error.message);
      return [];
    }
    const keys = (inserted ?? []).map((r: any) => r.event_key as string);
    if (keys.length > 0) {
      try {
        const { writeAccessAudit } = await import("@/lib/permissions/permissions.server");
        await writeAccessAudit({
          workspaceId,
          actingUserId: null,
          objectType: "notification_setting",
          objectId: "auto_provision",
          actionType: "notification_provisioned",
          afterState: { reason, eventKeys: keys },
          riskLevel: "low",
        });
      } catch {
        /* best-effort audit */
      }
    }
    return keys;
  } catch (err: any) {
    console.warn("[notify-provision] failed (non-fatal):", err?.message ?? err);
    return [];
  }
}
