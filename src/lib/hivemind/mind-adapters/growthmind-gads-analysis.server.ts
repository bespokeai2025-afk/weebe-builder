/**
 * GrowthMind adapter: Google Ads campaign analysis execution.
 *
 * First vertical slice of the unified work-order/execution backbone.
 * Runs a REAL analysis using the existing GrowthMind Google Ads live engine
 * (sync + analysis over growthmind_gads_* tables), stores the deliverable as
 * an execution artifact, and — when the analysis produces recommendations —
 * proposes a linked hivemind_action (gads_create_change_requests) so the
 * consequential internal change goes through the existing approval centre.
 *
 * HONESTY RULES:
 * - GrowthMind is advisory-only for live ad accounts: there is intentionally
 *   NO executor for external Google Ads writes. The external-write stage is
 *   always reported as blocked/awaiting integration — never fabricated.
 * - If no Google Ads account is connected, the execution ends `blocked`.
 * - Steps only reach `done` after the underlying call really succeeded.
 */
import {
  type ExecutionStep,
  stepUpdate,
} from "@/lib/hivemind/execution-state.shared";

export interface AdapterContext {
  sb: any;                // RLS-bound client (workspace member)
  workspaceId: string;
  userId: string;
  executionId: string;
  taskId: string;
  workOrderId: string | null;
  inputSpec: Record<string, any>;
}

export interface AdapterOutcome {
  /** Final execution status the engine should transition to. */
  status: "awaiting_action_approval" | "completed" | "blocked" | "failed";
  steps: ExecutionStep[];
  artifacts: Array<Record<string, any>>;
  result: Record<string, any> | null;
  evidence: Record<string, any> | null;
  linkedActionId: string | null;
  blockedReason: string | null;
  errorMessage: string | null;
}

const STEP_DEFS: Array<{ key: string; label: string }> = [
  { key: "resolve_account",     label: "Resolve connected Google Ads account" },
  { key: "sync_data",           label: "Refresh campaign data from Google Ads" },
  { key: "analyze",             label: "Analyse campaigns, keywords and spend" },
  { key: "compile_deliverable", label: "Compile analysis report" },
  { key: "propose_action",      label: "Propose change-request action for approval" },
  { key: "apply_external",      label: "Apply changes to Google Ads (external write)" },
];

export function initialGadsAnalysisSteps(): ExecutionStep[] {
  return STEP_DEFS.map(s => ({ ...s, status: "pending" as const }));
}

/** Persist step progress so the UI shows live, truthful progress. */
async function saveSteps(ctx: AdapterContext, steps: ExecutionStep[], currentStep: number) {
  await ctx.sb.from("mind_task_executions").update({
    steps, current_step: currentStep, updated_at: new Date().toISOString(),
  }).eq("id", ctx.executionId).eq("workspace_id", ctx.workspaceId);
}

