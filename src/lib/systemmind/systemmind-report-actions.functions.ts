/**
 * SystemMind — Analytics report actions (exec integration).
 *
 * Approval-first, drafts-only, conservative scope. This session wires the three
 * safe, read-mostly actions the SystemMind exec can take against the Analytics
 * Hub reports engine:
 *   • generate_report          → create an analytics_reports row (audited)
 *   • explain_report           → deterministic plain-language explanation (read)
 *   • diagnose_campaign_report → summarise findings + suggested fixes (read)
 *
 * The remaining catalog entries (send_report / schedule_report /
 * compare_reports / create_fix_from_report) are intentionally NOT wired here:
 * sends & schedules already live in reports.functions.ts behind their own
 * feature gates, and create_fix_from_report must go through the HiveMind action
 * approval flow before any mutation is applied.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function requireWorkspaceId(workspaceId: string | undefined): string {
  if (!workspaceId) throw new Error("No workspace selected — join or create a workspace first.");
  return workspaceId;
}

// ── generate_report ───────────────────────────────────────────────────────────
export const systemMindGenerateReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        reportType: z.string().min(1).max(60),
        name: z.string().max(200).nullish(),
        campaignId: z.string().uuid().nullish(),
        agentId: z.string().uuid().nullish(),
        workflowId: z.string().uuid().nullish(),
        dateFilter: z.string().max(30).nullish(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    {
      const { requireSystemMindEdit } = await import(
        "@/lib/systemmind/systemmind-access.server"
      );
      await requireSystemMindEdit(context.workspaceId, context.userId);
    }
    const workspaceId = requireWorkspaceId(context.workspaceId);

    const { requireFeatureAccess } = await import("@/lib/packages/entitlements.server");
    await requireFeatureAccess(workspaceId, context.userId ?? null, "analytics_campaign_reports");

    const {
      generateAnalyticsReport,
      ANALYTICS_REPORT_TYPES,
    } = await import("@/lib/analytics-hub/report-generator.server");

    if (!(ANALYTICS_REPORT_TYPES as readonly string[]).includes(data.reportType)) {
      return { ok: false as const, error: "unknown_report_type" };
    }

    const reportId = await generateAnalyticsReport({
      workspaceId,
      reportType: data.reportType as any,
      name: data.name ?? null,
      relatedCampaignId: data.campaignId ?? null,
      relatedAgentId: data.agentId ?? null,
      relatedWorkflowId: data.workflowId ?? null,
      dateFilter: data.dateFilter ?? null,
      generatedBy: "systemmind",
      createdByUserId: context.userId ?? null,
    });

    if (!reportId) return { ok: false as const, error: "generation_failed" };

    const { writeAccessAudit } = await import("@/lib/permissions/permissions.server");
    writeAccessAudit({
      workspaceId,
      actingUserId: context.userId ?? null,
      objectType: "analytics_report",
      objectId: reportId,
      actionType: "report_generated",
      afterState: { reportType: data.reportType, via: "systemmind" },
      riskLevel: "low",
    });
    return { ok: true as const, reportId };
  });

// ── setup_campaign_report_schedule ───────────────────────────────────────────
/**
 * Set up the automated "campaign success + KPI report, emailed daily" schedule
 * for the current workspace. Idempotent — reuses an existing enabled schedule.
 * WBAH gets the dialler summary; every other workspace gets the daily campaign
 * summary. Recipients default to the workspace owner + admin emails.
 */
export const systemMindSetupCampaignReportSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        recipients: z.array(z.string().email()).max(50).nullish(),
        frequency: z.enum(["daily", "weekly", "monthly"]).nullish(),
        hour: z.number().int().min(0).max(23).nullish(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    {
      const { requireSystemMindEdit } = await import(
        "@/lib/systemmind/systemmind-access.server"
      );
      await requireSystemMindEdit(context.workspaceId, context.userId);
    }
    const workspaceId = requireWorkspaceId(context.workspaceId);

    const { requireFeatureAccess } = await import("@/lib/packages/entitlements.server");
    await requireFeatureAccess(workspaceId, context.userId ?? null, "analytics_scheduled_reports");
    const { requireAction } = await import("@/lib/permissions/permissions.server");
    await requireAction(workspaceId, context.userId ?? null, "notification_settings");

    const { ensureAutomatedCampaignReportSchedule } = await import(
      "@/lib/analytics-hub/report-schedule-setup.server"
    );
    const result = await ensureAutomatedCampaignReportSchedule(workspaceId, {
      recipients: data.recipients ?? undefined,
      frequency: data.frequency ?? undefined,
      hour: data.hour ?? undefined,
      createdByUserId: context.userId ?? null,
    });
    if (!result.ok) return { ok: false as const, error: result.error ?? "setup_failed" };

    const { writeAccessAudit } = await import("@/lib/permissions/permissions.server");
    writeAccessAudit({
      workspaceId,
      actingUserId: context.userId ?? null,
      objectType: "analytics_report_schedule",
      objectId: result.scheduleId,
      actionType: result.created ? "schedule_created" : "schedule_reused",
      afterState: { reportType: result.reportType, recipients: result.recipients.length, via: "systemmind" },
      riskLevel: "low",
    });
    return {
      ok: true as const,
      created: result.created,
      scheduleId: result.scheduleId,
      reportType: result.reportType,
      recipients: result.recipients,
    };
  });

