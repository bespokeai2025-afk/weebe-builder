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
  { key: "resolve_account",               label: "Resolve connected Google Ads account" },
  { key: "sync_data",                     label: "Refreshing Google Ads data" },
  { key: "analyze",                       label: "Loading campaigns and generating recommendations" },
  { key: "analyze_campaign",              label: "Analysing campaign settings and impression share" },
  { key: "analyze_keywords",              label: "Analysing keywords" },
  { key: "analyze_search_terms",          label: "Analysing search terms" },
  { key: "analyze_ads",                   label: "Analysing ads" },
  { key: "analyze_landing_pages",         label: "Analysing landing pages" },
  { key: "generate_keyword_opportunities", label: "Generating keyword opportunities" },
  { key: "create_ad_concepts",            label: "Creating ad concepts" },
  { key: "create_page_layouts",           label: "Creating page layouts" },
  { key: "draft_change_requests",         label: "Drafting change requests" },
  { key: "compile_report",                label: "Compiling report" },
  { key: "verify_evidence",               label: "Verifying evidence" },
  { key: "propose_action",                label: "Propose change-request action for approval" },
  { key: "apply_external",                label: "Apply changes to Google Ads (external write)" },
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

  // 4. Deep row-level analysis of the focus campaign ──────────────────────────
  const idxOf = (key: string) => Math.max(0, STEP_DEFS.findIndex(s => s.key === key));
  const focus = ctx.inputSpec?.focus_campaign as { campaign_id?: string | null; campaign_name?: string | null } | undefined;
  let focusCampaignId: string | null = focus?.campaign_id ? String(focus.campaign_id) : null;
  const focusCampaignName: string | null = focus?.campaign_name ?? null;
  if (!focusCampaignId && focusCampaignName) {
    // Resolve the campaign id from synced data by (case-insensitive) name.
    const { data: match } = await ctx.sb.from("growthmind_gads_campaign_daily")
      .select("campaign_id, campaign_name")
      .eq("workspace_id", ctx.workspaceId).eq("account_row_id", account.id)
      .ilike("campaign_name", focusCampaignName)
      .order("date", { ascending: false }).limit(1).maybeSingle();
    if (match?.campaign_id) focusCampaignId = String(match.campaign_id);
  }
  if (!focusCampaignId) {
    // No explicit focus: pick the highest-spend campaign in the window so the
    // deep report is always about a real, active campaign.
    const days = Number(ctx.inputSpec?.days) || 30;
    const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    const { data: rows } = await ctx.sb.from("growthmind_gads_campaign_daily")
      .select("campaign_id, campaign_name, cost_micros")
      .eq("workspace_id", ctx.workspaceId).eq("account_row_id", account.id)
      .gte("date", since).limit(2000);
    const bySpend = new Map<string, number>();
    for (const r of rows ?? []) {
      bySpend.set(String(r.campaign_id), (bySpend.get(String(r.campaign_id)) ?? 0) + Number(r.cost_micros ?? 0));
    }
    const top = Array.from(bySpend.entries()).sort((a, b) => b[1] - a[1])[0];
    if (top) focusCampaignId = top[0];
  }

  let deepReportId: string | null = null;
  let deepCounters: Record<string, number> | null = null;
  let deepErrors: string[] = [];
  if (focusCampaignId) {
    try {
      const { fetchGadsDeepData } = await import("@/lib/growthmind/gads-deep-fetch.server");
      const { buildGadsDeepAnalysisReport } = await import("@/lib/growthmind/gads-deep-analysis.server");
      const deepData = await fetchGadsDeepData({
        workspaceId: ctx.workspaceId,
        customerId: String(account.customer_id),
        loginCustomerId: account.login_customer_id ? String(account.login_customer_id) : null,
        campaignId: focusCampaignId,
        days: Number(ctx.inputSpec?.days) || 30,
      });
      const currency = String(account.currency_code ?? "GBP").toUpperCase();
      const curSym = currency === "GBP" ? "£" : currency === "USD" ? "$" : currency === "EUR" ? "€" : `${currency} `;
      const built = await buildGadsDeepAnalysisReport({
        workspaceId: ctx.workspaceId,
        accountRowId: account.id,
        currencySymbol: curSym,
        data: deepData,
        workOrderId: ctx.workOrderId ?? null,
        taskId: ctx.taskId ?? null,
        executionId: ctx.executionId ?? null,
        onStage: async (stageKey, status, detail) => {
          steps = stepUpdate(steps, stageKey, {
            status: status === "running" ? "running" : status === "failed" ? "failed" : "done",
            ...(detail ? { detail } : {}),
          });
          await saveSteps(ctx, steps, idxOf(stageKey));
        },
      });
      deepReportId = built.reportId;
      deepCounters = built.counters;
      deepErrors = built.sectionErrors;
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      deepErrors.push(msg);
      // Mark all not-yet-finished deep stages as failed — never leave them "running".
      for (const def of STEP_DEFS) {
        const st = steps.find(s => s.key === def.key);
        if (st && ["analyze_campaign", "analyze_keywords", "analyze_search_terms", "analyze_ads",
          "analyze_landing_pages", "generate_keyword_opportunities", "create_ad_concepts",
          "create_page_layouts", "draft_change_requests", "compile_report"].includes(def.key)
          && (st.status === "pending" || st.status === "running")) {
          steps = stepUpdate(steps, def.key, { status: "failed", detail: `Deep analysis aborted: ${msg}`.slice(0, 200) });
        }
      }
      await saveSteps(ctx, steps, idxOf("compile_report"));
    }
  } else {
    for (const key of ["analyze_campaign", "analyze_keywords", "analyze_search_terms", "analyze_ads",
      "analyze_landing_pages", "generate_keyword_opportunities", "create_ad_concepts",
      "create_page_layouts", "draft_change_requests", "compile_report"]) {
      steps = stepUpdate(steps, key, { status: "skipped", detail: "No campaign with spend found to deep-analyse." });
    }
    await saveSteps(ctx, steps, idxOf("compile_report"));
  }

  // 5. Verify evidence — confirm the stored report really exists and is complete
  steps = stepUpdate(steps, "verify_evidence", { status: "running" });
  await saveSteps(ctx, steps, idxOf("verify_evidence"));
  let verifiedSections = 0;
  if (deepReportId) {
    const { data: storedReport } = await ctx.sb.from("growthmind_gads_analysis_reports")
      .select("id, status, sections").eq("id", deepReportId).eq("workspace_id", ctx.workspaceId).maybeSingle();
    verifiedSections = storedReport?.sections ? Object.keys(storedReport.sections).length : 0;
    if (!storedReport || verifiedSections < 5) {
      steps = stepUpdate(steps, "verify_evidence", {
        status: "failed",
        detail: storedReport ? `Stored report only has ${verifiedSections} sections.` : "Stored report not found after insert.",
      });
      await saveSteps(ctx, steps, idxOf("verify_evidence"));
      return fail("Deep analysis report failed post-storage verification.");
    }
    steps = stepUpdate(steps, "verify_evidence", {
      status: "done",
      detail: `Report ${deepReportId.slice(0, 8)}… verified: ${verifiedSections} sections stored${deepErrors.length ? `, ${deepErrors.length} section warning(s)` : ""}`,
    });
  } else {
    steps = stepUpdate(steps, "verify_evidence", {
      status: deepErrors.length ? "failed" : "skipped",
      detail: deepErrors.length ? `Deep analysis did not produce a report: ${deepErrors[0]}`.slice(0, 250) : "No deep report generated.",
    });
  }
  await saveSteps(ctx, steps, idxOf("verify_evidence"));

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
    deep_report_id: deepReportId,
    deep_report_counters: deepCounters,
    deep_report_warnings: deepErrors.length ? deepErrors : undefined,
  };
  artifacts.push(report);

  // 5. Propose consequential action (if there is anything to change) ──────────
  if (openRecs.length === 0) {
    steps = stepUpdate(steps, "propose_action", {
      status: "skipped", detail: "No open recommendations — nothing to approve.",
    });
    steps = stepUpdate(steps, "apply_external", {
      status: "skipped", detail: "No changes proposed.",
    });
    await saveSteps(ctx, steps, idxOf("apply_external"));
    return {
      status: "completed", steps, artifacts,
      result: { recommendations_generated: generated, open_recommendations: 0, deep_report_id: deepReportId },
      evidence: {
        report_artifact: true,
        recommendations_generated: generated,
        deep_report_id: deepReportId,
        deep_report_sections: verifiedSections,
        verified_at: new Date().toISOString(),
      },
      linkedActionId: null, blockedReason: null, errorMessage: null,
    };
  }

  steps = stepUpdate(steps, "propose_action", { status: "running" });
  await saveSteps(ctx, steps, idxOf("propose_action"));
  // Honor a campaign focus from the work order (chat-initiated scope): put
  // that campaign's recommendations first; fall back honestly to account-wide
  // recommendations when the focus campaign produced none.
  let orderedRecs = openRecs;
  let focusNote = "";
  if (focus?.campaign_id || focus?.campaign_name) {
    const matches = (r: any) =>
      (focus.campaign_id && String(r.campaign_id ?? "") === String(focus.campaign_id)) ||
      (focus.campaign_name && (r.campaign_name ?? "").toLowerCase() === focus.campaign_name.toLowerCase());
    const inFocus = openRecs.filter(matches);
    const rest = openRecs.filter((r: any) => !matches(r));
    orderedRecs = [...inFocus, ...rest];
    focusNote = inFocus.length
      ? ` (${inFocus.length} for focus campaign "${focus.campaign_name ?? focus.campaign_id}")`
      : ` (none specific to focus campaign "${focus.campaign_name ?? focus.campaign_id}" — account-wide recommendations proposed)`;
  }
  const topRecs = orderedRecs.slice(0, 10);
  // JUSTIFIED-EXCEPTION (Task #500): writes to hivemind_actions (approval queue),
  // not hivemind_tasks. Runs inside an approved work order context; the intelligence
  // packet gate fires in hivemind.actions.ts::executeAction when the action is approved.
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
      objective_id: typeof ctx.inputSpec?.objective_id === "string" ? ctx.inputSpec.objective_id : null,
      summary: topRecs.map((r: any) => r.title).slice(0, 5),
      report_id: deepReportId,
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
    await saveSteps(ctx, steps, idxOf("propose_action"));
    return fail(`Failed to propose change-request action: ${ae.message}`);
  }
  steps = stepUpdate(steps, "propose_action", {
    status: "done", detail: `Action proposed (${topRecs.length} recommendations)${focusNote} — awaiting approval`,
  });
  steps = stepUpdate(steps, "apply_external", {
    status: "blocked",
    detail: "External Google Ads write is awaiting integration — GrowthMind is advisory-only; changes are drafted as change requests, never auto-applied.",
  });
  await saveSteps(ctx, steps, idxOf("apply_external"));

  return {
    status: "awaiting_action_approval", steps, artifacts,
    result: null,
    evidence: null,
    linkedActionId: actionRow.id as string,
    blockedReason: null, errorMessage: null,
  };
}
