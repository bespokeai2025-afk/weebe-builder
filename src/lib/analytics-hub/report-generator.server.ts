/**
 * Analytics Hub — report generator (server-only, plain async).
 *
 * `generateAnalyticsReport` builds a metrics/insights/recommendations snapshot
 * for a workspace + report type and inserts an `analytics_reports` row.
 *
 * INVARIANTS (spec §14/§15/§23):
 *   • Observational only — NEVER mutates campaigns / leads / calls / workflows.
 *   • NEVER throws to callers: on any failure it logs and returns null. The
 *     campaign-lifecycle hook depends on this so report generation can never
 *     break campaign execution.
 *   • Workspace-scoped: every query filters by workspace_id. WBAH is isolated —
 *     campaign-lifecycle report kinds are refused for WBAH workspaces.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isWbahWorkspaceId } from "@/lib/wbah-exclusion.shared";
import { computeCampaignKpis } from "@/lib/campaign-reports/report-writer.shared";

type Sb = any;

export type AnalyticsReportType =
  | "campaign_launch"
  | "campaign_failure"
  | "campaign_completion"
  | "campaign_kpi"
  | "daily_campaign_summary"
  | "weekly_workspace"
  | "monthly_roi"
  | "agent_performance"
  | "lead_source"
  | "workflow_failure"
  | "follow_up_performance"
  | "accountsmind_cost"
  | "hivemind_briefing"
  | "growthmind_improvement"
  | "systemmind_fix"
  | "wbah_dialler_summary"
  | "wbah_campaign_start"
  | "wbah_campaign_end";

export const ANALYTICS_REPORT_TYPES: readonly AnalyticsReportType[] = [
  "campaign_launch",
  "campaign_failure",
  "campaign_completion",
  "campaign_kpi",
  "daily_campaign_summary",
  "weekly_workspace",
  "monthly_roi",
  "agent_performance",
  "lead_source",
  "workflow_failure",
  "follow_up_performance",
  "accountsmind_cost",
  "hivemind_briefing",
  "growthmind_improvement",
  "systemmind_fix",
  "wbah_dialler_summary",
  "wbah_campaign_start",
  "wbah_campaign_end",
];

/** Report kinds that only make sense for the WBAH workspace. */
export const WBAH_ONLY_REPORT_TYPES: ReadonlySet<AnalyticsReportType> = new Set([
  "wbah_dialler_summary",
  "wbah_campaign_start",
  "wbah_campaign_end",
]);

/** Campaign-lifecycle report kinds — excluded for WBAH workspaces. */
const CAMPAIGN_LIFECYCLE_TYPES: ReadonlySet<AnalyticsReportType> = new Set([
  "campaign_launch",
  "campaign_failure",
  "campaign_completion",
  "campaign_kpi",
  "daily_campaign_summary",
]);

export function isCampaignLifecycleReportType(t: AnalyticsReportType): boolean {
  return CAMPAIGN_LIFECYCLE_TYPES.has(t);
}

export type ReportGenerator =
  | "system"
  | "systemmind"
  | "hivemind"
  | "growthmind"
  | "accountsmind"
  | "user";

export interface GenerateAnalyticsReportArgs {
  workspaceId: string;
  reportType: AnalyticsReportType;
  name?: string | null;
  relatedCampaignId?: string | null;
  relatedAgentId?: string | null;
  relatedWorkflowId?: string | null;
  /** "today"|"yesterday"|"7d"|"30d"|"this_month"|"last_month"|"custom" */
  dateFilter?: string | null;
  dateRangeStart?: string | null;
  dateRangeEnd?: string | null;
  generatedBy?: ReportGenerator;
  createdByUserId?: string | null;
  status?: "draft" | "generated";
  failureReason?: string | null;
  errorMessage?: string | null;
  extraMetrics?: Record<string, unknown>;
}

// ── Date range resolution (mirrors filterToDates pattern) ────────────────────

