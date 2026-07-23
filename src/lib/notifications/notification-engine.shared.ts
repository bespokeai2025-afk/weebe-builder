/**
 * Campaign notification engine — pure functions taking a Supabase (service
 * role) client, so both the campaign executor (Vite-plugin context, relative
 * imports only) and normal server code can use them.
 *
 * INVARIANTS (do not weaken):
 *   • emitCampaignNotification NEVER throws — campaign execution can never
 *     fail because of notifications.
 *   • Email failures are recorded on the notification row (delivery_status =
 *     'failed' + delivery_error) and are NOT retried.
 *   • Everything is scoped by workspace_id.
 */
import { escapeHtml, renderBasicEmail } from "../email/resend.server";
import { sendWorkspaceEmail } from "../email/email-dispatch.server";
import { notificationCapsForPackage, type NotificationCaps } from "../packages/packages.shared";

type Sb = any;

export const NOTIFICATION_EVENT_KEYS = [
  "launched",
  "activated",
  "paused",
  "completed",
  "failed",
  "safety_blocked",
  "no_eligible_leads",
  "daily_cap_hit",
  "safety_cap_hit",
  "provider_error",
  "workflow_error",
  "kpi_report_ready",
  "high_negative_sentiment",
  "high_positive_performance",
  "qualified_leads_generated",
  "appointments_booked",
  "follow_up_tasks_created",
  "needs_admin_attention",
  "staff_invite_accepted",
  "systemmind_fix_suggested",
  "reseller_client_created",
  "email_provider_failing",
  "lead_created",
] as const;
export type NotificationEventKey = (typeof NOTIFICATION_EVENT_KEYS)[number];

export const NOTIFICATION_EVENT_LABELS: Record<NotificationEventKey, string> = {
  launched: "Campaign launched",
  activated: "Campaign activated",
  paused: "Campaign paused",
  completed: "Campaign completed",
  failed: "Campaign failed",
  safety_blocked: "Campaign blocked by safety rules",
  no_eligible_leads: "No eligible leads found",
  daily_cap_hit: "Daily call cap hit",
  safety_cap_hit: "Safety cap hit",
  provider_error: "Provider / API error",
  workflow_error: "Workflow error",
  kpi_report_ready: "KPI report ready",
  high_negative_sentiment: "High negative sentiment",
  high_positive_performance: "High positive performance",
  qualified_leads_generated: "Qualified leads generated",
  appointments_booked: "Appointments booked",
  follow_up_tasks_created: "Follow-up tasks created",
  needs_admin_attention: "Needs admin attention",
  staff_invite_accepted: "Staff invite accepted",
  systemmind_fix_suggested: "SystemMind fix suggested",
  reseller_client_created: "Client account created",
  email_provider_failing: "Email provider failing",
  lead_created: "New lead captured",
};

const CRITICAL_EVENTS: ReadonlySet<string> = new Set([
  "failed", "provider_error", "workflow_error", "safety_cap_hit",
  "email_provider_failing",
]);
const WARNING_EVENTS: ReadonlySet<string> = new Set([
  "paused", "safety_blocked", "no_eligible_leads", "daily_cap_hit",
  "high_negative_sentiment", "needs_admin_attention", "systemmind_fix_suggested",
]);

export function severityForEvent(eventKey: string): "info" | "warning" | "critical" {
  if (CRITICAL_EVENTS.has(eventKey)) return "critical";
  if (WARNING_EVENTS.has(eventKey)) return "warning";
  return "info";
}

export type NotificationRecipientsConfig = {
  owner?: boolean;
  admins?: boolean;
  userIds?: string[];
  roleKeys?: string[];
  customEmails?: string[];
  campaignOwner?: boolean;
};

export type NotificationSettings = {
  enabled: boolean;
  emailEnabled: boolean;
  inAppEnabled: boolean;
  recipients: NotificationRecipientsConfig;
  frequency: "immediate" | "hourly" | "daily" | "weekly";
};

