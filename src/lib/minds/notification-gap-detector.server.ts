/**
 * Shared notification-gap detector.
 *
 * This is intentionally read-only. HiveMind chat and the scheduled
 * recommendation sweep both call this function so they cannot drift into
 * reporting different notification gaps.
 */
import {
  getWorkspaceNotificationCapabilities,
  applicableEventKeys,
} from "../notifications/notification-capabilities.server";
import {
  defaultSettingsForEvent,
  NOTIFICATION_EVENT_DEFS,
} from "../notifications/notification-engine.shared";

type Sb = any;

export interface NotificationGapFinding {
  kind: string;
  severity: "info" | "warning";
  event_key: string | null;
  summary: string;
  evidence: Record<string, unknown>;
}


export interface NotificationGapDetectionResult {
  findings: NotificationGapFinding[];
  checked_at: string;
  lookback_days: number;
  /** False when a source query failed; callers must not resolve old findings. */
  complete: boolean;
}

async function loadNotificationOverview(sb: Sb, workspaceId: string) {
  const caps = await getWorkspaceNotificationCapabilities(workspaceId);
  const applicable = applicableEventKeys(caps);
  const { data: rows, error } = await sb
    .from("workspace_notification_settings")
    .select("event_key, enabled, email_enabled, in_app_enabled, frequency, lead_filter, recipients")
    .eq("workspace_id", workspaceId);
  if (error) throw new Error(`Failed to read notification settings: ${error.message}`);
  return { caps, applicable, rows: (rows ?? []) as any[] };
}

/**
 * Find notification gaps for one workspace.
 *
 * `sb` is supplied by the caller so the same read-only checks can be used by
 * the registry tool and by the service-role background sweep.
 */
export async function detectNotificationGapsForWorkspace(
  sb: Sb,
  workspaceId: string,
  input?: { lookback_days?: number; now?: Date },
): Promise<NotificationGapDetectionResult> {
  const { caps, applicable, rows } = await loadNotificationOverview(sb, workspaceId);
  const days = input?.lookback_days ?? 14;
  const now = input?.now ?? new Date();
  const sinceIso = new Date(now.getTime() - days * 86_400_000).toISOString();
  const rowMap = new Map(rows.map((r) => [r.event_key, r]));
  const applicableSet = new Set(applicable);
  let complete = true;

  const effective = (key: string) => {
    const saved = rowMap.get(key);
    const d = defaultSettingsForEvent(key);
    const enabled = saved ? saved.enabled !== false : d.enabled;
    const inApp = saved ? saved.in_app_enabled !== false : d.inAppEnabled;
    const email = saved ? saved.email_enabled !== false : d.emailEnabled;
    return { enabled, deliverable: enabled && (inApp || email) };
  };

  const findings: NotificationGapFinding[] = [];

  // 1. Qualified leads arriving while their notification can't deliver.
  if (applicableSet.has("qualified_leads_generated")) {
    const eff = effective("qualified_leads_generated");
    if (!eff.deliverable) {
      const { count, error } = await sb
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .eq("status", "qualified")
        .gte("updated_at", sinceIso);
      if (error) complete = false;
      if (!error && (count ?? 0) > 0) {
        findings.push({
          kind: "qualified_leads_notifications_off",
          severity: "warning",
          event_key: "qualified_leads_generated",
          summary: `${count} lead(s) reached qualified in the last ${days} days but the qualified-leads notification is ${eff.enabled ? "enabled with no delivery channel" : "disabled"}.`,
          evidence: { qualified_leads: count, lookback_days: days },
        });
      }
    }
  }

  // 2. Bookings happening while booking notifications are off.
  if (applicableSet.has("appointments_booked")) {
    const eff = effective("appointments_booked");
    if (!eff.deliverable) {
      const { count, error } = await sb
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .eq("meeting_requested", true)
        .gte("updated_at", sinceIso);
      if (error) complete = false;
      if (!error && (count ?? 0) > 0) {
        findings.push({
          kind: "bookings_notifications_off",
          severity: "warning",
          event_key: "appointments_booked",
          summary: `${count} booked lead(s) in the last ${days} days while booking notifications cannot deliver.`,
          evidence: { booked_leads: count, lookback_days: days },
        });
      }
    }
  }

  // 3. Unread WhatsApp/BuzzChat replies while WhatsApp notifications are off.
  if (caps.whatsapp === true) {
    const waKeys = applicable.filter(
      (key: string) =>
        NOTIFICATION_EVENT_DEFS[key as keyof typeof NOTIFICATION_EVENT_DEFS]?.capability ===
        "whatsapp",
    );
    const anyDeliverable = waKeys.some((key: string) => effective(key).deliverable);
    if (waKeys.length > 0 && !anyDeliverable) {
      const { count, error } = await sb
        .from("whatsapp_conversations")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .gt("unread_count", 0)
        .gte("last_inbound_at", sinceIso);
      if (error) complete = false;
      if (!error && (count ?? 0) > 0) {
        findings.push({
          kind: "buzzchat_replies_unnoticed",
          severity: "warning",
          event_key: waKeys[0] ?? null,
          summary: `${count} WhatsApp/BuzzChat thread(s) have unread replies from the last ${days} days but no WhatsApp notification can deliver.`,
          evidence: { unread_threads: count, lookback_days: days },
        });
      }
    }
  }

  // 4. Assigned leads while assignment notifications cannot reach agents.
  if (applicableSet.has("lead_assigned")) {
    const eff = effective("lead_assigned");
    if (!eff.deliverable) {
      const { count, error } = await sb
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .not("assigned_to", "is", null)
        .gte("assigned_at", sinceIso);
      if (error) complete = false;
      if (!error && (count ?? 0) > 0) {
        findings.push({
          kind: "assignments_not_notifying_agents",
          severity: "warning",
          event_key: "lead_assigned",
          summary: `${count} lead(s) assigned in the last ${days} days while assignment notifications cannot deliver to agents.`,
          evidence: { assigned_leads: count, lookback_days: days },
        });
      }
    }
  }

  return {
    findings,
    checked_at: now.toISOString(),
    lookback_days: days,
    complete,
  };
}