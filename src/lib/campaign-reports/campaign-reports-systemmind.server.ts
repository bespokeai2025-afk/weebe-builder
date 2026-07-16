// ── SystemMind Campaign-Report intelligence — server-only ───────────────────
// Read + explain campaign reports, diagnose failures, compare campaigns, and
// draft fixes. Reports are NEVER mutated here; a fix is a hub draft
// (systemmind_generated_actions, kind "campaign_fix") that only applies a
// WHITELISTED schedule-config patch after HiveMind approval.
//
// Safety invariants (do not weaken):
//   • workspace_id comes ONLY from server context.
//   • Fix drafts can ONLY patch: callTime, timezone, callFrequency,
//     intervalDays, campaignFilterId. Never status, agent, targets or leads.
//   • Activation re-validates the patch and the campaign's workspace before
//     applying, and writes an audit row.

import { z } from "zod";
import { assertNotWbahWorkspace } from "@/lib/wbah-exclusion.shared";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { routeGenerate } from "@/lib/growthmind/model-router.server";
import {
  writeSystemMindAudit,
  isClaudeEnabled,
} from "@/lib/systemmind/systemmind-automation.server";
import { getCampaignReport, listCampaignReports, getCampaignReportsSummary } from "./campaign-reports.server";
import { parseConfig, encodeConfig, type ScheduleConfig } from "@/lib/campaign-scheduler/executor";

type Sb = any;

function routedArgs(workspaceId: string, sb: Sb) {
  const claudeEnabled = isClaudeEnabled();
  return {
    contentType: "systemmind_automation",
    mode: "manual" as const,
    provider: claudeEnabled ? ("claude" as const) : ("openai" as const),
    model: claudeEnabled ? ("claude-sonnet-4-5" as const) : ("gpt-4.1" as const),
    settings: {},
    workspaceId,
    sb,
  };
}

// ── Read/explain (no drafts, no writes beyond audit) ────────────────────────

export async function explainCampaignReport(args: {
  workspaceId: string;
  userId: string | null;
  reportId: string;
}): Promise<{ explanation: string; report: any }> {
  assertNotWbahWorkspace(args.workspaceId);
  const report = await getCampaignReport(args.workspaceId, args.reportId);
  const routed = await routeGenerate({
    system:
      "You are SystemMind, WEBEE's CTO executive. Explain this campaign report to a non-technical business owner in plain English (max 200 words). Cover what happened, what the KPIs mean, and what (if anything) they should do. Never invent numbers.",
    user: JSON.stringify({
      type: report.report_type,
      campaign: report.campaign_name,
      summary: report.report_summary,
      kpis: report.kpi_json,
      failure_reason: report.failure_reason,
      failure_stage: report.failure_stage,
      error: report.error_message,
      recommended: report.recommended_actions_json,
    }).slice(0, 6000),
    maxTokens: 600,
    ...routedArgs(args.workspaceId, supabaseAdmin as any),
  });
  return { explanation: routed.text.trim(), report };
}

export async function diagnoseCampaignFailures(args: {
  workspaceId: string;
  userId: string | null;
  campaignId?: string | null;
}): Promise<{ diagnosis: string; reports: any[] }> {
  assertNotWbahWorkspace(args.workspaceId);
  const reports = await listCampaignReports(args.workspaceId, {
    campaignId: args.campaignId ?? null,
    limit: 20,
  });
  const failures = reports.filter((r: any) =>
    ["failed", "safety_blocked", "no_eligible_leads", "provider_error", "workflow_error"].includes(r.report_type),
  );
  if (failures.length === 0) {
  assertNotWbahWorkspace(args.workspaceId);
    return { diagnosis: "No recent failure reports found — campaigns look healthy.", reports: [] };
  }
  const routed = await routeGenerate({
    system:
      "You are SystemMind, WEBEE's CTO executive. Diagnose these campaign failure reports for a business owner. Identify the most likely root cause(s), pattern across failures, and concrete next steps (max 250 words). Never invent data.",
    user: JSON.stringify(
      failures.slice(0, 10).map((r: any) => ({
        type: r.report_type,
        campaign: r.campaign_name,
        reason: r.failure_reason,
        stage: r.failure_stage,
        error: r.error_message,
        kpis: r.kpi_json,
        at: r.created_at,
      })),
    ).slice(0, 8000),
    maxTokens: 800,
    ...routedArgs(args.workspaceId, supabaseAdmin as any),
  });
  return { diagnosis: routed.text.trim(), reports: failures };
}

