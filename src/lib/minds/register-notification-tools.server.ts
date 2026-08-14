/**
 * Notification oversight Mind tools.
 *
 * HiveMind (read-only, registry surface):
 *   • hivemind.inspect_notification_config — capabilities + effective policy.
 *   • hivemind.detect_notification_gaps    — issues like qualified leads
 *     arriving with their notification off, bookings not notifying anyone,
 *     or unread BuzzChat replies while WhatsApp notifications are off.
 *     Findings are ADVISORY — HiveMind chat turns them into proposal-only
 *     recommendations; nothing here mutates configuration.
 *
 * SystemMind:
 *   • systemmind.validate_notification_config — read-only: applicable
 *     catalogue events missing a workspace definition + malformed rows.
 *   • systemmind.provision_notification_definitions — WRITE, but strictly
 *     insert-only (provisionWorkspaceNotifications upserts with
 *     ignoreDuplicates) so existing admin customization is never touched.
 *     Gated on the notification_settings action grant.
 */
import { z } from "zod";
import { registerMindTool, type MindToolContext, type MindToolRunResult } from "./tool-registry.server";

async function loadNotificationOverview(workspaceId: string) {
  const [{ getWorkspaceNotificationCapabilities, applicableEventKeys }, shared, { supabaseAdmin }] =
    await Promise.all([
      import("@/lib/notifications/notification-capabilities.server"),
      import("@/lib/notifications/notification-engine.shared"),
      import("@/integrations/supabase/client.server"),
    ]);
  const sb = supabaseAdmin as any;
  const caps = await getWorkspaceNotificationCapabilities(workspaceId);
  const applicable = applicableEventKeys(caps);
  const { data: rows, error } = await sb
    .from("workspace_notification_settings")
    .select("event_key, enabled, email_enabled, in_app_enabled, frequency, lead_filter, recipients")
    .eq("workspace_id", workspaceId);
  if (error) throw new Error(`Failed to read notification settings: ${error.message}`);
  return { caps, applicable, rows: (rows ?? []) as any[], shared: shared as any, sb };
}

registerMindTool({
  name: "hivemind.inspect_notification_config",
  mind: "hivemind",
  title: "Inspect notification configuration",
  description:
    "Read the workspace's notification capabilities and effective per-event policy (defaults merged with saved settings). Read-only.",
  access: "read",
  surface: "registry",
  sensitive: false,
  idempotent: true,
  estimatedCost: "low",
  platforms: ["web", "mobile", "api"],
  featureFamily: "analytics",
  capabilityState: "available",
  rollbackSupported: false,
  mobileAvailable: true,
  currentHealth: "healthy",
  inputSchema: z.object({}).optional(),
  run: async (ctx: MindToolContext): Promise<MindToolRunResult> => {
    const { caps, applicable, rows, shared } = await loadNotificationOverview(ctx.workspaceId);
    const rowMap = new Map(rows.map((r) => [r.event_key, r]));
    const events = applicable.map((key: string) => {
      const saved = rowMap.get(key);
      const defaults = shared.defaultSettingsForEvent(key);
      return {
        key,
        label: shared.NOTIFICATION_EVENT_LABELS[key] ?? key,
        severity: shared.severityForEvent(key),
        enabled: saved ? saved.enabled !== false : defaults.enabled,
        email_enabled: saved ? saved.email_enabled !== false : defaults.emailEnabled,
        in_app_enabled: saved ? saved.in_app_enabled !== false : defaults.inAppEnabled,
        frequency: saved?.frequency ?? defaults.frequency,
        has_lead_filter: saved?.lead_filter != null,
        source: saved ? "workspace" : "default",
      };
    });
    return { result: { capabilities: caps, events } };
  },
});

