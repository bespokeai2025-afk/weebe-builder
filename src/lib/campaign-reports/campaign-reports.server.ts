/**
 * Campaign Reports — server-side helpers around report-writer.shared.ts.
 * Reports are observational only: they never mutate campaigns, leads or calls.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { assertNotWbahWorkspace, isWbahWorkspaceId } from "@/lib/wbah-exclusion.shared";
import {
  safeWriteCampaignReport,
  computeCampaignKpis,
  isFailureReportType,
  type CampaignReportType,
  type CampaignReportInput,
} from "./report-writer.shared";

export { safeWriteCampaignReport, computeCampaignKpis, isFailureReportType };
export type { CampaignReportType, CampaignReportInput };

/**
 * Fire-and-forget lifecycle report for a campaign status change. Loads
 * campaign + agent context and computes best-effort KPIs. NEVER throws.
 */
export async function reportCampaignLifecycle(args: {
  workspaceId: string;
  campaignId: string;
  reportType: CampaignReportType;
  userId?: string | null;
  failureReason?: string | null;
  errorMessage?: string | null;
  extraKpis?: Record<string, unknown>;
}): Promise<string | null> {
  if (isWbahWorkspaceId(args.workspaceId)) return null; // WBAH excluded
  const sb = supabaseAdmin as any;
  try {
    const { data: campaign } = await sb
      .from("campaigns")
      .select("id, name, status, agent_id, created_at")
      .eq("id", args.campaignId)
      .eq("workspace_id", args.workspaceId)
      .maybeSingle();
    if (!campaign) return null;

    let agentName: string | null = null;
    let retellAgentId: string | null = null;
    if (campaign.agent_id) {
      const { data: agent } = await sb
        .from("agents")
        .select("name, retell_agent_id, settings")
        .eq("id", campaign.agent_id)
        .maybeSingle();
      agentName = agent?.name ?? null;
      const settings = (agent?.settings ?? {}) as Record<string, unknown>;
      retellAgentId =
        (settings.deployedRetellAgentId as string | undefined) ??
        agent?.retell_agent_id ?? null;
    }

    // KPI window: since campaign creation (best effort).
    const kpis =
      args.reportType === "completed" || args.reportType === "kpi_summary" ||
      args.reportType === "paused" || args.reportType === "cancelled" ||
      isFailureReportType(args.reportType)
        ? await computeCampaignKpis(sb, args.workspaceId, {
            agentId: retellAgentId,
            sinceIso: campaign.created_at ?? null,
            extra: args.extraKpis,
          })
        : { ...(args.extraKpis ?? {}) };

    const reportId = await safeWriteCampaignReport(sb, {
      workspaceId: args.workspaceId,
      campaignId: campaign.id,
      agentId: campaign.agent_id ?? null,
      reportType: args.reportType,
      campaignStatus: campaign.status ?? null,
      campaignName: campaign.name ?? null,
      agentName,
      kpis,
      failureReason: args.failureReason ?? null,
      errorMessage: args.errorMessage ?? null,
      userId: args.userId ?? null,
    });

    // Additive Analytics Hub report (fire-and-forget). Campaign execution must
    // never fail because of this — generateAnalyticsReport never throws.
    try {
      const { generateAnalyticsReport, campaignLifecycleToAnalyticsType } = await import(
        "@/lib/analytics-hub/report-generator.server"
      );
      const analyticsType = campaignLifecycleToAnalyticsType(args.reportType);
      if (analyticsType) {
        void generateAnalyticsReport({
          workspaceId: args.workspaceId,
          reportType: analyticsType,
          relatedCampaignId: campaign.id,
          relatedAgentId: campaign.agent_id ?? null,
          generatedBy: args.userId ? "user" : "system",
          createdByUserId: args.userId ?? null,
          failureReason: args.failureReason ?? null,
          errorMessage: args.errorMessage ?? null,
        });
      }
    } catch (hookErr: any) {
      console.error(
        "[campaign-reports] analytics report hook failed (non-fatal):",
        hookErr?.message ?? hookErr,
      );
    }

    return reportId;
  } catch (err: any) {
    console.error("[campaign-reports] lifecycle report failed (non-fatal):", err?.message ?? err);
    return null;
  }
}

// ── Reads ────────────────────────────────────────────────────────────────────

export async function listCampaignReports(
  workspaceId: string,
  opts?: { campaignId?: string | null; reportType?: string | null; limit?: number; role?: string },
) {
  assertNotWbahWorkspace(workspaceId);
  let q = (supabaseAdmin as any)
    .from("campaign_reports")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(Math.min(opts?.limit ?? 50, 200));
  if (opts?.campaignId) q = q.eq("campaign_id", opts.campaignId);
  if (opts?.reportType) q = q.eq("report_type", opts.reportType);
  if (opts?.role) q = q.contains("visible_to_roles", [opts.role]);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getCampaignReport(workspaceId: string, id: string) {
  assertNotWbahWorkspace(workspaceId);
  const { data, error } = await (supabaseAdmin as any)
    .from("campaign_reports")
    .select("*")
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Report not found in this workspace.");
  return data;
}

/** Latest unresolved failure-type report per campaign (for UI banners). */
export async function listRecentFailureReports(workspaceId: string, limit = 10) {
  assertNotWbahWorkspace(workspaceId);
  const { data, error } = await (supabaseAdmin as any)
    .from("campaign_reports")
    .select("*")
    .eq("workspace_id", workspaceId)
    .in("report_type", ["failed", "safety_blocked", "no_eligible_leads", "provider_error", "workflow_error"])
    .order("created_at", { ascending: false })
    .limit(Math.min(limit, 50));
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * Plain async summary for executive surfaces (SystemMind / HiveMind /
 * AccountsMind / GrowthMind context builders) — NOT a server fn.
 */
export async function getCampaignReportsSummary(workspaceId: string) {
  if (isWbahWorkspaceId(workspaceId)) {
    return { windowDays: 30, totalReports: 0, countsByType: {}, recentFailures: [], latest: [] };
  }
  const sb = supabaseAdmin as any;
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const { data } = await sb
    .from("campaign_reports")
    .select("report_type, campaign_name, report_summary, kpi_json, failure_reason, created_at")
    .eq("workspace_id", workspaceId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(100);
  const rows: any[] = data ?? [];
  const byType: Record<string, number> = {};
  for (const r of rows) byType[r.report_type] = (byType[r.report_type] ?? 0) + 1;
  const failures = rows.filter((r) => isFailureReportType(r.report_type)).slice(0, 10);
  return {
    windowDays: 30,
    totalReports: rows.length,
    countsByType: byType,
    recentFailures: failures.map((r) => ({
      type: r.report_type,
      campaign: r.campaign_name,
      summary: r.report_summary,
      reason: r.failure_reason,
      at: r.created_at,
    })),
    latest: rows.slice(0, 5).map((r) => ({
      type: r.report_type,
      campaign: r.campaign_name,
      summary: r.report_summary,
      at: r.created_at,
    })),
  };
}
