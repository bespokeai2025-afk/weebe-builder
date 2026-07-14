/**
 * Workspace campaign-notification server functions.
 * Reads = any member; settings writes require the `notification_settings`
 * action grant (owners/admins by default).
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireAction, resolvePermissions, writeAccessAudit } from "@/lib/permissions/permissions.server";
import {
  NOTIFICATION_EVENT_KEYS,
  DEFAULT_EVENT_SETTINGS,
  type NotificationRecipientsConfig,
} from "./notification-engine.shared";

const sb = supabaseAdmin as any;

/** List effective per-event notification settings (defaults merged in). */
export const listNotificationSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId, userId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const perms = await resolvePermissions(workspaceId, userId);
    if (!perms.isMember) throw new Error("Not a member of this workspace");

    const { data, error } = await sb
      .from("workspace_notification_settings")
      .select("event_key, enabled, email_enabled, in_app_enabled, recipients, frequency")
      .eq("workspace_id", workspaceId);
    if (error) throw new Error(error.message);
    const byEvent = new Map<string, any>((data ?? []).map((r: any) => [r.event_key, r]));

    return NOTIFICATION_EVENT_KEYS.map((eventKey) => {
      const row = byEvent.get(eventKey);
      return row
        ? {
            eventKey,
            enabled: row.enabled !== false,
            emailEnabled: row.email_enabled === true,
            inAppEnabled: row.in_app_enabled !== false,
            recipients: row.recipients ?? DEFAULT_EVENT_SETTINGS.recipients,
            frequency: row.frequency ?? "immediate",
            isDefault: false,
          }
        : { eventKey, ...structuredClone(DEFAULT_EVENT_SETTINGS), isDefault: true };
    });
  });

export const updateNotificationSetting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      eventKey: string;
      enabled: boolean;
      emailEnabled: boolean;
      inAppEnabled: boolean;
      recipients: NotificationRecipientsConfig;
      frequency: "immediate" | "hourly" | "daily" | "weekly";
    }) => input,
  )
  .handler(async ({ context, data }) => {
    const { workspaceId, userId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    await requireAction(workspaceId, userId, "notification_settings");
    if (!(NOTIFICATION_EVENT_KEYS as readonly string[]).includes(data.eventKey)) {
      throw new Error(`Unknown notification event: ${data.eventKey}`);
    }
    if (!["immediate", "hourly", "daily", "weekly"].includes(data.frequency)) {
      throw new Error("Invalid frequency");
    }

    const recipients: NotificationRecipientsConfig = {
      owner: data.recipients?.owner === true,
      admins: data.recipients?.admins === true,
      userIds: Array.isArray(data.recipients?.userIds) ? data.recipients.userIds.slice(0, 50) : [],
      roleKeys: Array.isArray(data.recipients?.roleKeys) ? data.recipients.roleKeys.slice(0, 20) : [],
      customEmails: Array.isArray(data.recipients?.customEmails)
        ? data.recipients.customEmails.map((e) => String(e).trim()).filter(Boolean).slice(0, 20)
        : [],
      campaignOwner: data.recipients?.campaignOwner === true,
    };

    const { data: before } = await sb
      .from("workspace_notification_settings")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("event_key", data.eventKey)
      .maybeSingle();

    const row = {
      workspace_id: workspaceId,
      event_key: data.eventKey,
      enabled: data.enabled,
      email_enabled: data.emailEnabled,
      in_app_enabled: data.inAppEnabled,
      recipients,
      frequency: data.frequency,
      updated_by_user_id: userId,
      updated_at: new Date().toISOString(),
    };
    const { error } = await sb
      .from("workspace_notification_settings")
      .upsert(row, { onConflict: "workspace_id,event_key" });
    if (error) throw new Error(error.message);

    await writeAccessAudit({
      workspaceId,
      actingUserId: userId,
      objectType: "notification_setting",
      objectId: data.eventKey,
      actionType: before ? "update" : "create",
      beforeState: before ?? null,
      afterState: row,
      riskLevel: "low",
    });
    return { ok: true };
  });

/** List in-app notifications for the current workspace (member-scoped). */
export const listWorkspaceNotifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input?: { limit?: number; unreadOnly?: boolean; severity?: string }) => input ?? {})
  .handler(async ({ context, data }) => {
    const { workspaceId, userId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const perms = await resolvePermissions(workspaceId, userId);
    if (!perms.isMember) throw new Error("Not a member of this workspace");

    let q = sb
      .from("workspace_notifications")
      .select("id, event_key, campaign_id, report_id, title, message, severity, channel, recipient_user_id, delivery_status, delivery_error, read_at, sent_at, created_at")
      .eq("workspace_id", workspaceId)
      .eq("channel", "in_app")
      .or(`recipient_user_id.eq.${userId},recipient_user_id.is.null`)
      .order("created_at", { ascending: false })
      .limit(Math.min(data.limit ?? 50, 200));
    if (data.unreadOnly) q = q.is("read_at", null);
    if (data.severity) q = q.eq("severity", data.severity);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const markNotificationsRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { ids?: string[]; all?: boolean }) => input)
  .handler(async ({ context, data }) => {
    const { workspaceId, userId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const perms = await resolvePermissions(workspaceId, userId);
    if (!perms.isMember) throw new Error("Not a member of this workspace");

    let q = sb
      .from("workspace_notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("workspace_id", workspaceId)
      .eq("recipient_user_id", userId)
      .is("read_at", null);
    if (!data.all) {
      const ids = (data.ids ?? []).slice(0, 200);
      if (ids.length === 0) return { ok: true, updated: 0 };
      q = q.in("id", ids);
    }
    const { error } = await q;
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Recent high-severity unread notifications — Campaigns page banner. */
export const listCriticalNotifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId, userId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const perms = await resolvePermissions(workspaceId, userId);
    if (!perms.isMember) throw new Error("Not a member of this workspace");
    const since = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    const { data: rows, error } = await sb
      .from("workspace_notifications")
      .select("id, event_key, campaign_id, title, message, severity, created_at")
      .eq("workspace_id", workspaceId)
      .eq("channel", "in_app")
      .eq("recipient_user_id", userId)
      .eq("severity", "critical")
      .is("read_at", null)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(5);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