registerMindTool({
  name: "hivemind.detect_notification_gaps",
  mind: "hivemind",
  title: "Detect notification gaps",
  description:
    "Detect notification oversight issues: qualified leads generated while their notification is disabled, bookings occurring with booking notifications off, and unread WhatsApp/BuzzChat replies while WhatsApp notifications are off. Read-only; findings feed proposal-only recommendations.",
  access: "read",
  surface: "registry",
  sensitive: false,
  idempotent: true,
  estimatedCost: "low",
  platforms: ["web", "mobile", "api"],
  featureFamily: "analytics",
  capabilityState: "available",
  rollbackSupported: false,
  mobileAvailable: true,
  currentHealth: "healthy",
  inputSchema: z.object({ lookback_days: z.number().int().min(1).max(90).optional() }).optional(),
  run: async (ctx: MindToolContext, input?: { lookback_days?: number }): Promise<MindToolRunResult> => {
    const { caps, applicable, rows, shared, sb } = await loadNotificationOverview(ctx.workspaceId);
    const days = input?.lookback_days ?? 14;
    const sinceIso = new Date(Date.now() - days * 86_400_000).toISOString();
    const rowMap = new Map(rows.map((r) => [r.event_key, r]));
    const applicableSet = new Set(applicable);

    const effective = (key: string) => {
      const saved = rowMap.get(key);
      const d = shared.defaultSettingsForEvent(key);
      const enabled = saved ? saved.enabled !== false : d.enabled;
      const inApp = saved ? saved.in_app_enabled !== false : d.inAppEnabled;
      const email = saved ? saved.email_enabled !== false : d.emailEnabled;
      return { enabled, deliverable: enabled && (inApp || email) };
    };

    const findings: Array<{
      kind: string; severity: "info" | "warning"; event_key: string | null;
      summary: string; evidence: Record<string, unknown>;
    }> = [];

    // 1. Qualified leads arriving while their notification can't deliver.
    if (applicableSet.has("qualified_leads_generated")) {
      const eff = effective("qualified_leads_generated");
      if (!eff.deliverable) {
        const { count, error } = await sb
          .from("leads")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", ctx.workspaceId)
          .eq("status", "qualified")
          .gte("updated_at", sinceIso);
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
          .eq("workspace_id", ctx.workspaceId)
          .eq("meeting_requested", true)
          .gte("updated_at", sinceIso);
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
        (k: string) => shared.NOTIFICATION_EVENT_DEFS[k]?.capability === "whatsapp",
      );
      const anyDeliverable = waKeys.some((k: string) => effective(k).deliverable);
      if (waKeys.length > 0 && !anyDeliverable) {
        const { count, error } = await sb
          .from("whatsapp_conversations")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", ctx.workspaceId)
          .gt("unread_count", 0)
          .gte("last_inbound_at", sinceIso);
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

    // 4. Booked-lead notifications not reaching any assigned agent: leads
    // assigned to sales agents whose event delivery has no in-app channel.
    if (applicableSet.has("lead_assigned")) {
      const eff = effective("lead_assigned");
      if (!eff.deliverable) {
        const { count, error } = await sb
          .from("leads")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", ctx.workspaceId)
          .not("assigned_to", "is", null)
          .gte("assigned_at", sinceIso);
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
      result: {
        findings,
        checked_at: new Date().toISOString(),
        lookback_days: days,
        note: "Advisory only — turn findings into recommendations/proposals; this tool changes nothing.",
      },
    };
  },
});

registerMindTool({
  name: "systemmind.validate_notification_config",
  mind: "systemmind",
  title: "Validate notification configuration",
  description:
    "Check the workspace's notification definitions against the applicable catalogue: missing definitions, rows for non-applicable capabilities, and malformed lead filters. Read-only.",
  access: "read",
  surface: "registry",
  sensitive: false,
  idempotent: true,
  estimatedCost: "low",
  platforms: ["web", "mobile", "api"],
  featureFamily: "workflow_management",
  capabilityState: "available",
  rollbackSupported: false,
  mobileAvailable: true,
  currentHealth: "healthy",
  inputSchema: z.object({}).optional(),
  run: async (ctx: MindToolContext): Promise<MindToolRunResult> => {
    const { applicable, rows, shared } = await loadNotificationOverview(ctx.workspaceId);
    const rowKeys = new Set(rows.map((r) => r.event_key));
    const applicableSet = new Set(applicable);
    const catalogueSet = new Set(shared.NOTIFICATION_EVENT_KEYS as string[]);

    const missingDefinitions = applicable.filter((k: string) => !rowKeys.has(k));
    const nonApplicableRows = rows
      .map((r) => r.event_key)
      .filter((k) => catalogueSet.has(k) && !applicableSet.has(k));
    const unknownRows = rows.map((r) => r.event_key).filter((k) => !catalogueSet.has(k));

    // Malformed lead filters (validated with the same engine delivery uses —
    // these SUPPRESS delivery fail-closed, so they are real issues).
    const malformedLeadFilters: string[] = [];
    const { validateFilterConfig } = await import("@/lib/people-views/filter-engine.server");
    for (const r of rows) {
      if (r.lead_filter == null) continue;
      if (!(shared.LEAD_FILTERABLE_EVENTS as Set<string>).has(r.event_key)) continue;
      const v = validateFilterConfig(r.lead_filter);
      if (!v.ok) malformedLeadFilters.push(r.event_key);
    }

    return {
      result: {
        missing_definitions: missingDefinitions,
        non_applicable_rows: nonApplicableRows,
        unknown_rows: unknownRows,
        malformed_lead_filters: malformedLeadFilters,
        healthy:
          missingDefinitions.length === 0 &&
          unknownRows.length === 0 &&
          malformedLeadFilters.length === 0,
      },
    };
  },
});

registerMindTool({
  name: "systemmind.provision_notification_definitions",
  mind: "systemmind",
  title: "Provision missing notification definitions",
  description:
    "Insert default notification definitions for applicable catalogue events that have no workspace row yet. Strictly insert-only — existing settings are NEVER modified.",
  access: "write",
  surface: "registry",
  sensitive: false,
  requiredActionKey: "notification_settings",
  idempotent: true,
  estimatedCost: "low",
  platforms: ["web", "mobile", "api"],
  featureFamily: "workflow_management",
  capabilityState: "available",
  rollbackSupported: false,
  mobileAvailable: true,
  currentHealth: "healthy",
  inputSchema: z.object({}).optional(),
  run: async (ctx: MindToolContext): Promise<MindToolRunResult> => {
    // Defence in depth: requiredActionKey gates in executeMindTool, but the
    // run-path re-checks so the registry surface can never drift looser.
    const { requireAction } = await import("@/lib/permissions/permissions.server");
    await requireAction(ctx.workspaceId, ctx.userId, "notification_settings");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sb = supabaseAdmin as any;
    const before = await sb
      .from("workspace_notification_settings")
      .select("event_key")
      .eq("workspace_id", ctx.workspaceId);
    const beforeKeys = new Set(((before.data ?? []) as any[]).map((r) => r.event_key));

    const { provisionWorkspaceNotifications } = await import(
      "@/lib/notifications/notification-provisioning.server"
    );
    await provisionWorkspaceNotifications(ctx.workspaceId, "systemmind_tool");

    const after = await sb
      .from("workspace_notification_settings")
      .select("event_key")
      .eq("workspace_id", ctx.workspaceId);
    const inserted = ((after.data ?? []) as any[])
      .map((r) => r.event_key)
      .filter((k) => !beforeKeys.has(k));

    return {
      result: { inserted_event_keys: inserted, inserted: inserted.length },
      affectedRecordType: "workspace_notification_settings",
    };
  },
});
