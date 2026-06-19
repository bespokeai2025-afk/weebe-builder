/**
 * CMO Analysis Tick — autonomous daily CMO signal refresh.
 *
 * Called by the campaign-scheduler executor (every 5 min in dev via Vite plugin,
 * every 5 min in prod via /api/public/campaign-executor + pg_cron).
 *
 * Internally guards against running more than once per day per workspace using
 * the `computed_at` timestamp on growthmind_service_scores.
 *
 * Iterates every workspace that has Business DNA configured (opt-in signal for
 * GrowthMind usage).  Workspaces with no DNA row are skipped silently.
 */

import { createClient } from "@supabase/supabase-js";

export type CMOTickResult = {
  workspaceId: string;
  skipped: boolean;
  skipReason?: string;
  ran: boolean;
  services?: number;
  trends?: number;
  campaigns?: number;
  videos?: number;
  error?: string;
};

export type CMOTickReport = {
  ran: CMOTickResult[];
  skipped: CMOTickResult[];
  failed: CMOTickResult[];
  error?: string;
};

async function tickWorkspace(
  sb: ReturnType<typeof createClient>,
  workspaceId: string,
): Promise<CMOTickResult> {
  const base = { workspaceId };

  // Daily deduplication — skip if CMO analysis already ran today for this workspace
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayIso = todayStart.toISOString();

  const { data: recent } = await Promise.resolve((sb as any)
    .from("growthmind_service_scores")
    .select("computed_at")
    .eq("workspace_id", workspaceId)
    .gte("computed_at", todayIso)
    .limit(1)
  ).catch(() => ({ data: null }));

  if (recent && (recent as any[]).length > 0) {
    return { ...base, skipped: true, skipReason: "already_ran_today", ran: false };
  }

  // Run all 4 CMO engines
  try {
    const { buildBusinessContext } = await import("@/lib/growthmind/growthmind.business-context");
    const ctx = await buildBusinessContext(sb, workspaceId);

    const nowIso = new Date().toISOString();

    const [svc, trend, campaign, video] = await Promise.allSettled([
      // 1. Service scoring
      (async () => {
        const { computeServiceScores } = await import("@/lib/growthmind/growthmind.opportunity-score");
        const scores = computeServiceScores(ctx);
        // Always delete existing rows first (removes stale marker + old scores)
        await (sb as any).from("growthmind_service_scores").delete().eq("workspace_id", workspaceId).catch(() => {});
        // Always write the daily marker so dedup triggers correctly on next tick,
        // even when computeServiceScores returns 0 real rows (e.g. no services in DNA).
        // The marker row is filtered out of getCMODashboardData via .neq("service_name", "__cmo_marker__").
        const rows = [
          ...scores.map((s: any) => ({
            workspace_id: workspaceId, service_name: s.serviceName, total_score: s.totalScore,
            scores: { dimensions: s.dimensions }, recommendation: s.recommendation, computed_at: s.computedAt,
          })),
          {
            workspace_id: workspaceId, service_name: "__cmo_marker__", total_score: -1,
            scores: {}, recommendation: null, computed_at: nowIso,
          },
        ];
        await (sb as any).from("growthmind_service_scores").insert(rows).catch(() => {});
        return scores.length;
      })(),

      // 2. Trend signals
      (async () => {
        const { detectTrendSignals } = await import("@/lib/growthmind/growthmind.trend-engine");
        const signals = await detectTrendSignals(sb, workspaceId);
        if (signals.length > 0) {
          await (sb as any).from("growthmind_trend_signals").delete().eq("workspace_id", workspaceId).catch(() => {});
          await (sb as any).from("growthmind_trend_signals").insert(signals.map((s: any) => ({
            workspace_id: workspaceId, signal_type: s.signalType, label: s.label,
            classification: s.classification, current_value: s.currentValue, previous_value: s.previousValue,
            change_percent: s.changePercent, insight: s.insight, action_hint: s.actionHint, computed_at: s.computedAt,
          }))).catch(() => {});
        }
        return signals.length;
      })().catch(() => 0),

      // 3. Campaign proposals (side-effect: createAutonomousDrafts fires)
      (async () => {
        const { generateDeterministicProposals, createAutonomousDrafts } = await import("@/lib/growthmind/growthmind.campaign-proposals");
        const proposals = generateDeterministicProposals(ctx);
        if (proposals.length > 0) {
          await (sb as any).from("growthmind_campaign_proposals").delete().eq("workspace_id", workspaceId).catch(() => {});
          await (sb as any).from("growthmind_campaign_proposals").insert(proposals.map((p: any) => ({
            workspace_id: workspaceId, title: p.title, reason: p.reason, evidence: p.evidence,
            audience: p.audience, expected_outcome: p.expectedOutcome, budget_estimate: p.budgetEstimate,
            content_plan: p.contentPlan, video_plan: p.videoPlan, channels: p.channels,
            status: "draft", generated_at: p.generatedAt,
          }))).catch(() => {});
          await createAutonomousDrafts(sb, workspaceId, proposals);
        }
        return proposals.length;
      })(),

      // 4. Video proposals (side-effect: createAutonomousVideoQueueEntries fires)
      (async () => {
        const { generateVideoProposals, createAutonomousVideoQueueEntries } = await import("@/lib/growthmind/growthmind.video-proposals");
        const proposals = generateVideoProposals(ctx);
        if (proposals.length > 0) {
          await (sb as any).from("growthmind_video_proposals").delete().eq("workspace_id", workspaceId).catch(() => {});
          await (sb as any).from("growthmind_video_proposals").insert(proposals.map((p: any) => ({
            workspace_id: workspaceId, title: p.title, hook: p.hook, platform: p.platform,
            target_audience: p.targetAudience, storyboard: p.storyboard, creative_angles: p.creativeAngles,
            expected_outcome: p.expectedOutcome, duration: p.duration, call_to_action: p.callToAction,
            status: "draft", generated_at: p.generatedAt,
          }))).catch(() => {});
          await createAutonomousVideoQueueEntries(sb, workspaceId, proposals);
        }
        return proposals.length;
      })(),
    ]);

    return {
      ...base,
      skipped:   false,
      ran:       true,
      services:  svc.status      === "fulfilled" ? (svc.value      as number) : 0,
      trends:    trend.status    === "fulfilled" ? (trend.value    as number) : 0,
      campaigns: campaign.status === "fulfilled" ? (campaign.value as number) : 0,
      videos:    video.status    === "fulfilled" ? (video.value    as number) : 0,
    };
  } catch (e: any) {
    const msg: string = e?.message ?? String(e);
    // In the Vite dev-server plugin context (`.vite-temp` ESM), path aliases like
    // `@/lib` cannot resolve. Treat this as a silent skip — production runs via the
    // HTTP endpoint where aliases are resolved normally.
    if (msg.includes("Cannot find package '@/lib'") || msg.includes("Cannot find package '@/integrations'")) {
      return { ...base, skipped: true, skipReason: "dev_alias_unavailable", ran: false };
    }
    return { ...base, skipped: false, ran: false, error: msg };
  }
}

