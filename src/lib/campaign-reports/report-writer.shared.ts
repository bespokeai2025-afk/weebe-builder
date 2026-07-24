/**
 * Campaign report writer — pure functions that take a Supabase client, so the
 * campaign executor (Vite-plugin context, relative imports only) and normal
 * server code can both use them.
 *
 * INVARIANTS (spec — do not weaken):
 *   • Reports are OBSERVATIONAL ONLY. Nothing here mutates campaigns, leads,
 *     calls or workflows. Writes go to campaign_reports (+ optional
 *     hivemind_tasks notification + audit log row).
 *   • Report generation must NEVER break the caller — use safeWriteCampaignReport,
 *     which swallows and logs every error.
 */

import { isWbahWorkspaceId } from "../wbah-exclusion.shared";
import { emitCampaignNotification } from "../notifications/notification-engine.shared";

type Sb = any;

export type CampaignReportType =
  | "activated" | "failed" | "completed" | "paused" | "cancelled" | "retried"
  | "kpi_summary" | "run_summary" | "safety_blocked" | "no_eligible_leads"
  | "provider_error" | "workflow_error";

export type CampaignReportInput = {
  workspaceId: string;
  campaignId?: string | null;
  agentId?: string | null;
  workflowId?: string | null;
  reportType: CampaignReportType;
  campaignStatus?: string | null;
  campaignName?: string | null;
  agentName?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  summary?: string | null;
  kpis?: Record<string, unknown>;
  failureReason?: string | null;
  failureStage?: string | null;
  errorMessage?: string | null;
  recommendedActions?: Array<{ action: string; detail?: string }>;
  createdBySystemMind?: boolean;
  userId?: string | null;
};

const FAILURE_TYPES: ReadonlySet<string> = new Set([
  "failed", "safety_blocked", "no_eligible_leads", "provider_error", "workflow_error",
]);

export function isFailureReportType(t: string): boolean {
  return FAILURE_TYPES.has(t);
}

/** Best-effort KPI snapshot from the calls table for a campaign's agent/window. */
export async function computeCampaignKpis(
  sb: Sb,
  workspaceId: string,
  opts: { agentId?: string | null; sinceIso?: string | null; extra?: Record<string, unknown> },
): Promise<Record<string, unknown>> {
  const kpis: Record<string, unknown> = { ...(opts.extra ?? {}) };
  try {
    let q = sb
      .from("calls")
      .select("call_status, sentiment, is_voicemail, duration_seconds, cost_cents")
      .eq("workspace_id", workspaceId)
      .limit(1000);
    if (opts.agentId) q = q.eq("agent_id", opts.agentId);
    if (opts.sinceIso) q = q.gte("created_at", opts.sinceIso);
    const { data } = await q;
    const rows: any[] = data ?? [];
    const answered = rows.filter((r) => r.call_status === "completed" && !r.is_voicemail);
    const positive = rows.filter((r) => r.sentiment === "positive");
    const durations = rows.map((r) => r.duration_seconds ?? 0).filter((d) => d > 0);
    kpis.calls_total = rows.length;
    kpis.calls_answered = answered.length;
    kpis.calls_voicemail = rows.filter((r) => r.is_voicemail).length;
    kpis.calls_failed = rows.filter((r) => r.call_status === "failed").length;
    kpis.positive_sentiment = positive.length;
    kpis.answer_rate = rows.length > 0 ? Math.round((answered.length / rows.length) * 100) / 100 : 0;
    kpis.avg_duration_seconds = durations.length > 0
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0;
    kpis.total_cost_cents = rows.reduce((a, r) => a + (r.cost_cents ?? 0), 0);
  } catch {
    kpis.kpi_error = "KPI computation unavailable";
  }
  return kpis;
}

function defaultSummary(input: CampaignReportInput): string {
  const name = input.campaignName ?? "Campaign";
  switch (input.reportType) {
    case "activated": return `${name} was activated.`;
    case "paused": return `${name} was paused.`;
    case "completed": return `${name} completed.`;
    case "cancelled": return `${name} was cancelled.`;
    case "retried": return `${name} was retried.`;
    case "failed": return `${name} failed${input.failureReason ? `: ${input.failureReason}` : "."}`;
    case "run_summary": return `${name} run finished.`;
    case "kpi_summary": return `KPI summary for ${name}.`;
    case "safety_blocked": return `${name} run was blocked by safety rules${input.failureReason ? `: ${input.failureReason}` : "."}`;
    case "no_eligible_leads": return `${name} ran but found no eligible leads to contact.`;
    case "provider_error": return `${name} hit a provider error${input.errorMessage ? `: ${input.errorMessage}` : "."}`;
    case "workflow_error": return `${name} hit a workflow error${input.errorMessage ? `: ${input.errorMessage}` : "."}`;
    default: return `${name}: ${input.reportType}`;
  }
}

function defaultRecommendedActions(input: CampaignReportInput): Array<{ action: string; detail?: string }> {
  switch (input.reportType) {
    case "no_eligible_leads":
      return [
        { action: "Review the campaign's filter", detail: "The attached filter or status criteria may be too narrow, or all matching leads were already contacted today." },
        { action: "Check lead supply", detail: "Confirm new leads are arriving with phone numbers." },
      ];
    case "provider_error":
      return [
        { action: "Check the voice provider connection", detail: "Verify the Retell API key and agent deployment for this workspace." },
      ];
    case "safety_blocked":
      return [
        { action: "Review safety exclusions", detail: "Booked, opted-out or daily-cap rules blocked this run. This is usually correct behaviour." },
      ];
    case "failed":
    case "workflow_error":
      return [
        { action: "Ask SystemMind to diagnose this failure", detail: "SystemMind can read this report and propose a fix draft for approval." },
      ];
    default:
      return [];
  }
}

