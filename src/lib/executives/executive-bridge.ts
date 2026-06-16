// ── Executive Bridge — isomorphic server-function wrappers ─────────────────────
// UI imports these. Each handler dynamically imports `./executive-bridge.server`
// so the server-only builders are NEVER bundled into the client.
//
// Calling convention: GET fns take no/optional input; POST fns use { data: input }.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ── GrowthMind (CMO) executive summary ─────────────────────────────────────────
export const getGrowthMindExecutiveSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const { buildGrowthMindExecutiveSummary } = await import("./executive-bridge.server");
    return buildGrowthMindExecutiveSummary(sb, workspaceId);
  });

// ── Executive Council master summary (ops + marketing merged) ──────────────────
export const getExecutiveCouncilSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const { buildExecutiveCouncilSummary } = await import("./executive-bridge.server");
    return buildExecutiveCouncilSummary(sb, workspaceId);
  });

// ── Record an executive event ──────────────────────────────────────────────────
export const recordExecutiveEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      source:     z.enum(["hivemind", "growthmind", "systemmind"]),
      event_type: z.string().min(1).max(120),
      summary:    z.string().min(1).max(2000),
      severity:   z.enum(["info", "warning", "critical"]).optional(),
    }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const { insertExecutiveEvent } = await import("./executive-bridge.server");
    return insertExecutiveEvent(sb, workspaceId, data);
  });

// ── CMO Dashboard data (all CMO signals in one call) ──────────────────────────
export const getCMODashboardData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const [serviceScores, trendSignals, campaignProposals, videoProposals] = await Promise.all([
      sb.from("growthmind_service_scores")
        .select("id, service_name, total_score, scores, recommendation, computed_at")
        .eq("workspace_id", workspaceId)
        .neq("service_name", "__cmo_marker__")
        .order("total_score", { ascending: false })
        .limit(10)
        .catch(() => ({ data: [] })),
      sb.from("growthmind_trend_signals")
        .select("id, signal_type, label, classification, current_value, previous_value, change_percent, insight, action_hint, computed_at")
        .eq("workspace_id", workspaceId)
        .order("computed_at", { ascending: false })
        .limit(10)
        .catch(() => ({ data: [] })),
      sb.from("growthmind_campaign_proposals")
        .select("id, title, reason, evidence, audience, expected_outcome, budget_estimate, content_plan, video_plan, channels, status, generated_at")
        .eq("workspace_id", workspaceId)
        .order("generated_at", { ascending: false })
        .limit(10)
        .catch(() => ({ data: [] })),
      sb.from("growthmind_video_proposals")
        .select("id, title, hook, platform, target_audience, storyboard, creative_angles, expected_outcome, duration, call_to_action, status, generated_at")
        .eq("workspace_id", workspaceId)
        .order("generated_at", { ascending: false })
        .limit(10)
        .catch(() => ({ data: [] })),
    ]);

    return {
      serviceScores:     ((serviceScores as any).data ?? []).map((r: any) => ({
        id: r.id, serviceName: r.service_name, totalScore: r.total_score,
        dimensions: r.scores?.dimensions ?? [], recommendation: r.recommendation, computedAt: r.computed_at,
      })),
      trendSignals:      ((trendSignals as any).data ?? []).map((r: any) => ({
        id: r.id, signalType: r.signal_type, label: r.label, classification: r.classification,
        currentValue: r.current_value, previousValue: r.previous_value, changePercent: r.change_percent,
        insight: r.insight, actionHint: r.action_hint, computedAt: r.computed_at,
      })),
      campaignProposals: ((campaignProposals as any).data ?? []).map((r: any) => ({
        id: r.id, title: r.title, reason: r.reason, evidence: r.evidence, audience: r.audience,
        expectedOutcome: r.expected_outcome, budgetEstimate: r.budget_estimate,
        contentPlan: r.content_plan, videoPlan: r.video_plan, channels: r.channels ?? [],
        status: r.status, generatedAt: r.generated_at,
      })),
      videoProposals:    ((videoProposals as any).data ?? []).map((r: any) => ({
        id: r.id, title: r.title, hook: r.hook, platform: r.platform, targetAudience: r.target_audience,
        storyboard: r.storyboard, creativeAngles: r.creative_angles ?? [],
        expectedOutcome: r.expected_outcome, duration: r.duration, callToAction: r.call_to_action,
        status: r.status, generatedAt: r.generated_at,
      })),
    };
  });

