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
  NOTIFICATION_EVENT_LABELS,
  DEFAULT_EVENT_SETTINGS,
  loadNotificationCaps,
  type NotificationEventKey,
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

    const [{ data, error }, caps, provider, lastEmailByEvent] = await Promise.all([
      sb
        .from("workspace_notification_settings")
        .select("event_key, enabled, email_enabled, in_app_enabled, recipients, frequency")
        .eq("workspace_id", workspaceId),
      loadNotificationCaps(sb, workspaceId),
      (async () => {
        try {
          const { resolveWorkspaceEmailProvider } = await import("@/lib/email/email-dispatch.server");
          const p = await resolveWorkspaceEmailProvider(sb, workspaceId);
          return p.source as string;
        } catch {
          return "platform_default";
        }
      })(),
      (async () => {
        // Latest email-channel delivery outcome per event (for the panel).
        const map = new Map<string, { status: string; error: string | null; at: string | null }>();
        try {
          const { data: rows } = await sb
            .from("workspace_notifications")
            .select("event_key, delivery_status, delivery_error, sent_at, created_at")
            .eq("workspace_id", workspaceId)
            .eq("channel", "email")
            .order("created_at", { ascending: false })
            .limit(300);
          for (const r of rows ?? []) {
            if (!map.has(r.event_key)) {
              map.set(r.event_key, {
                status: r.delivery_status,
                error: r.delivery_error ?? null,
                at: r.sent_at ?? r.created_at ?? null,
              });
            }
          }
        } catch {
          /* best-effort */
        }
        return map;
      })(),
    ]);
    if (error) throw new Error(error.message);
    const byEvent = new Map<string, any>((data ?? []).map((r: any) => [r.event_key, r]));

    const rows = NOTIFICATION_EVENT_KEYS.map((eventKey) => {
      const row = byEvent.get(eventKey);
      const base = row
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
      return { ...base, lastEmail: lastEmailByEvent.get(eventKey) ?? null };
    });
    return { rows, caps, providerSource: provider };
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

    // Package caps — fail closed. Email + custom recipients are locked when
    // the workspace's package does not include them.
    const caps = await loadNotificationCaps(sb, workspaceId);
    if (data.emailEnabled && !caps.emailAllowed) {
      throw new Error("Email notifications are not included in your current package.");
    }
    if ((data.recipients?.customEmails?.length ?? 0) > 0 && !caps.customRecipientsAllowed) {
      throw new Error("Custom email recipients are not included in your current package.");
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

/**
 * Send a test notification email for one event to the acting user.
 * Requires notification_settings grant; respects package caps (fail closed).
 */
export const sendTestNotificationEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { eventKey: string }) => input)
  .handler(async ({ context, data }) => {
    const { workspaceId, userId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    await requireAction(workspaceId, userId, "notification_settings");
    if (!(NOTIFICATION_EVENT_KEYS as readonly string[]).includes(data.eventKey)) {
      throw new Error(`Unknown notification event: ${data.eventKey}`);
    }
    const caps = await loadNotificationCaps(sb, workspaceId);
    if (!caps.emailAllowed) {
      throw new Error("Email notifications are not included in your current package.");
    }
    const { data: profile } = await sb
      .from("profiles")
      .select("email")
      .eq("user_id", userId)
      .maybeSingle();
    if (!profile?.email) throw new Error("Your profile has no email address.");
    const { data: ws } = await sb.from("workspaces").select("name").eq("id", workspaceId).maybeSingle();
    const workspaceName = ws?.name ?? "Workspace";
    const label = NOTIFICATION_EVENT_LABELS[data.eventKey as NotificationEventKey] ?? data.eventKey;

    const { sendWorkspaceEmail } = await import("@/lib/email/email-dispatch.server");
    const { renderBasicEmail, escapeHtml } = await import("@/lib/email/resend.server");
    const html = renderBasicEmail({
      heading: `Test notification — ${label}`,
      bodyHtml:
        `<p><strong>Workspace:</strong> ${escapeHtml(workspaceName)}</p>` +
        `<p>This is a test of the “${escapeHtml(label)}” notification email. ` +
        `If you received this, notification emails are working for your workspace.</p>`,
    });
    const result = await sendWorkspaceEmail(sb, {
      workspaceId,
      to: profile.email,
      subject: `[${workspaceName}] Test notification — ${label}`.slice(0, 250),
      html,
    });
    await writeAccessAudit({
      workspaceId,
      actingUserId: userId,
      objectType: "notification",
      objectId: data.eventKey,
      actionType: "notification_test_send",
      afterState: {
        to: profile.email,
        success: result.success,
        providerUsed: (result as any).providerUsed ?? null,
        ...(result.success ? {} : { error: (result.error ?? "unknown").slice(0, 300) }),
      },
      riskLevel: "low",
    });
    if (!result.success) {
      throw new Error(`Test send failed: ${result.error ?? "unknown error"}`);
    }
    return { ok: true, to: profile.email, providerUsed: (result as any).providerUsed ?? null };
  });