/** Defaults when a workspace has no settings row for an event: in-app to owner+admins, no email. */
export const DEFAULT_EVENT_SETTINGS: NotificationSettings = {
  enabled: true,
  emailEnabled: false,
  inAppEnabled: true,
  recipients: { owner: true, admins: true, userIds: [], roleKeys: [], customEmails: [], campaignOwner: false },
  frequency: "immediate",
};

/**
 * Package caps for a workspace, FAIL CLOSED: any lookup problem means no
 * email + no custom recipients (in-app is unaffected).
 */
export async function loadNotificationCaps(sb: Sb, workspaceId: string): Promise<NotificationCaps> {
  try {
    const { data, error } = await sb
      .from("workspace_subscriptions")
      .select("package_key")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (error) return { emailAllowed: false, customRecipientsAllowed: false };
    const packageKey = data?.package_key ?? null;
    // Master Admin DB override (package_definitions.notification_caps_json)
    // wins over the code catalog when both halves are present. Fail closed.
    if (packageKey) {
      const { data: def } = await sb
        .from("package_definitions")
        .select("notification_caps_json")
        .eq("package_key", packageKey)
        .maybeSingle();
      const raw = (def as any)?.notification_caps_json;
      if (raw && typeof raw === "object" &&
          (typeof raw.emailAllowed === "boolean" || typeof raw.customRecipientsAllowed === "boolean")) {
        return {
          emailAllowed: raw.emailAllowed === true,
          customRecipientsAllowed: raw.customRecipientsAllowed === true,
        };
      }
    }
    return notificationCapsForPackage(packageKey);
  } catch {
    return { emailAllowed: false, customRecipientsAllowed: false };
  }
}

/** Clamp settings to package caps (send-time enforcement, fail closed). */
export function clampSettingsToCaps(
  settings: NotificationSettings,
  caps: NotificationCaps,
): NotificationSettings {
  return {
    ...settings,
    emailEnabled: settings.emailEnabled && caps.emailAllowed,
    recipients: {
      ...settings.recipients,
      customEmails: caps.customRecipientsAllowed ? (settings.recipients.customEmails ?? []) : [],
    },
  };
}

export async function loadEventSettings(
  sb: Sb,
  workspaceId: string,
  eventKey: string,
): Promise<NotificationSettings> {
  try {
    const { data } = await sb
      .from("workspace_notification_settings")
      .select("enabled, email_enabled, in_app_enabled, recipients, frequency")
      .eq("workspace_id", workspaceId)
      .eq("event_key", eventKey)
      .maybeSingle();
    if (!data) return DEFAULT_EVENT_SETTINGS;
    return {
      enabled: data.enabled !== false,
      emailEnabled: data.email_enabled === true,
      inAppEnabled: data.in_app_enabled !== false,
      recipients: (data.recipients ?? DEFAULT_EVENT_SETTINGS.recipients) as NotificationRecipientsConfig,
      frequency: (["immediate", "hourly", "daily", "weekly"].includes(data.frequency)
        ? data.frequency
        : "immediate") as NotificationSettings["frequency"],
    };
  } catch {
    return DEFAULT_EVENT_SETTINGS;
  }
}

type ResolvedRecipient = { userId: string | null; email: string | null };

