// SERVER ONLY server-fns — Content Anatomy (deep video analysis) + adaptations.
// growthmind_content_anatomy is RLS SELECT-only for members; writes go through
// the service-role admin client after an explicit membership check.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertMember(sb: any, workspaceId: string, userId: string): Promise<void> {
  const { data: member, error } = await sb
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error("Membership check failed");
  if (!member) throw new Error("Not a member of this workspace");
}

export type ContentAnatomy = {
  id: string;
  trendItemId: string;
  status: string;
  analysisMode: string;
  transcript: string | null;
  onScreenText: string | null;
  anatomy: Record<string, unknown>;
  model: string | null;
  costEstimate: number;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdaptationRecord = {
  id: string;
  title: string;
  brief: string | null;
  angle: string | null;
  targetPlatform: string | null;
  status: string;
  riskFlags: string[];
  scores: Record<string, unknown>;
  payload: Record<string, unknown>;
  createdAt: string;
};

const ItemInput = z.object({ itemId: z.string().uuid() });

/** Anatomy page bundle: item + anatomy (if any) + adaptations + budget. */
export const getContentAnatomyBundle = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: z.infer<typeof ItemInput>) => ItemInput.parse(i))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
    const [itemRes, anatRes, adaptRes, settingsRes, runsRes] = await Promise.all([
      sb.from("growthmind_trend_items").select("*").eq("workspace_id", workspaceId).eq("id", data.itemId).maybeSingle(),
      sb.from("growthmind_content_anatomy").select("*").eq("workspace_id", workspaceId).eq("trend_item_id", data.itemId).maybeSingle(),
      sb.from("growthmind_content_recommendations").select("*").eq("workspace_id", workspaceId).eq("trend_item_id", data.itemId).order("created_at", { ascending: false }).limit(20),
      sb.from("workspace_settings").select("growthmind_deep_analysis_daily_limit").eq("workspace_id", workspaceId).maybeSingle(),
      sb.from("growthmind_discovery_runs").select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId).eq("run_kind", "deep_analysis").gte("created_at", dayStart.toISOString()),
    ]);
    if (itemRes.error) throw new Error(`Failed to load item: ${itemRes.error.message}`);
    if (!itemRes.data) throw new Error("Trend item not found");
    if (anatRes.error)  throw new Error(`Failed to load anatomy: ${anatRes.error.message}`);
    if (adaptRes.error) throw new Error(`Failed to load adaptations: ${adaptRes.error.message}`);

    const r = itemRes.data;
    const a = anatRes.data;
    return {
      item: {
        id: r.id, platform: r.platform, url: r.url, title: r.title, caption: r.caption,
        mediaType: r.media_type, authorHandle: r.author_handle, authorName: r.author_name,
        publishedAt: r.published_at, discoveredAt: r.discovered_at,
        metrics: r.metrics ?? {}, scores: r.scores ?? {}, status: r.status,
      },
      anatomy: a ? ({
        id: a.id, trendItemId: a.trend_item_id, status: a.status, analysisMode: a.analysis_mode,
        transcript: a.transcript, onScreenText: a.on_screen_text, anatomy: a.anatomy ?? {},
        model: a.model, costEstimate: Number(a.cost_estimate ?? 0), errorMessage: a.error_message,
        createdAt: a.created_at, updatedAt: a.updated_at,
      } satisfies ContentAnatomy) : null,
      adaptations: (adaptRes.data ?? []).map((x: any): AdaptationRecord => ({
        id: x.id, title: x.title, brief: x.brief, angle: x.angle,
        targetPlatform: x.target_platform, status: x.status,
        riskFlags: Array.isArray(x.risk_flags) ? x.risk_flags.map(String) : [],
        scores: x.scores ?? {}, payload: x.payload ?? {}, createdAt: x.created_at,
      })),
      budget: {
        dailyLimit: settingsRes.data?.growthmind_deep_analysis_daily_limit ?? 5,
        usedToday:  runsRes.count ?? 0,
      },
    };
  });

/** Run the multimodal deep analysis for one item (user-triggered, daily-capped). */
export const runDeepVideoAnalysis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: z.infer<typeof ItemInput>) => ItemInput.parse(i))
  .handler(async ({ data, context }) => {
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    await assertMember(context.supabase, workspaceId, context.userId);

    const { runDeepAnalysis } = await import("@/lib/growthmind/trend-anatomy.server");
    const outcome = await runDeepAnalysis(workspaceId, data.itemId);

    try {
      const { logGrowthMindActivity } = await import("@/lib/growthmind/growthmind.activity.server");
      await logGrowthMindActivity({
        workspaceId,
        actor: "user",
        actorUserId: context.userId,
        category: "trends",
        action: "trends.deep_analysis",
        summary: `Deep-analysed a trend item (${outcome.analysisMode}, ${outcome.status}). Est. cost $${outcome.costUsd.toFixed(4)}.`,
      });
    } catch { /* non-fatal */ }

    return outcome;
  });

/** Generate an original adaptation brief from the anatomy (user-triggered). */
export const generateTrendAdaptation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: z.infer<typeof ItemInput>) => ItemInput.parse(i))
  .handler(async ({ data, context }) => {
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    await assertMember(context.supabase, workspaceId, context.userId);

    const { generateAdaptation } = await import("@/lib/growthmind/trend-anatomy.server");
    const outcome = await generateAdaptation(workspaceId, data.itemId);

    try {
      const { logGrowthMindActivity } = await import("@/lib/growthmind/growthmind.activity.server");
      await logGrowthMindActivity({
        workspaceId,
        actor: "user",
        actorUserId: context.userId,
        category: "trends",
        action: "trends.adaptation_generated",
        summary: outcome.blocked
          ? `Adaptation BLOCKED by originality/compliance checks: ${outcome.blockedReasons.join("; ").slice(0, 200)}`
          : `Original adaptation brief generated (similarity ${Math.round(outcome.similarity * 100)}%). Est. cost $${outcome.costUsd.toFixed(4)}.`,
      });
    } catch { /* non-fatal */ }

    return outcome;
  });
