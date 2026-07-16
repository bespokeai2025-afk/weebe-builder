/**
 * Analytics Hub — automated campaign-report schedule setup (server-only).
 *
 * `ensureAutomatedCampaignReportSchedule` idempotently creates the "campaign
 * success + KPI report, emailed automatically" schedule for a workspace:
 *   • WBAH workspace  → `wbah_dialler_summary` (WeeBespoke dialler KPIs —
 *     WBAH has no WEBEE campaigns).
 *   • other workspaces → `daily_campaign_summary` (covers every campaign).
 *
 * Recipients default to the workspace's owner + admin member emails (from
 * profiles) when none are passed. If an enabled schedule of the chosen report
 * type already exists for the workspace, nothing is created (returns it).
 *
 * Used by the one-off WBAH setup script and by the SystemMind
 * `systemMindSetupCampaignReportSchedule` action for future clients.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isWbahWorkspaceId } from "@/lib/wbah-exclusion.shared";

type Sb = any;

export interface EnsureScheduleOptions {
  /** daily | weekly | monthly (default daily). */
  frequency?: "daily" | "weekly" | "monthly";
  /** UTC hour to send at (default 8). */
  hour?: number;
  /** Explicit recipient emails; defaults to owner+admin member emails. */
  recipients?: string[];
  createdByUserId?: string | null;
}

export interface EnsureScheduleResult {
  ok: boolean;
  created: boolean;
  scheduleId: string | null;
  reportType: string;
  recipients: string[];
  error?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Owner + admin member emails for a workspace (via profiles). */
export async function resolveOwnerAdminEmails(
  sb: Sb,
  workspaceId: string,
): Promise<string[]> {
  const { data: members } = await sb
    .from("workspace_members")
    .select("user_id, role")
    .eq("workspace_id", workspaceId)
    .in("role", ["owner", "admin"]);
  const userIds = (members ?? []).map((m: any) => m.user_id).filter(Boolean);
  if (userIds.length === 0) return [];
  const { data: profiles } = await sb
    .from("profiles")
    .select("user_id, email")
    .in("user_id", userIds);
  const emails = new Set<string>();
  for (const p of profiles ?? []) {
    const e = String(p.email ?? "").trim().toLowerCase();
    if (EMAIL_RE.test(e)) emails.add(e);
  }
  return Array.from(emails);
}

export async function ensureAutomatedCampaignReportSchedule(
  workspaceId: string,
  opts: EnsureScheduleOptions = {},
): Promise<EnsureScheduleResult> {
  const sb = supabaseAdmin as Sb;
  const wbah = isWbahWorkspaceId(workspaceId);
  const reportType = wbah ? "wbah_dialler_summary" : "daily_campaign_summary";
  try {
    const recipients =
      opts.recipients && opts.recipients.length > 0
        ? opts.recipients.map((e) => e.trim().toLowerCase()).filter((e) => EMAIL_RE.test(e))
        : await resolveOwnerAdminEmails(sb, workspaceId);
    if (recipients.length === 0) {
      return { ok: false, created: false, scheduleId: null, reportType, recipients: [], error: "no_recipients" };
    }

    // Idempotent: reuse an existing enabled schedule of this type.
    const { data: existing, error: exErr } = await sb
      .from("analytics_report_schedules")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("report_type", reportType)
      .eq("enabled", true)
      .limit(1);
    if (exErr) {
      return { ok: false, created: false, scheduleId: null, reportType, recipients, error: exErr.message };
    }
    if (existing?.length) {
      return { ok: true, created: false, scheduleId: existing[0].id, reportType, recipients };
    }

    const frequency = opts.frequency ?? "daily";
    const hour = Number.isFinite(Number(opts.hour)) ? Number(opts.hour) : 8;
    const { data: row, error } = await sb
      .from("analytics_report_schedules")
      .insert({
        workspace_id: workspaceId,
        report_type: reportType,
        name: wbah ? "Daily Dialler Success & KPI Report" : "Daily Campaign Success & KPI Report",
        frequency,
        schedule_config_json: { hour },
        recipients_json: recipients,
        // "yesterday" so the daily send always covers a complete day.
        filters_json: { dateFilter: frequency === "daily" ? "yesterday" : "7d" },
        enabled: true,
        created_by_user_id: opts.createdByUserId ?? null,
      })
      .select("id")
      .maybeSingle();
    if (error) {
      return { ok: false, created: false, scheduleId: null, reportType, recipients, error: error.message };
    }
    return { ok: true, created: true, scheduleId: row?.id ?? null, reportType, recipients };
  } catch (err: any) {
    return {
      ok: false,
      created: false,
      scheduleId: null,
      reportType,
      recipients: [],
      error: err?.message ?? "setup_failed",
    };
  }
}