/** Resolve recipient config → concrete users/emails. Workspace-scoped only. */
async function resolveRecipients(
  sb: Sb,
  workspaceId: string,
  cfg: NotificationRecipientsConfig,
  campaignOwnerUserId?: string | null,
): Promise<ResolvedRecipient[]> {
  const userIds = new Set<string>();
  const emails = new Set<string>();

  if (cfg.owner) {
    const { data: ws } = await sb.from("workspaces").select("owner_id").eq("id", workspaceId).maybeSingle();
    if (ws?.owner_id) userIds.add(ws.owner_id);
  }
  if (cfg.admins) {
    const { data: admins } = await sb
      .from("workspace_members")
      .select("user_id, role")
      .eq("workspace_id", workspaceId)
      .in("role", ["owner", "admin"]);
    for (const m of admins ?? []) userIds.add(m.user_id);
  }
  if (cfg.roleKeys?.length) {
    const { data: roleRows } = await sb
      .from("workspace_member_roles")
      .select("user_id, role_key")
      .eq("workspace_id", workspaceId)
      .in("role_key", cfg.roleKeys);
    for (const r of roleRows ?? []) userIds.add(r.user_id);
  }
  if (cfg.userIds?.length) {
    // Only accept users that are actually members of THIS workspace.
    const { data: members } = await sb
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", workspaceId)
      .in("user_id", cfg.userIds);
    for (const m of members ?? []) userIds.add(m.user_id);
  }
  if (cfg.campaignOwner && campaignOwnerUserId) {
    const { data: m } = await sb
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", workspaceId)
      .eq("user_id", campaignOwnerUserId)
      .maybeSingle();
    if (m) userIds.add(m.user_id);
  }
  for (const e of cfg.customEmails ?? []) {
    const trimmed = String(e ?? "").trim().toLowerCase();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) emails.add(trimmed);
  }

  // Emails for member users come from profiles.
  const userEmailMap = new Map<string, string>();
  if (userIds.size > 0) {
    const { data: profiles } = await sb
      .from("profiles")
      .select("user_id, email")
      .in("user_id", Array.from(userIds));
    for (const p of profiles ?? []) if (p.email) userEmailMap.set(p.user_id, p.email);
  }

  const out: ResolvedRecipient[] = [];
  for (const uid of userIds) out.push({ userId: uid, email: userEmailMap.get(uid) ?? null });
  for (const email of emails) out.push({ userId: null, email });
  return out;
}

export type CampaignNotificationInput = {
  workspaceId: string;
  eventKey: NotificationEventKey | string;
  campaignId?: string | null;
  reportId?: string | null;
  campaignName?: string | null;
  campaignStatus?: string | null;
  campaignOwnerUserId?: string | null;
  summary?: string | null;
  kpis?: Record<string, unknown> | null;
  failureReason?: string | null;
  recommendedAction?: string | null;
  severity?: "info" | "warning" | "critical";
};

function kpiHighlights(kpis: Record<string, unknown> | null | undefined): string[] {
  if (!kpis) return [];
  const interesting: Array<[string, string]> = [
    ["calls_placed", "Calls placed"],
    ["calls_total", "Total calls"],
    ["calls_answered", "Answered"],
    ["calls_failed", "Failed"],
    ["positive_sentiment", "Positive sentiment"],
    ["answer_rate", "Answer rate"],
    ["records_matched", "Records matched"],
    ["skipped_by_cap", "Skipped by daily cap"],
  ];
  const out: string[] = [];
  for (const [key, label] of interesting) {
    const v = kpis[key];
    if (typeof v === "number") out.push(`${label}: ${v}`);
  }
  return out.slice(0, 5);
}

function buildEmailHtml(input: CampaignNotificationInput, workspaceName: string, appUrl: string): string {
  const label = NOTIFICATION_EVENT_LABELS[input.eventKey as NotificationEventKey] ?? input.eventKey;
  const parts: string[] = [];
  parts.push(`<p><strong>Workspace:</strong> ${escapeHtml(workspaceName)}</p>`);
  if (input.campaignName) parts.push(`<p><strong>Campaign:</strong> ${escapeHtml(input.campaignName)}</p>`);
  if (input.campaignStatus) parts.push(`<p><strong>Status:</strong> ${escapeHtml(input.campaignStatus)}</p>`);
  if (input.summary) parts.push(`<p>${escapeHtml(input.summary)}</p>`);
  const kpis = kpiHighlights(input.kpis);
  if (kpis.length) {
    parts.push(`<p><strong>KPI highlights</strong></p><ul>${kpis.map((k) => `<li>${escapeHtml(k)}</li>`).join("")}</ul>`);
  }
  if (input.failureReason) parts.push(`<p><strong>Failure reason:</strong> ${escapeHtml(input.failureReason)}</p>`);
  if (input.recommendedAction) parts.push(`<p><strong>Recommended action:</strong> ${escapeHtml(input.recommendedAction)}</p>`);
  const isLeadEvent = input.eventKey === "lead_created";
  const ctaUrl = isLeadEvent ? `${appUrl}/leads` : `${appUrl}/campaigns`;
  const ctaLabel = isLeadEvent ? "View Leads" : "View Campaigns &amp; Reports";
  parts.push(
    `<p style="margin-top:20px;"><a href="${ctaUrl}" style="background:#6d5df6;color:#ffffff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;">${ctaLabel}</a></p>`,
  );
  return renderBasicEmail({ heading: label, bodyHtml: parts.join("\n") });
}