export async function compareCampaignPerformance(args: {
  workspaceId: string;
  userId: string | null;
}): Promise<{ comparison: string; summary: any }> {
  assertNotWbahWorkspace(args.workspaceId);
  const summary = await getCampaignReportsSummary(args.workspaceId);
  const routed = await routeGenerate({
    system:
      "You are SystemMind, WEBEE's CTO executive. Compare recent campaign performance from this 30-day report summary for a business owner: which campaigns run cleanly, which fail, and what stands out (max 200 words). Never invent numbers.",
    user: JSON.stringify(summary).slice(0, 8000),
    maxTokens: 600,
    ...routedArgs(args.workspaceId, supabaseAdmin as any),
  });
  return { comparison: routed.text.trim(), summary };
}

// ── Fix drafts (approval-first; whitelisted patch only) ─────────────────────

const FixPatchSchema = z.object({
  callTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  timezone: z.string().max(64).optional(),
  callFrequency: z.enum(["daily", "custom"]).optional(),
  intervalDays: z.number().int().min(1).max(30).optional(),
  campaignFilterId: z.string().uuid().nullable().optional(),
}).strict();

export type CampaignFixPatch = z.infer<typeof FixPatchSchema>;

export async function createCampaignFixDraft(args: {
  workspaceId: string;
  userId: string | null;
  campaignId: string;
  reportId?: string | null;
  patch: CampaignFixPatch;
  rationale: string;
  instructedBy?: string;
}) {
  assertNotWbahWorkspace(args.workspaceId);
  const sb = supabaseAdmin as any;
  const patch = FixPatchSchema.parse(args.patch);
  if (Object.keys(patch).length === 0) throw new Error("Fix patch is empty.");

  const { data: campaign, error } = await sb
    .from("campaigns")
    .select("id, name, description, status, workspace_id")
    .eq("id", args.campaignId)
    .eq("workspace_id", args.workspaceId)
    .maybeSingle();
  if (error || !campaign) throw new Error("Campaign not found in this workspace.");
  const cfg = parseConfig(campaign.description);
  if (!cfg) throw new Error("Campaign has no scheduler config — nothing to fix.");

  if (patch.campaignFilterId) {
    const { data: filterRow } = await sb
      .from("workspace_campaign_filters")
      .select("id, status")
      .eq("id", patch.campaignFilterId)
      .eq("workspace_id", args.workspaceId)
      .maybeSingle();
    if (!filterRow || filterRow.status !== "active") {
      throw new Error("Proposed campaign filter does not exist or is not active in this workspace.");
    }
  }

  const payload = {
    kind: "campaign_fix",
    campaign_id: campaign.id,
    campaign_name: campaign.name,
    report_id: args.reportId ?? null,
    patch,
    before_config: cfg,
    rationale: args.rationale.slice(0, 2000),
  };

  const { data: draftRow, error: draftErr } = await sb.from("systemmind_generated_actions").insert({
    workspace_id: args.workspaceId,
    created_by_user_id: args.userId,
    source: "systemmind",
    instructed_by: args.instructedBy ?? "user",
    action_kind: "campaign_fix",
    title: `Fix: ${campaign.name}`,
    purpose: args.rationale.slice(0, 2000) || "SystemMind-proposed campaign schedule fix",
    payload,
    required_credentials: [],
    test_plan: ["After approval, verify the campaign's next run behaves as expected."],
    risk_level: "medium",
    risk_reasons: ["Changes when/how an automated calling campaign runs (schedule/filter only — never targets or status)."],
    approval_required: true,
    status: "draft",
  }).select("*").single();
  if (draftErr) throw new Error(`Failed to save fix draft: ${draftErr.message}`);

  await writeSystemMindAudit({
    workspaceId: args.workspaceId,
    userId: args.userId,
    instructedBy: args.instructedBy ?? "user",
    actionType: "generate_draft",
    targetType: "systemmind_generated_action",
    targetId: draftRow.id,
    proposedAfterState: { kind: "campaign_fix", campaign_id: campaign.id, patch },
    approvalStatus: "not_requested",
  });

  return { draftId: draftRow.id as string, draft: draftRow };
}