export function resolveReportDateRange(
  dateFilter?: string | null,
  startIso?: string | null,
  endIso?: string | null,
): { startIso: string; endIso: string; label: string } {
  const now = new Date();
  const end = new Date(now);
  const start = new Date(now);
  const label = dateFilter ?? "30d";

  const startOfDay = (d: Date) => {
    const x = new Date(d);
    x.setUTCHours(0, 0, 0, 0);
    return x;
  };
  const endOfDay = (d: Date) => {
    const x = new Date(d);
    x.setUTCHours(23, 59, 59, 999);
    return x;
  };

  switch (dateFilter) {
    case "today":
      return { startIso: startOfDay(now).toISOString(), endIso: endOfDay(now).toISOString(), label };
    case "yesterday": {
      const y = new Date(now);
      y.setUTCDate(y.getUTCDate() - 1);
      return { startIso: startOfDay(y).toISOString(), endIso: endOfDay(y).toISOString(), label };
    }
    case "7d":
      start.setUTCDate(start.getUTCDate() - 7);
      return { startIso: start.toISOString(), endIso: end.toISOString(), label };
    case "this_month": {
      const s = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0));
      return { startIso: s.toISOString(), endIso: end.toISOString(), label };
    }
    case "last_month": {
      const s = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1, 0, 0, 0));
      const e = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59));
      return { startIso: s.toISOString(), endIso: e.toISOString(), label };
    }
    case "custom":
      if (startIso && endIso) return { startIso, endIso, label };
      break;
    case "30d":
    default:
      break;
  }
  start.setUTCDate(start.getUTCDate() - 30);
  return { startIso: start.toISOString(), endIso: end.toISOString(), label: label ?? "30d" };
}

// ── Content builders ─────────────────────────────────────────────────────────

type ReportContent = {
  defaultName: string;
  summary: string;
  metrics: Record<string, unknown>;
  insights: Array<{ title: string; detail: string }>;
  recommendations: Array<{ action: string; detail?: string }>;
};

/** Base workspace snapshot — bounded counts, never orders big tables. */
async function snapshotWorkspace(
  sb: Sb,
  workspaceId: string,
  startIso: string,
  endIso: string,
): Promise<Record<string, unknown>> {
  const snap: Record<string, unknown> = {};
  const wbah = isWbahWorkspaceId(workspaceId);
  try {
    if (!wbah) {
      const { count: leadsTotal } = await sb
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId);
      const { count: newLeads } = await sb
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .gte("created_at", startIso)
        .lte("created_at", endIso);
      const { count: qualified } = await sb
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .eq("qualification_status", "qualified");
      snap.leads_total = leadsTotal ?? 0;
      snap.leads_new = newLeads ?? 0;
      snap.leads_qualified = qualified ?? 0;
    }

    const callsTable = wbah ? "wbah_calls" : "calls";
    const { data: calls } = await sb
      .from(callsTable)
      .select("call_status, sentiment, is_voicemail, duration_seconds, cost_cents, created_at")
      .eq("workspace_id", workspaceId)
      .gte("created_at", startIso)
      .lte("created_at", endIso)
      .limit(1000);
    const rows: any[] = calls ?? [];
    const answered = rows.filter((r) => r.call_status === "completed" && !r.is_voicemail);
    snap.calls_total = rows.length;
    snap.calls_connected = answered.length;
    snap.calls_voicemail = rows.filter((r) => r.is_voicemail).length;
    snap.calls_failed = rows.filter((r) => r.call_status === "failed").length;
    snap.sentiment_positive = rows.filter((r) => r.sentiment === "positive").length;
    snap.sentiment_neutral = rows.filter((r) => r.sentiment === "neutral").length;
    snap.sentiment_negative = rows.filter((r) => r.sentiment === "negative").length;
    const durations = rows.map((r) => r.duration_seconds ?? 0).filter((d) => d > 0);
    snap.avg_duration_seconds =
      durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
    snap.total_cost_cents = rows.reduce((a, r) => a + (r.cost_cents ?? 0), 0);

    if (!wbah) {
      const { count: bookings } = await sb
        .from("calendar_bookings")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .gte("created_at", startIso)
        .lte("created_at", endIso);
      snap.bookings = bookings ?? 0;
    }
  } catch (err: any) {
    snap.snapshot_error = err?.message ?? "snapshot unavailable";
  }
  return snap;
}