/** Best-effort audit row for notification delivery outcomes. Never throws. */
async function auditNotificationDelivery(
  sb: Sb,
  workspaceId: string,
  actionType: "notification_sent" | "notification_failed",
  detail: Record<string, unknown>,
): Promise<void> {
  try {
    await sb.from("workspace_access_audit_logs").insert({
      workspace_id: workspaceId,
      acting_user_id: null,
      object_type: "notification",
      object_id: typeof detail.eventKey === "string" ? detail.eventKey : null,
      action_type: actionType,
      after_state: detail,
      risk_level: actionType === "notification_failed" ? "medium" : "low",
    });
  } catch (err: any) {
    console.warn("[notify] audit write failed (non-fatal):", err?.message ?? err);
  }
}

function getAppUrl(): string {
  return (
    process.env.PUBLIC_APP_URL ||
    process.env.VITE_PUBLIC_APP_URL ||
    "https://webeereceptionist.com"
  );
}

/**
 * Notification event keys mirrored into the HiveMind executive event stream,
 * mapped to executive event types. Keys not listed are notification-only.
 */
const EXEC_MIRROR_MAP: Record<string, string> = {
  failed:                   "campaign_failed",
  completed:                "campaign_completed",
  workflow_error:           "workflow_failed",
  provider_error:           "provider_error",
  email_provider_failing:   "email_delivery_failed",
  lead_created:             "lead_created",
  qualified_leads_generated: "lead_qualified",
  systemmind_fix_suggested: "systemmind_incident",
};

/** Mirror a notification into the executive event stream. NEVER throws. */
async function mirrorToExecutiveStream(sb: Sb, input: CampaignNotificationInput): Promise<void> {
  try {
    const meta = ((input as any).metadata ?? {}) as Record<string, unknown>;
    let execType = EXEC_MIRROR_MAP[input.eventKey];
    if (!execType && input.eventKey === "needs_admin_attention") {
      execType = meta.source === "growthmind_gads" ? "growthmind_recommendation" : "accountsmind_warning";
    }
    if (!execType) return;

    const day = new Date().toISOString().slice(0, 10);
    const anchor =
      (typeof meta.dedupe_key === "string" && meta.dedupe_key) ||
      input.campaignId ||
      input.reportId ||
      (input.summary ?? "").slice(0, 120) ||
      "general";
    const { publishExecutiveEvent } = await import("../hivemind/executive-events.shared");
    await publishExecutiveEvent(sb, {
      workspaceId: input.workspaceId,
      eventType: execType,
      sourceSystem: "notifications",
      title: input.campaignName
        ? `${input.eventKey} — ${input.campaignName}`
        : input.summary?.slice(0, 200) ?? input.eventKey,
      summary: [input.summary, input.failureReason ? `Reason: ${input.failureReason}` : null]
        .filter(Boolean)
        .join("\n") || null,
      severity: input.severity as any,
      entityType: input.campaignId ? "campaign" : input.reportId ? "report" : null,
      entityId: input.campaignId ?? input.reportId ?? null,
      dedupKey: `${execType}:${anchor}:${day}`,
      correlationKey: input.campaignId ? `campaign:${input.campaignId}` : null,
      evidence: {
        notificationEventKey: input.eventKey,
        failureReason: input.failureReason ?? null,
        recommendedAction: input.recommendedAction ?? null,
        ...(meta.source ? { source: meta.source } : {}),
      },
    });
  } catch (err: any) {
    console.warn("[notify] executive-stream mirror failed (non-fatal):", err?.message ?? err);
  }
}