/**
 * Writes a campaign report row (+ failure notification task). THROWS on error —
 * use safeWriteCampaignReport from lifecycle hooks.
 */
export async function writeCampaignReport(sb: Sb, input: CampaignReportInput): Promise<string | null> {
  if (!input.workspaceId) throw new Error("workspaceId required");
  // WBAH is fully excluded from the campaign-reports system.
  if (isWbahWorkspaceId(input.workspaceId)) return null;

  const summary = input.summary ?? defaultSummary(input);
  const recommended = input.recommendedActions ?? defaultRecommendedActions(input);

  const { data, error } = await sb
    .from("campaign_reports")
    .insert({
      workspace_id: input.workspaceId,
      campaign_id: input.campaignId ?? null,
      agent_id: input.agentId ?? null,
      workflow_id: input.workflowId ?? null,
      report_type: input.reportType,
      campaign_status: input.campaignStatus ?? null,
      campaign_name: input.campaignName ?? null,
      agent_name: input.agentName ?? null,
      started_at: input.startedAt ?? null,
      ended_at: input.endedAt ?? null,
      report_summary: summary.slice(0, 4000),
      kpi_json: input.kpis ?? {},
      failure_reason: input.failureReason?.slice(0, 2000) ?? null,
      failure_stage: input.failureStage?.slice(0, 200) ?? null,
      error_message: input.errorMessage?.slice(0, 2000) ?? null,
      recommended_actions_json: recommended,
      created_by_system: true,
      created_by_systemmind: input.createdBySystemMind ?? false,
    })
    .select("id")
    .single();
  if (error) throw new Error(`campaign_reports insert failed: ${error.message}`);
  const reportId = data.id as string;

  // Audit trail (best-effort — audit failure must not fail the report).
  try {
    await sb.from("workspace_view_audit_logs").insert({
      workspace_id: input.workspaceId,
      user_id: input.userId ?? null,
      object_type: "campaign_report",
      object_id: reportId,
      action_type: "create",
      after_state: { report_type: input.reportType, campaign_id: input.campaignId ?? null, summary },
      risk_level: "low",
    });
  } catch { /* non-fatal */ }

  // Failure notification → HiveMind task (visible in the action centre).
  if (isFailureReportType(input.reportType)) {
    try {
      const { assertProposalAllowed } = await import("@/lib/hivemind/mode-gate.server");
      await assertProposalAllowed(sb, input.workspaceId);
      await sb.from("hivemind_tasks").insert({
        workspace_id: input.workspaceId,
        title: `Campaign issue: ${input.campaignName ?? "campaign"} — ${input.reportType.replace(/_/g, " ")}`,
        description: `${summary}\n\nSee the campaign report for KPIs and recommended actions (report ${reportId}).`,
        status: "suggested",
        priority: input.reportType === "failed" || input.reportType === "provider_error" ? "high" : "medium",
        source: "campaign_reports",
        trigger_type: `campaign_report_${input.reportType}`,
        entity_type: "campaign_report",
        entity_id: reportId,
      });
    } catch { /* non-fatal */ }
  }

  // Campaign notification (in-app + email per workspace settings). Best-effort:
  // emitCampaignNotification never throws, so it can never break the caller.
  const eventKey = reportTypeToNotificationEvent(input);
  if (eventKey) {
    await emitCampaignNotification(sb, {
      workspaceId: input.workspaceId,
      eventKey,
      campaignId: input.campaignId ?? null,
      reportId,
      campaignName: input.campaignName ?? null,
      campaignStatus: input.campaignStatus ?? null,
      summary,
      kpis: input.kpis ?? null,
      failureReason: input.failureReason ?? input.errorMessage ?? null,
      recommendedAction: recommended[0]?.action ?? null,
    });
  }

  return reportId;
}

/**
 * Map a campaign report type onto a notification event key. run_summary is
 * only notified when the whole run was blocked by the daily call cap.
 */
function reportTypeToNotificationEvent(input: CampaignReportInput): string | null {
  switch (input.reportType) {
    case "activated": return "activated";
    case "paused": return "paused";
    case "completed": return "completed";
    case "cancelled": return "paused";
    case "failed": return "failed";
    case "safety_blocked": {
      const kpis = input.kpis ?? {};
      const skippedByCap = Number((kpis as any).skipped_by_cap ?? 0);
      const matched = Number((kpis as any).records_matched ?? 0);
      return skippedByCap > 0 && skippedByCap >= matched ? "daily_cap_hit" : "safety_blocked";
    }
    case "no_eligible_leads": return "no_eligible_leads";
    case "provider_error": return "provider_error";
    case "workflow_error": return "workflow_error";
    case "kpi_summary": return "kpi_report_ready";
    case "run_summary": return null; // routine — not notified
    case "retried": return null;
    default: return null;
  }
}

/** Never throws — lifecycle hooks must never break campaign execution. */
export async function safeWriteCampaignReport(sb: Sb, input: CampaignReportInput): Promise<string | null> {
  try {
    return await writeCampaignReport(sb, input);
  } catch (err: any) {
    console.error("[campaign-reports] report write failed (non-fatal):", err?.message ?? err);
    return null;
  }
}