async function buildReportContent(
  sb: Sb,
  args: GenerateAnalyticsReportArgs,
  startIso: string,
  endIso: string,
): Promise<ReportContent> {
  const { workspaceId, reportType } = args;
  const base = await snapshotWorkspace(sb, workspaceId, startIso, endIso);
  const metrics: Record<string, unknown> = {
    ...base,
    date_range_start: startIso,
    date_range_end: endIso,
    ...(args.extraMetrics ?? {}),
  };
  const insights: Array<{ title: string; detail: string }> = [];
  const recommendations: Array<{ action: string; detail?: string }> = [];
  let defaultName = "Workspace Report";
  let summary = "";

  // Campaign-scoped enrichment.
  if (args.relatedCampaignId && !isWbahWorkspaceId(workspaceId)) {
    try {
      const { data: campaign } = await sb
        .from("campaigns")
        .select("id, name, status, agent_id, created_at")
        .eq("id", args.relatedCampaignId)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (campaign) {
        metrics.campaign_name = campaign.name;
        metrics.campaign_status = campaign.status;
        let retellAgentId: string | null = null;
        if (campaign.agent_id) {
          const { data: agent } = await sb
            .from("agents")
            .select("name, retell_agent_id, settings")
            .eq("id", campaign.agent_id)
            .maybeSingle();
          metrics.agent_name = agent?.name ?? null;
          const settings = (agent?.settings ?? {}) as Record<string, unknown>;
          retellAgentId =
            (settings.deployedRetellAgentId as string | undefined) ?? agent?.retell_agent_id ?? null;
        }
        const kpis = await computeCampaignKpis(sb, workspaceId, {
          agentId: retellAgentId,
          sinceIso: campaign.created_at ?? startIso,
        });
        metrics.campaign_kpis = kpis;

        // Recent campaign_reports (incl. failure diagnostics).
        const { data: creports } = await sb
          .from("campaign_reports")
          .select("report_type, report_summary, failure_reason, created_at")
          .eq("workspace_id", workspaceId)
          .eq("campaign_id", args.relatedCampaignId)
          .order("created_at", { ascending: false })
          .limit(10);
        metrics.recent_campaign_reports = creports ?? [];
      }
    } catch (err: any) {
      metrics.campaign_enrichment_error = err?.message ?? "campaign enrichment unavailable";
    }
  }

  switch (reportType) {
    case "campaign_launch":
      defaultName = `Campaign Launch Report — ${metrics.campaign_name ?? "Campaign"}`;
      summary = `Launch report for ${metrics.campaign_name ?? "campaign"}.`;
      break;
    case "campaign_failure":
      defaultName = `Campaign Failure Report — ${metrics.campaign_name ?? "Campaign"}`;
      summary = `Failure report${args.failureReason ? `: ${args.failureReason}` : "."}`;
      if (args.failureReason) metrics.failure_reason = args.failureReason;
      if (args.errorMessage) metrics.error_message = args.errorMessage;
      recommendations.push({
        action: "Diagnose the failure via SystemMind",
        detail: "Open the campaign report in SystemMind to draft a fix (approval required).",
      });
      break;
    case "campaign_completion":
      defaultName = `Campaign Completion Report — ${metrics.campaign_name ?? "Campaign"}`;
      summary = `Completion report for ${metrics.campaign_name ?? "campaign"}.`;
      break;
    case "campaign_kpi":
      defaultName = `Campaign KPI Report — ${metrics.campaign_name ?? "Campaign"}`;
      summary = `KPI summary for ${metrics.campaign_name ?? "campaign"}.`;
      break;
    case "daily_campaign_summary":
      defaultName = "Daily Campaign Summary";
      summary = `Daily campaign summary (${base.calls_total ?? 0} calls).`;
      break;
    case "weekly_workspace":
      defaultName = "Weekly Workspace Report";
      summary = `Weekly workspace performance (${base.leads_new ?? 0} new leads, ${base.calls_total ?? 0} calls).`;
      break;
    case "monthly_roi":
      defaultName = "Monthly ROI Report";
      summary = "Monthly ROI and cost overview.";
      break;
    case "agent_performance": {
      defaultName = "Agent Performance Report";
      summary = "Per-agent call outcomes and sentiment.";
      try {
        const { data: calls } = await sb
          .from("calls")
          .select("agent_id, agent_name, call_status, sentiment, is_voicemail, duration_seconds")
          .eq("workspace_id", workspaceId)
          .gte("created_at", startIso)
          .lte("created_at", endIso)
          .limit(1000);
        const byAgent: Record<string, any> = {};
        for (const c of calls ?? []) {
          const key = c.agent_name ?? c.agent_id ?? "unknown";
          const a = (byAgent[key] ??= { agent: key, total: 0, connected: 0, positive: 0, negative: 0 });
          a.total++;
          if (c.call_status === "completed" && !c.is_voicemail) a.connected++;
          if (c.sentiment === "positive") a.positive++;
          if (c.sentiment === "negative") a.negative++;
        }
        metrics.agents = Object.values(byAgent);
      } catch (err: any) {
        metrics.agents_error = err?.message ?? "agent aggregation unavailable";
      }
      break;
    }
    case "lead_source": {
      defaultName = "Lead Source Report";
      summary = "Performance grouped by lead source.";
      if (!isWbahWorkspaceId(workspaceId)) {
        try {
          const { data: leads } = await sb
            .from("leads")
            .select("source, qualification_status")
            .eq("workspace_id", workspaceId)
            .gte("created_at", startIso)
            .lte("created_at", endIso)
            .limit(1000);
          const bySource: Record<string, any> = {};
          for (const l of leads ?? []) {
            const key = l.source ?? "unknown";
            const s = (bySource[key] ??= { source: key, count: 0, qualified: 0 });
            s.count++;
            if (l.qualification_status === "qualified") s.qualified++;
          }
          metrics.sources = Object.values(bySource);
        } catch (err: any) {
          metrics.sources_error = err?.message ?? "source aggregation unavailable";
        }
      }
      break;
    }
    case "workflow_failure":
      defaultName = "Workflow Failure Report";
      summary = "Workflow trigger/success/failure overview.";
      break;
    case "follow_up_performance":
      defaultName = "Follow-up Performance Report";
      summary = "Follow-up creation, completion and outcomes.";
      break;
    case "accountsmind_cost":
      defaultName = "AccountsMind Cost Report";
      summary = "Cost, revenue and ROI overview.";
      break;
    case "hivemind_briefing":
      defaultName = "HiveMind Executive Briefing";
      summary = "Executive briefing across workspace performance.";
      break;
    case "growthmind_improvement":
      defaultName = "GrowthMind Campaign Improvement Report";
      summary = "Marketing / conversion improvement opportunities.";
      break;
    case "wbah_dialler_summary": {
      defaultName = "WBAH Dialler Summary";
      summary = "WeeBespoke dialler activity — successful calls & KPIs.";
      try {
        const { getWbahDiallerAnalytics } = await import(
          "@/lib/analytics-hub/analytics-hub.server"
        );
        const days = Math.max(
          1,
          Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 86_400_000),
        );
        const w: any = await getWbahDiallerAnalytics(sb, workspaceId, {
          startIso,
          endIso,
          filter: args.dateFilter ?? "custom",
          days,
        } as any);
        metrics.calls_dialled = w.total;
        metrics.calls_connected = w.connected;
        metrics.connection_rate_pct = w.connectionRate;
        metrics.voicemail_hits = w.voicemail;
        metrics.voicemail_rate_pct = w.voicemailRate;
        metrics.booked = w.booked;
        metrics.sentiment_positive = w.sentiment?.positive ?? 0;
        metrics.sentiment_neutral = w.sentiment?.neutral ?? 0;
        metrics.sentiment_negative = w.sentiment?.negative ?? 0;
        metrics.converted_positive_leads = (w.converted ?? []).length;
        if (Array.isArray(w.campaigns) && w.campaigns.length > 0) {
          metrics.campaigns = w.campaigns;
          if (w.campaignsUnattributed > 0) {
            metrics.campaigns_unattributed_calls = w.campaignsUnattributed;
          }
          for (const camp of w.campaigns) {
            insights.push({
              title: `Campaign: ${camp.name}${camp.scheduledTime ? ` (${camp.scheduledTime} UK)` : ""}`,
              detail:
                `${camp.calls} calls, ${camp.connected} connected (${camp.connectionRate}%), ` +
                `${camp.positive} positive, ${camp.booked} booked, ${camp.voicemail} voicemails` +
                (camp.leadStatus ? ` — targets "${camp.leadStatus}" leads.` : "."),
            });
          }
        }
        if (w.truncated) metrics.data_truncated = true;
        summary = `${w.total} calls dialled, ${w.connected} connected (${w.connectionRate}%), ${(w.converted ?? []).length} positive-sentiment leads, ${w.booked} booked, ${w.voicemail} voicemails.`;

        for (const r of (w.reasons ?? []).slice(0, 5)) {
          insights.push({
            title: `Disconnection: ${String(r.reason).replace(/_/g, " ")}`,
            detail: `${r.count} calls (${r.pct}% of dials).`,
          });
        }
        for (const c of (w.converted ?? []).slice(0, 15)) {
          insights.push({
            title: `Converted lead: ${c.name}`,
            detail: `${c.phone ?? "no phone"}${c.booked ? ` — BOOKED${c.appointmentDate ? ` (${c.appointmentDate})` : ""}` : ""}`,
          });
        }
        const neg = Number(w.sentiment?.negative ?? 0);
        if (neg > 0) {
          recommendations.push({
            action: "Review negative-sentiment calls",
            detail: `${neg} call(s) ended with negative sentiment — check the Campaigns tab for the full list.`,
          });
        }
      } catch (err: any) {
        metrics.wbah_dialler_error = err?.message ?? "dialler aggregation unavailable";
      }
      break;
    }
    case "wbah_campaign_start": {
      const cName = String(args.extraMetrics?.campaign_name ?? "Dialler campaign");
      const slot = args.extraMetrics?.scheduled_time_london;
      const target = args.extraMetrics?.target_lead_status;
      defaultName = `Campaign Started — ${cName}`;
      summary =
        `WeeBespoke dialler campaign "${cName}" started its scheduled run` +
        (slot ? ` (${slot} UK time)` : "") +
        (target ? `, targeting "${target}" leads` : "") +
        ". A finish report with full KPIs will follow when dialling completes.";
      insights.push({
        title: "Run started",
        detail: `Agent ${args.extraMetrics?.campaign_agent_id ?? "unknown"} is dialling now. KPIs are reported when the run finishes.`,
      });
      break;
    }
    case "wbah_campaign_end": {
      const cName = String(args.extraMetrics?.campaign_name ?? "Dialler campaign");
      const em = (args.extraMetrics ?? {}) as Record<string, any>;
      defaultName = `Campaign Finished — ${cName}`;
      summary =
        `WeeBespoke dialler campaign "${cName}" finished: ` +
        `${em.calls_dialled ?? 0} calls dialled, ${em.calls_connected ?? 0} connected (${em.connection_rate_pct ?? 0}%), ` +
        `${em.sentiment_positive ?? 0} positive, ${em.booked ?? 0} booked, ${em.voicemail_hits ?? 0} voicemails.`;
      if (em.run_ended_by === "time_cap") {
        insights.push({
          title: "Run closed by time cap",
          detail: "No quiet period was detected within 3 hours — the run was closed at the cap. KPIs cover all attributed calls in the window.",
        });
      }
      for (const l of (Array.isArray(em.positive_leads) ? em.positive_leads : []).slice(0, 15)) {
        insights.push({
          title: `Positive lead: ${l.name ?? "Unknown"}`,
          detail: `${l.phone ?? "no phone"}${l.booked ? " — BOOKED" : ""}`,
        });
      }
      const negEnd = Number(em.sentiment_negative ?? 0);
      if (negEnd > 0) {
        recommendations.push({
          action: "Review negative-sentiment calls from this run",
          detail: `${negEnd} call(s) in this run ended with negative sentiment.`,
        });
      }
      if (Number(em.calls_dialled ?? 0) === 0) {
        insights.push({
          title: "No calls attributed to this run",
          detail: "The dialler placed no calls in this campaign's window (empty lead pool, or the dialler was paused).",
        });
      }
      break;
    }
    case "systemmind_fix":
      defaultName = "SystemMind Fix Report";
      summary = "Detected issues and suggested fixes (drafts only).";
      break;
    default:
      defaultName = "Workspace Report";
      summary = "Workspace analytics report.";
  }

  // Generic overview insights.
  const callsTotal = Number(base.calls_total ?? 0);
  if (callsTotal > 0) {
    const connected = Number(base.calls_connected ?? 0);
    insights.push({
      title: "Connection rate",
      detail: `${connected}/${callsTotal} calls connected (${Math.round((connected / callsTotal) * 100)}%).`,
    });
    const negative = Number(base.sentiment_negative ?? 0);
    if (negative > 0) {
      insights.push({
        title: "Negative sentiment present",
        detail: `${negative} call(s) had negative sentiment in this period.`,
      });
    }
  }

  return { defaultName, summary, metrics, insights, recommendations };
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate and store an analytics report. NEVER throws — returns the new row id
 * or null on failure (so lifecycle hooks can be fire-and-forget).
 */