// ── Run all CMO engines in one shot ───────────────────────────────────────────
export const runCMOAnalysis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    // Route through the engine functions so autonomous draft side-effects always fire
    const [svc, trend, campaign, video] = await Promise.allSettled([
      // 1. Service scoring
      (async () => {
        const { buildBusinessContext } = await import("@/lib/growthmind/growthmind.business-context");
        const { computeServiceScores } = await import("@/lib/growthmind/growthmind.opportunity-score");
        const ctx = await buildBusinessContext(sb, workspaceId);
        const scores = computeServiceScores(ctx);
        if (scores.length > 0) {
          await sb.from("growthmind_service_scores").delete().eq("workspace_id", workspaceId).catch(() => {});
          const { error } = await sb.from("growthmind_service_scores").insert(scores.map((s: any) => ({
            workspace_id: workspaceId, service_name: s.serviceName, total_score: s.totalScore,
            scores: { dimensions: s.dimensions }, recommendation: s.recommendation, computed_at: s.computedAt,
          })));
          if (error) throw error;
        }
        return { ok: true, count: scores.length };
      })(),

      // 2. Trend signals
      (async () => {
        const { detectTrendSignals } = await import("@/lib/growthmind/growthmind.trend-engine");
        const signals = await detectTrendSignals(sb, workspaceId);
        if (signals.length > 0) {
          await sb.from("growthmind_trend_signals").delete().eq("workspace_id", workspaceId).catch(() => {});
          await sb.from("growthmind_trend_signals").insert(signals.map((s: any) => ({
            workspace_id: workspaceId, signal_type: s.signalType, label: s.label,
            classification: s.classification, current_value: s.currentValue, previous_value: s.previousValue,
            change_percent: s.changePercent, insight: s.insight, action_hint: s.actionHint, computed_at: s.computedAt,
          }))).catch(() => {});
        }
        return { ok: true, count: signals.length };
      })().catch(() => ({ ok: false })),

      // 3. Campaign proposals — routes through engine so createAutonomousDrafts fires
      (async () => {
        const {
          buildBusinessContext,
        } = await import("@/lib/growthmind/growthmind.business-context");
        const {
          generateDeterministicProposals,
          createAutonomousDrafts,
        } = await import("@/lib/growthmind/growthmind.campaign-proposals");
        const ctx = await buildBusinessContext(sb, workspaceId);
        const proposals = generateDeterministicProposals(ctx);
        if (proposals.length > 0) {
          await sb.from("growthmind_campaign_proposals").delete().eq("workspace_id", workspaceId).catch(() => {});
          await sb.from("growthmind_campaign_proposals").insert(proposals.map(p => ({
            workspace_id: workspaceId, title: p.title, reason: p.reason, evidence: p.evidence,
            audience: p.audience, expected_outcome: p.expectedOutcome, budget_estimate: p.budgetEstimate,
            content_plan: p.contentPlan, video_plan: p.videoPlan, channels: p.channels,
            status: "draft", generated_at: p.generatedAt,
          }))).catch(() => {});
        }
        // Side-effect: create funnel/WhatsApp/HexMail drafts in hivemind_actions
        await createAutonomousDrafts(sb, workspaceId, proposals);
        return { ok: true, count: proposals.length };
      })(),

      // 4. Video proposals — routes through engine so queue entries fire
      (async () => {
        const {
          buildBusinessContext,
        } = await import("@/lib/growthmind/growthmind.business-context");
        const {
          generateVideoProposals,
          createAutonomousVideoQueueEntries,
        } = await import("@/lib/growthmind/growthmind.video-proposals");
        const ctx = await buildBusinessContext(sb, workspaceId);
        const proposals = generateVideoProposals(ctx);
        if (proposals.length > 0) {
          await sb.from("growthmind_video_proposals").delete().eq("workspace_id", workspaceId).catch(() => {});
          await sb.from("growthmind_video_proposals").insert(proposals.map(p => ({
            workspace_id: workspaceId, title: p.title, hook: p.hook, platform: p.platform,
            target_audience: p.targetAudience, storyboard: p.storyboard, creative_angles: p.creativeAngles,
            expected_outcome: p.expectedOutcome, duration: p.duration, call_to_action: p.callToAction,
            status: "draft", generated_at: p.generatedAt,
          }))).catch(() => {});
        }
        // Side-effect: create video queue entries in hivemind_actions
        await createAutonomousVideoQueueEntries(sb, workspaceId, proposals);
        return { ok: true, count: proposals.length };
      })(),
    ]);

    return {
      ok:        true,
      services:  svc.status  === "fulfilled" ? svc.value  : { ok: false },
      trend:     trend.status === "fulfilled" ? trend.value : { ok: false },
      campaigns: campaign.status === "fulfilled" ? campaign.value : { ok: false },
      videos:    video.status  === "fulfilled" ? video.value  : { ok: false },
    };
  });

// ── Update proposal status (approve / reject / draft) ─────────────────────────
export const updateProposalStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      proposalType: z.enum(["campaign", "video"]),
      proposalId:   z.string().uuid(),
      status:       z.enum(["approved", "rejected", "draft"]),
    }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const table = data.proposalType === "campaign"
      ? "growthmind_campaign_proposals"
      : "growthmind_video_proposals";

    const { error } = await sb
      .from(table)
      .update({ status: data.status })
      .eq("id", data.proposalId)
      .eq("workspace_id", workspaceId);

    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── Read executive events ──────────────────────────────────────────────────────
export const getExecutiveEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ limit: z.number().int().min(1).max(100).optional() }).optional().parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) return [];
    const { selectExecutiveEvents } = await import("./executive-bridge.server");
    return selectExecutiveEvents(sb, workspaceId, data?.limit ?? 20);
  });
