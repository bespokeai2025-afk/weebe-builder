/**
 * Analytics Hub — Reports Centre server functions.
 *
 * Read-mostly. All mutations are audited and gated by package feature + role
 * action. WBAH is allowed to store reports but campaign-lifecycle report kinds
 * are refused for WBAH workspaces (enforced in the generator).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { resolveActiveWorkspace } from "@/lib/workspace/context.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireFeatureAccess } from "@/lib/packages/entitlements.server";
import { requireAction, writeAccessAudit } from "@/lib/permissions/permissions.server";
import {
  generateAnalyticsReport,
  ANALYTICS_REPORT_TYPES,
  WBAH_ONLY_REPORT_TYPES,
  type AnalyticsReportType,
} from "./report-generator.server";
import { sendAnalyticsReportEmail } from "./report-email.server";
import { isWbahWorkspaceId } from "@/lib/wbah-exclusion.shared";

/** WBAH-only report kinds are rejected at creation, not just generation. */
function assertReportTypeAllowed(workspaceId: string, reportType: string): void {
  if (WBAH_ONLY_REPORT_TYPES.has(reportType as AnalyticsReportType) && !isWbahWorkspaceId(workspaceId)) {
    throw new Error("This report type is not available for this workspace.");
  }
}

async function ctxWs(context: any): Promise<{ workspaceId: string; role: string; userId: string }> {
  const { supabase, workspaceId, userId } = context;
  if (!workspaceId) throw new Error("No active workspace");
  const ws = await resolveActiveWorkspace(supabase, userId);
  return { workspaceId: ws.workspaceId, role: ws.workspaceRole, userId };
}

const reportTypeSchema = z.enum(
  ANALYTICS_REPORT_TYPES as unknown as [AnalyticsReportType, ...AnalyticsReportType[]],
);

// ── Reads ─────────────────────────────────────────────────────────────────────

export const listAnalyticsReports = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        reportType: z.string().max(60).nullish(),
        status: z.string().max(30).nullish(),
        search: z.string().max(200).nullish(),
        limit: z.number().int().min(1).max(200).nullish(),
        offset: z.number().int().min(0).nullish(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { workspaceId } = await ctxWs(context);
    const limit = data.limit ?? 50;
    const offset = data.offset ?? 0;
    let q = (supabaseAdmin as any)
      .from("analytics_reports")
      .select("*", { count: "exact" })
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (data.reportType) q = q.eq("report_type", data.reportType);
    if (data.status) q = q.eq("report_status", data.status);
    if (data.search) q = q.ilike("report_name", `%${data.search}%`);
    const { data: rows, count, error } = await q;
    if (error) return { reports: [], total: 0, error: error.message };
    return { reports: rows ?? [], total: count ?? 0 };
  });

export const getAnalyticsReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { workspaceId } = await ctxWs(context);
    const { data: row, error } = await (supabaseAdmin as any)
      .from("analytics_reports")
      .select("*")
      .eq("id", data.id)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Report not found in this workspace.");
    return row;
  });

// ── Mutations ───────────────────────────────────────────────────────────────

export const generateReportNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        reportType: reportTypeSchema,
        name: z.string().max(200).nullish(),
        campaignId: z.string().uuid().nullish(),
        agentId: z.string().uuid().nullish(),
        workflowId: z.string().uuid().nullish(),
        dateFilter: z.string().max(30).nullish(),
        dateRangeStart: z.string().nullish(),
        dateRangeEnd: z.string().nullish(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { workspaceId, userId } = await ctxWs(context);
    await requireFeatureAccess(workspaceId, userId, "analytics_campaign_reports");
    assertReportTypeAllowed(workspaceId, data.reportType);

    const reportId = await generateAnalyticsReport({
      workspaceId,
      reportType: data.reportType,
      name: data.name ?? null,
      relatedCampaignId: data.campaignId ?? null,
      relatedAgentId: data.agentId ?? null,
      relatedWorkflowId: data.workflowId ?? null,
      dateFilter: data.dateFilter ?? null,
      dateRangeStart: data.dateRangeStart ?? null,
      dateRangeEnd: data.dateRangeEnd ?? null,
      generatedBy: "user",
      createdByUserId: userId,
    });

    if (!reportId) return { ok: false, error: "generation_failed" };
    writeAccessAudit({
      workspaceId,
      actingUserId: userId,
      objectType: "analytics_report",
      objectId: reportId,
      actionType: "report_generated",
      afterState: { reportType: data.reportType },
      riskLevel: "low",
    });
    return { ok: true, reportId };
  });