export async function runCMOAnalysisTick(): Promise<CMOTickReport> {
  const supabaseUrl    = process.env.SUPABASE_URL            ?? process.env.VITE_SUPABASE_URL ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  if (!supabaseUrl || !serviceRoleKey) {
    return { ran: [], skipped: [], failed: [], error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" };
  }

  const sb = createClient(supabaseUrl, serviceRoleKey);

  // Find all workspaces with Business DNA (signals active GrowthMind usage)
  const { data: dnaRows, error: dnaErr } = await Promise.resolve((sb as any)
    .from("growthmind_business_dna")
    .select("workspace_id")
  ).catch(() => ({ data: null, error: "query failed" }));

  if (dnaErr || !dnaRows) {
    return { ran: [], skipped: [], failed: [], error: String(dnaErr ?? "No data") };
  }

  const results: CMOTickResult[] = await Promise.all(
    (dnaRows as any[]).map((row: any) =>
      tickWorkspace(sb, row.workspace_id).catch((e: any) => ({
        workspaceId: row.workspace_id,
        skipped:     false,
        ran:         false,
        error:       e?.message ?? String(e),
      })),
    ),
  );

  return {
    ran:     results.filter(r => r.ran),
    skipped: results.filter(r => r.skipped),
    failed:  results.filter(r => !r.skipped && !r.ran),
  };
}