export async function runGadsAnalysisExecution(ctx: AdapterContext): Promise<AdapterOutcome> {
  let steps = initialGadsAnalysisSteps();
  const artifacts: Array<Record<string, any>> = [];

  const fail = (msg: string): AdapterOutcome => ({
    status: "failed", steps, artifacts, result: null, evidence: null,
    linkedActionId: null, blockedReason: null, errorMessage: msg,
  });

  // 1. Resolve account ────────────────────────────────────────────────────────
  steps = stepUpdate(steps, "resolve_account", { status: "running" });
  await saveSteps(ctx, steps, 0);
  const { getGoogleAccountRow } = await import("@/lib/growthmind/gads-live-core.server");
  let account: any = null;
  try {
    account = await getGoogleAccountRow(ctx.workspaceId);
  } catch (err: any) {
    steps = stepUpdate(steps, "resolve_account", { status: "failed", detail: err?.message ?? String(err) });
    await saveSteps(ctx, steps, 0);
    return fail(`Failed to look up Google Ads connection: ${err?.message ?? String(err)}`);
  }
  if (!account?.customer_id) {
    steps = stepUpdate(steps, "resolve_account", {
      status: "blocked", detail: "No Google Ads account is connected for this workspace.",
    });
    await saveSteps(ctx, steps, 0);
    return {
      status: "blocked", steps, artifacts, result: null, evidence: null,
      linkedActionId: null,
      blockedReason: "No Google Ads account connected. Connect Google Ads in GrowthMind → Ads to run this analysis.",
      errorMessage: null,
    };
  }
  steps = stepUpdate(steps, "resolve_account", {
    status: "done",
    detail: `Account ${account.customer_id}${account.descriptive_name ? ` (${account.descriptive_name})` : ""}`,
  });
  await saveSteps(ctx, steps, 1);

  // 2. Sync fresh data (best effort — analysis can run on existing sync) ──────
  steps = stepUpdate(steps, "sync_data", { status: "running" });
  await saveSteps(ctx, steps, 1);
  let syncOutcome = "refreshed";
  try {
    const { runGadsSync } = await import("@/lib/growthmind/gads-live-core.server");
    const sync = await runGadsSync(ctx.workspaceId, account.id, "manual");
    if (!(sync as any)?.ok) {
      syncOutcome = `sync ${(sync as any)?.status ?? "failed"}: ${(sync as any)?.error ?? "unknown error"} — using last synced data`;
      steps = stepUpdate(steps, "sync_data", { status: "failed", detail: syncOutcome });
    } else {
      steps = stepUpdate(steps, "sync_data", {
        status: "done",
        detail: `Synced ${(sync as any)?.campaigns ?? "?"} campaigns`,
      });
    }
  } catch (err: any) {
    syncOutcome = `sync failed: ${err?.message ?? String(err)} — using last synced data`;
    steps = stepUpdate(steps, "sync_data", { status: "failed", detail: syncOutcome });
  }
  await saveSteps(ctx, steps, 2);

  // Verify we actually have data to analyse — never analyse thin air.
  const { count: dailyCount } = await ctx.sb.from("growthmind_gads_campaign_daily")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", ctx.workspaceId).eq("account_row_id", account.id);
  if (!dailyCount) {
    steps = stepUpdate(steps, "analyze", {
      status: "blocked", detail: "No synced campaign data available to analyse.",
    });
    await saveSteps(ctx, steps, 2);
    return {
      status: "blocked", steps, artifacts, result: null, evidence: null,
      linkedActionId: null,
      blockedReason: `No campaign data available (${syncOutcome}). Retry once Google Ads sync succeeds.`,
      errorMessage: null,
    };
  }

  // 3. Run the real analysis (writes growthmind_gads_recommendations) ─────────
  steps = stepUpdate(steps, "analyze", { status: "running" });
  await saveSteps(ctx, steps, 2);
  let generated = 0;
  try {
    const { runGadsAnalysis } = await import("@/lib/growthmind/gads-live-core.server");
    const r = await runGadsAnalysis(ctx.workspaceId, account.id);
    generated = r?.generated ?? 0;
    steps = stepUpdate(steps, "analyze", {
      status: "done", detail: `${generated} recommendation${generated === 1 ? "" : "s"} generated`,
    });
  } catch (err: any) {
    steps = stepUpdate(steps, "analyze", { status: "failed", detail: err?.message ?? String(err) });
    await saveSteps(ctx, steps, 2);
    return fail(`Google Ads analysis failed: ${err?.message ?? String(err)}`);
  }
  await saveSteps(ctx, steps, 3);

  // 4. Compile deliverable ─────────────────────────────────────────────────────
  steps = stepUpdate(steps, "compile_deliverable", { status: "running" });
  await saveSteps(ctx, steps, 3);
  const { data: recs } = await ctx.sb.from("growthmind_gads_recommendations")
    .select("id, section, priority, confidence, title, campaign_id, campaign_name, evidence, expected_benefit, recommended_action, status, created_at")
    .eq("workspace_id", ctx.workspaceId).eq("account_row_id", account.id)
    .in("status", ["new", "under_review"])
    .order("created_at", { ascending: false }).limit(50);
  const openRecs = recs ?? [];

  let kpiSummaryText: string | null = null;
  try {
    const { getGadsLiveCampaignSummaryText } = await import("@/lib/growthmind/gads-live-core.server");
    kpiSummaryText = await getGadsLiveCampaignSummaryText(ctx.workspaceId, Number(ctx.inputSpec?.days) || 30);
  } catch { /* summary text is best-effort */ }

  const report = {
    type: "gads_analysis_report",
    generated_at: new Date().toISOString(),
    account: { customer_id: account.customer_id, descriptive_name: account.descriptive_name ?? null },
    sync_outcome: syncOutcome,
    recommendations_generated: generated,
    open_recommendations: openRecs.map((r: any) => ({
      id: r.id, section: r.section, priority: r.priority, title: r.title,
      campaign: r.campaign_name, expected_benefit: r.expected_benefit,
      recommended_action: r.recommended_action,
    })),
    kpi_summary: kpiSummaryText,
  };
  artifacts.push(report);
  steps = stepUpdate(steps, "compile_deliverable", {
    status: "done", detail: `Report compiled (${openRecs.length} open recommendation${openRecs.length === 1 ? "" : "s"})`,
  });
  await saveSteps(ctx, steps, 4);

  // 5. Propose consequential action (if there is anything to change) ──────────
  if (openRecs.length === 0) {
    steps = stepUpdate(steps, "propose_action", {
      status: "skipped", detail: "No open recommendations — nothing to approve.",
    });
    steps = stepUpdate(steps, "apply_external", {
      status: "skipped", detail: "No changes proposed.",
    });
    await saveSteps(ctx, steps, 5);
    return {
      status: "completed", steps, artifacts,
      result: { recommendations_generated: generated, open_recommendations: 0 },
      evidence: {
        report_artifact: true,
        recommendations_generated: generated,
        verified_at: new Date().toISOString(),
      },
      linkedActionId: null, blockedReason: null, errorMessage: null,
    };
  }

  steps = stepUpdate(steps, "propose_action", { status: "running" });
  await saveSteps(ctx, steps, 4);
  const topRecs = openRecs.slice(0, 10);
  const { data: actionRow, error: ae } = await ctx.sb.from("hivemind_actions").insert({
    workspace_id: ctx.workspaceId,
    title: `Create ${topRecs.length} Google Ads change request${topRecs.length === 1 ? "" : "s"} from analysis`,
    description:
      "Convert the top analysis recommendations into approved change-request drafts. " +
      "This creates internal draft records only — no live Google Ads changes are made.",
    action_type: "gads_create_change_requests",
    action_payload: {
      recommendation_ids: topRecs.map((r: any) => r.id),
      account_row_id: account.id,
      summary: topRecs.map((r: any) => r.title).slice(0, 5),
    },
    proposed_by: "growthmind",
    status: "pending",
    sensitive: false,
    work_order_id: ctx.workOrderId,
    task_id: ctx.taskId,
    execution_id: ctx.executionId,
  }).select("id").single();
  if (ae) {
    steps = stepUpdate(steps, "propose_action", { status: "failed", detail: ae.message });
    await saveSteps(ctx, steps, 4);
    return fail(`Failed to propose change-request action: ${ae.message}`);
  }
  steps = stepUpdate(steps, "propose_action", {
    status: "done", detail: `Action proposed (${topRecs.length} recommendations) — awaiting approval`,
  });
  steps = stepUpdate(steps, "apply_external", {
    status: "blocked",
    detail: "External Google Ads write is awaiting integration — GrowthMind is advisory-only; changes are drafted as change requests, never auto-applied.",
  });
  await saveSteps(ctx, steps, 5);

  return {
    status: "awaiting_action_approval", steps, artifacts,
    result: null,
    evidence: null,
    linkedActionId: actionRow.id as string,
    blockedReason: null, errorMessage: null,
  };
}