/**
 * Emit a campaign notification: write in-app + email rows per recipient and
 * send immediate emails. NEVER throws.
 */
export async function emitCampaignNotification(sb: Sb, input: CampaignNotificationInput): Promise<void> {
  try {
    if (!input.workspaceId || !input.eventKey) return;

    // Mirror significant events into the HiveMind executive event stream —
    // BEFORE notification settings checks, since the executive stream is
    // independent of per-user notification preferences. Best-effort.
    await mirrorToExecutiveStream(sb, input);

    const rawSettings = await loadEventSettings(sb, input.workspaceId, input.eventKey);
    const caps = await loadNotificationCaps(sb, input.workspaceId);
    const settings = clampSettingsToCaps(rawSettings, caps);
    if (!settings.enabled) return;
    if (!settings.inAppEnabled && !settings.emailEnabled) return;

    const severity = input.severity ?? severityForEvent(input.eventKey);
    const label = NOTIFICATION_EVENT_LABELS[input.eventKey as NotificationEventKey] ?? input.eventKey;
    const title = input.campaignName ? `${label} — ${input.campaignName}` : label;
    const message = [
      input.summary,
      input.failureReason ? `Reason: ${input.failureReason}` : null,
      input.recommendedAction ? `Recommended: ${input.recommendedAction}` : null,
      ...kpiHighlights(input.kpis),
    ].filter(Boolean).join("\n");

    const recipients = await resolveRecipients(
      sb, input.workspaceId, settings.recipients, input.campaignOwnerUserId,
    );
    if (recipients.length === 0) return;

    const { data: ws } = await sb.from("workspaces").select("name").eq("id", input.workspaceId).maybeSingle();
    const workspaceName = ws?.name ?? "Workspace";

    const baseRow = {
      workspace_id: input.workspaceId,
      event_key: input.eventKey,
      campaign_id: input.campaignId ?? null,
      report_id: input.reportId ?? null,
      title: title.slice(0, 500),
      message: message.slice(0, 4000) || null,
      severity,
    };

    // In-app rows — one per member recipient (deduped by userId).
    if (settings.inAppEnabled) {
      const seen = new Set<string>();
      const inAppRows = recipients
        .filter((r) => r.userId && !seen.has(r.userId!) && (seen.add(r.userId!), true))
        .map((r) => ({
          ...baseRow,
          channel: "in_app",
          recipient_user_id: r.userId,
          delivery_status: "sent",
          sent_at: new Date().toISOString(),
        }));
      if (inAppRows.length) {
        const { error } = await sb.from("workspace_notifications").insert(inAppRows);
        if (error) console.warn("[notify] in-app insert failed:", error.message);
      }
    }

    // Email rows — immediate send or digest queue. One per distinct email.
    if (settings.emailEnabled) {
      const seenEmails = new Set<string>();
      const emailRecipients = recipients.filter((r) => {
        const e = r.email?.toLowerCase();
        if (!e || seenEmails.has(e)) return false;
        seenEmails.add(e);
        return true;
      });

      for (const r of emailRecipients) {
        const row = {
          ...baseRow,
          channel: "email",
          recipient_user_id: r.userId,
          recipient_email: r.email,
          delivery_status: settings.frequency === "immediate" ? "pending" : "digest_queued",
          digest_frequency: settings.frequency === "immediate" ? null : settings.frequency,
        };
        const { data: inserted, error } = await sb
          .from("workspace_notifications")
          .insert(row)
          .select("id")
          .single();
        if (error) {
          console.warn("[notify] email row insert failed:", error.message);
          continue;
        }
        if (settings.frequency !== "immediate") continue;

        const html = buildEmailHtml(input, workspaceName, getAppUrl());
        const result = await sendWorkspaceEmail(sb, {
          workspaceId: input.workspaceId,
          to: r.email!,
          subject: `[${workspaceName}] ${title}`.slice(0, 250),
          html,
        });
        await sb
          .from("workspace_notifications")
          .update(
            result.success
              ? { delivery_status: "sent", sent_at: new Date().toISOString() }
              : { delivery_status: "failed", delivery_error: (result.error ?? "unknown").slice(0, 500) },
          )
          .eq("id", inserted.id);
        await auditNotificationDelivery(
          sb,
          input.workspaceId,
          result.success ? "notification_sent" : "notification_failed",
          {
            eventKey: input.eventKey,
            channel: "email",
            notificationId: inserted.id,
            campaignId: input.campaignId ?? null,
            ...(result.success ? {} : { error: (result.error ?? "unknown").slice(0, 300) }),
          },
        );
      }
    }
  } catch (err: any) {
    console.warn("[notify] emitCampaignNotification failed (non-fatal):", err?.message ?? err);
  }
}