// ── Activation (dispatched from activateSystemMindAutomation) ───────────────
export async function activateCampaignFixKind(
  workspaceId: string,
  generatedActionId: string,
): Promise<{ activatedTargetType: string; activatedTargetId: string; summary: Record<string, unknown> }> {
  const sb = supabaseAdmin as any;
  const { data: draft, error } = await sb
    .from("systemmind_generated_actions")
    .select("id, payload, created_by_user_id")
    .eq("id", generatedActionId)
    .eq("workspace_id", workspaceId)
    .single();
  if (error || !draft) throw new Error("Draft not found for activation.");

  const payload = draft.payload ?? {};
  const patch = FixPatchSchema.parse(payload.patch ?? {});
  if (Object.keys(patch).length === 0) throw new Error("Fix draft has an empty patch.");
  const campaignId = String(payload.campaign_id ?? "");

  const { data: campaign, error: cErr } = await sb
    .from("campaigns")
    .select("id, name, description")
    .eq("id", campaignId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (cErr || !campaign) throw new Error("Campaign no longer exists in this workspace.");
  const cfg = parseConfig(campaign.description);
  if (!cfg) throw new Error("Campaign scheduler config missing at activation.");

  // Re-validate campaignFilterId at activation time (approval-time TOCTOU protection):
  // the filter must still exist, belong to this workspace and be active.
  if (patch.campaignFilterId) {
  assertNotWbahWorkspace(workspaceId);
    const { data: filterRow } = await sb
      .from("workspace_campaign_filters")
      .select("id, status")
      .eq("id", patch.campaignFilterId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (!filterRow || filterRow.status !== "active") {
      throw new Error("Campaign filter in this fix no longer exists or is not active — re-draft the fix.");
    }
  }

  const next: ScheduleConfig = { ...cfg };
  if (patch.callTime !== undefined) next.callTime = patch.callTime;
  if (patch.timezone !== undefined) next.timezone = patch.timezone;
  if (patch.callFrequency !== undefined) next.callFrequency = patch.callFrequency;
  if (patch.intervalDays !== undefined) next.intervalDays = patch.intervalDays;
  if (patch.campaignFilterId !== undefined) next.campaignFilterId = patch.campaignFilterId ?? undefined;

  const { error: upErr } = await sb
    .from("campaigns")
    .update({ description: encodeConfig(next), updated_at: new Date().toISOString() })
    .eq("id", campaignId)
    .eq("workspace_id", workspaceId);
  if (upErr) throw new Error(`Failed to apply fix: ${upErr.message}`);

  // Report the fix application (observational; "retried" lifecycle family).
  try {
    const { safeWriteCampaignReport } = await import("@/lib/campaign-reports/report-writer.shared");
    await safeWriteCampaignReport(sb, {
      workspaceId,
      campaignId,
      reportType: "retried",
      campaignName: campaign.name,
      summary: `SystemMind fix applied to "${campaign.name}" schedule after approval.`,
      kpis: { patch },
      createdBySystemMind: true,
    });
  } catch { /* non-fatal */ }

  return {
    activatedTargetType: "campaign",
    activatedTargetId: campaignId,
    summary: { campaign: campaign.name, patch },
  };
}