export const sendReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        reportId: z.string().uuid(),
        recipients: z.array(z.string().email()).min(1).max(50),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { workspaceId, userId } = await ctxWs(context);
    await requireFeatureAccess(workspaceId, userId, "automated_report_emails");
    await requireAction(workspaceId, userId, "notification_settings");

    // Confirm the report belongs to this workspace before sending.
    const { data: row } = await (supabaseAdmin as any)
      .from("analytics_reports")
      .select("id")
      .eq("id", data.reportId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (!row) return { ok: false, error: "report_not_found" };

    const res = await sendAnalyticsReportEmail(data.reportId, data.recipients, {
      actingUserId: userId,
    });
    return res;
  });

// ── Schedule CRUD ─────────────────────────────────────────────────────────────

export const listReportSchedules = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId } = await ctxWs(context);
    const { data, error } = await (supabaseAdmin as any)
      .from("analytics_report_schedules")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) return { schedules: [], error: error.message };
    return { schedules: data ?? [] };
  });

export const createReportSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        reportType: reportTypeSchema,
        name: z.string().min(1).max(200),
        frequency: z.enum(["daily", "weekly", "monthly", "custom"]),
        scheduleConfig: z.record(z.string(), z.any()).nullish(),
        recipients: z.array(z.string().email()).max(50).nullish(),
        filters: z.record(z.string(), z.any()).nullish(),
        enabled: z.boolean().nullish(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { workspaceId, userId } = await ctxWs(context);
    await requireFeatureAccess(workspaceId, userId, "analytics_scheduled_reports");
    await requireAction(workspaceId, userId, "notification_settings");
    assertReportTypeAllowed(workspaceId, data.reportType);

    const { data: row, error } = await (supabaseAdmin as any)
      .from("analytics_report_schedules")
      .insert({
        workspace_id: workspaceId,
        report_type: data.reportType,
        name: data.name,
        frequency: data.frequency,
        schedule_config_json: data.scheduleConfig ?? {},
        recipients_json: data.recipients ?? [],
        filters_json: data.filters ?? {},
        enabled: data.enabled ?? true,
        created_by_user_id: userId,
      })
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    writeAccessAudit({
      workspaceId,
      actingUserId: userId,
      objectType: "analytics_report_schedule",
      objectId: row?.id ?? null,
      actionType: "schedule_created",
      afterState: { reportType: data.reportType, frequency: data.frequency },
      riskLevel: "low",
    });
    return { ok: true, schedule: row };
  });

export const updateReportSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        name: z.string().min(1).max(200).nullish(),
        frequency: z.enum(["daily", "weekly", "monthly", "custom"]).nullish(),
        scheduleConfig: z.record(z.string(), z.any()).nullish(),
        recipients: z.array(z.string().email()).max(50).nullish(),
        filters: z.record(z.string(), z.any()).nullish(),
        enabled: z.boolean().nullish(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { workspaceId, userId } = await ctxWs(context);
    await requireFeatureAccess(workspaceId, userId, "analytics_scheduled_reports");
    await requireAction(workspaceId, userId, "notification_settings");

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.name != null) patch.name = data.name;
    if (data.frequency != null) patch.frequency = data.frequency;
    if (data.scheduleConfig != null) patch.schedule_config_json = data.scheduleConfig;
    if (data.recipients != null) patch.recipients_json = data.recipients;
    if (data.filters != null) patch.filters_json = data.filters;
    if (data.enabled != null) patch.enabled = data.enabled;

    const { data: row, error } = await (supabaseAdmin as any)
      .from("analytics_report_schedules")
      .update(patch)
      .eq("id", data.id)
      .eq("workspace_id", workspaceId)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) return { ok: false, error: "schedule_not_found" };
    writeAccessAudit({
      workspaceId,
      actingUserId: userId,
      objectType: "analytics_report_schedule",
      objectId: data.id,
      actionType: "schedule_updated",
      afterState: patch,
      riskLevel: "low",
    });
    return { ok: true, schedule: row };
  });

export const deleteReportSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { workspaceId, userId } = await ctxWs(context);
    await requireFeatureAccess(workspaceId, userId, "analytics_scheduled_reports");
    await requireAction(workspaceId, userId, "notification_settings");

    const { error } = await (supabaseAdmin as any)
      .from("analytics_report_schedules")
      .delete()
      .eq("id", data.id)
      .eq("workspace_id", workspaceId);
    if (error) throw new Error(error.message);
    writeAccessAudit({
      workspaceId,
      actingUserId: userId,
      objectType: "analytics_report_schedule",
      objectId: data.id,
      actionType: "schedule_deleted",
      riskLevel: "low",
    });
    return { ok: true };
  });