export async function generateAnalyticsReport(
  args: GenerateAnalyticsReportArgs,
): Promise<string | null> {
  try {
    if (!args.workspaceId) return null;
    // WBAH isolation: campaign-lifecycle report kinds are refused for WBAH.
    if (isWbahWorkspaceId(args.workspaceId) && isCampaignLifecycleReportType(args.reportType)) {
      return null;
    }
    // WBAH-only report kinds are refused for every other workspace.
    if (WBAH_ONLY_REPORT_TYPES.has(args.reportType) && !isWbahWorkspaceId(args.workspaceId)) {
      return null;
    }
    const sb = supabaseAdmin as any;
    const { startIso, endIso } = resolveReportDateRange(
      args.dateFilter,
      args.dateRangeStart,
      args.dateRangeEnd,
    );
    const content = await buildReportContent(sb, args, startIso, endIso);

    const { data, error } = await sb
      .from("analytics_reports")
      .insert({
        workspace_id: args.workspaceId,
        report_type: args.reportType,
        report_name: args.name ?? content.defaultName,
        report_status: args.status ?? "generated",
        related_campaign_id: args.relatedCampaignId ?? null,
        related_agent_id: args.relatedAgentId ?? null,
        related_workflow_id: args.relatedWorkflowId ?? null,
        date_range_start: startIso,
        date_range_end: endIso,
        report_summary: content.summary,
        metrics_json: content.metrics,
        insights_json: content.insights,
        recommendations_json: content.recommendations,
        generated_by: args.generatedBy ?? "system",
        created_by_user_id: args.createdByUserId ?? null,
      })
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("[analytics-hub] report insert failed (non-fatal):", error.message);
      return null;
    }
    return data?.id ?? null;
  } catch (err: any) {
    console.error("[analytics-hub] generateAnalyticsReport failed (non-fatal):", err?.message ?? err);
    return null;
  }
}

/** Map a campaign lifecycle report type → analytics report type (for the hook). */
export function campaignLifecycleToAnalyticsType(
  lifecycleType: string,
): AnalyticsReportType | null {
  switch (lifecycleType) {
    case "activated":
      return "campaign_launch";
    case "completed":
      return "campaign_completion";
    case "kpi_summary":
    case "run_summary":
      return "campaign_kpi";
    case "failed":
    case "safety_blocked":
    case "no_eligible_leads":
    case "provider_error":
    case "workflow_error":
      return "campaign_failure";
    default:
      return null;
  }
}