const DIGEST_WINDOW_MS: Record<string, number> = {
  hourly: 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

/**
 * Digest processor — called from the campaign-executor tick. For each
 * (workspace, email, frequency) group whose oldest queued row is older than
 * the window, sends one summary email and marks rows sent/failed. NEVER throws.
 */
export async function processNotificationDigests(sb: Sb): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  try {
    const { data: rows } = await sb
      .from("workspace_notifications")
      .select("id, workspace_id, recipient_email, digest_frequency, title, message, severity, created_at")
      .eq("delivery_status", "digest_queued")
      .order("created_at", { ascending: true })
      .limit(500);
    if (!rows?.length) return { sent, failed };

    const groups = new Map<string, any[]>();
    for (const row of rows) {
      if (!row.recipient_email || !row.digest_frequency) continue;
      const key = `${row.workspace_id}|${row.recipient_email}|${row.digest_frequency}`;
      const arr = groups.get(key) ?? [];
      arr.push(row);
      groups.set(key, arr);
    }

    const now = Date.now();
    for (const [key, group] of groups) {
      const [workspaceId, email, frequency] = key.split("|");
      const windowMs = DIGEST_WINDOW_MS[frequency];
      if (!windowMs) continue;
      const oldest = new Date(group[0].created_at).getTime();
      if (now - oldest < windowMs) continue; // window not elapsed yet

      const { data: ws } = await sb.from("workspaces").select("name").eq("id", workspaceId).maybeSingle();
      const workspaceName = ws?.name ?? "Workspace";
      const items = group
        .map((g) => `<li><strong>${escapeHtml(g.title)}</strong>${g.message ? `<br/><span style="color:#9a9aa6;">${escapeHtml(String(g.message).split("\n")[0])}</span>` : ""}</li>`)
        .join("");
      const html = renderBasicEmail({
        heading: `Campaign notification digest (${frequency})`,
        bodyHtml: `<p><strong>Workspace:</strong> ${escapeHtml(workspaceName)}</p><ul>${items}</ul><p style="margin-top:20px;"><a href="${getAppUrl()}/campaigns" style="background:#6d5df6;color:#ffffff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;">View Campaigns</a></p>`,
      });
      const result = await sendWorkspaceEmail(sb, {
        workspaceId,
        to: email,
        subject: `[${workspaceName}] Campaign digest — ${group.length} notification${group.length === 1 ? "" : "s"}`,
        html,
      });
      const ids = group.map((g) => g.id);
      await sb
        .from("workspace_notifications")
        .update(
          result.success
            ? { delivery_status: "sent", sent_at: new Date().toISOString() }
            : { delivery_status: "failed", delivery_error: (result.error ?? "unknown").slice(0, 500) },
        )
        .in("id", ids);
      await auditNotificationDelivery(
        sb,
        workspaceId,
        result.success ? "notification_sent" : "notification_failed",
        {
          eventKey: "digest",
          channel: "email",
          frequency,
          count: ids.length,
          ...(result.success ? {} : { error: (result.error ?? "unknown").slice(0, 300) }),
        },
      );
      if (result.success) sent += ids.length;
      else failed += ids.length;
    }
  } catch (err: any) {
    console.warn("[notify] digest processing failed (non-fatal):", err?.message ?? err);
  }
  return { sent, failed };
}