// ── explain_report ────────────────────────────────────────────────────────────
export const systemMindExplainReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ reportId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    {
      const { requireSystemMindView } = await import(
        "@/lib/systemmind/systemmind-access.server"
      );
      await requireSystemMindView(context.workspaceId, context.userId);
    }
    const workspaceId = requireWorkspaceId(context.workspaceId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await (supabaseAdmin as any)
      .from("analytics_reports")
      .select(
        "id, report_type, report_name, report_summary, insights_json, recommendations_json, date_range_start, date_range_end",
      )
      .eq("id", data.reportId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (error) return { ok: false as const, error: error.message };
    if (!row) return { ok: false as const, error: "report_not_found" };

    const insights = Array.isArray(row.insights_json) ? row.insights_json : [];
    const recommendations = Array.isArray(row.recommendations_json)
      ? row.recommendations_json
      : [];

    const lines: string[] = [];
    lines.push(`${row.report_name} (${row.report_type}).`);
    if (row.report_summary) lines.push(row.report_summary);
    if (insights.length > 0) {
      lines.push("Key findings:");
      for (const i of insights.slice(0, 6)) {
        lines.push(`• ${typeof i === "string" ? i : i?.text ?? i?.title ?? JSON.stringify(i)}`);
      }
    }
    if (recommendations.length > 0) {
      lines.push("Recommendations (drafts — require approval before applying):");
      for (const r of recommendations.slice(0, 6)) {
        lines.push(`• ${typeof r === "string" ? r : r?.text ?? r?.title ?? JSON.stringify(r)}`);
      }
    }

    return {
      ok: true as const,
      reportId: row.id,
      explanation: lines.join("\n"),
      insightCount: insights.length,
      recommendationCount: recommendations.length,
    };
  });

// ── diagnose_campaign_report ──────────────────────────────────────────────────
export const systemMindDiagnoseCampaignReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ reportId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    {
      const { requireSystemMindView } = await import(
        "@/lib/systemmind/systemmind-access.server"
      );
      await requireSystemMindView(context.workspaceId, context.userId);
    }
    const workspaceId = requireWorkspaceId(context.workspaceId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await (supabaseAdmin as any)
      .from("analytics_reports")
      .select(
        "id, report_type, report_name, report_summary, metrics_json, insights_json, recommendations_json, related_campaign_id",
      )
      .eq("id", data.reportId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (error) return { ok: false as const, error: error.message };
    if (!row) return { ok: false as const, error: "report_not_found" };

    const metrics = (row.metrics_json ?? {}) as Record<string, any>;
    const recommendations = Array.isArray(row.recommendations_json)
      ? row.recommendations_json
      : [];

    const findings: string[] = [];
    const failureReason = metrics.failure_reason ?? metrics.failureReason ?? null;
    if (failureReason) findings.push(`Failure reason: ${failureReason}`);
    if (typeof metrics.calls_total === "number" && metrics.calls_total === 0) {
      findings.push("No calls were placed in this window.");
    }
    if (typeof metrics.leads_new === "number" && metrics.leads_new === 0) {
      findings.push("No new leads entered the campaign in this window.");
    }
    if (row.report_summary) findings.push(row.report_summary);

    const suggestedFixes = recommendations
      .slice(0, 6)
      .map((r: any) => (typeof r === "string" ? r : r?.text ?? r?.title ?? JSON.stringify(r)));

    return {
      ok: true as const,
      reportId: row.id,
      campaignId: row.related_campaign_id ?? null,
      reportType: row.report_type,
      findings,
      suggestedFixes,
      note: "Diagnosis only. Fixes are drafts and require approval before any change is applied.",
    };
  });
