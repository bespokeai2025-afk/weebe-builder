// SERVER ONLY server-fns — Trend Scout feed, competitor intelligence, actions,
// discovery/scoring triggers, and cost-control settings.
// growthmind_trend_items / growthmind_discovery_runs are RLS SELECT-only for
// members; writes go through the service-role admin client after an explicit
// membership check.

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

export type TrendFeedItem = {
  id: string;
  platform: string;
  url: string | null;
  title: string | null;
  caption: string | null;
  mediaType: string | null;
  authorHandle: string | null;
  authorName: string | null;
  publishedAt: string | null;
  discoveredAt: string;
  metrics: Record<string, unknown>;
  scores: Record<string, unknown>;
  status: string;
  sourceId: string | null;
};

function mapItem(r: any): TrendFeedItem {
  return {
    id: r.id, platform: r.platform, url: r.url, title: r.title,
    caption: r.caption, mediaType: r.media_type, authorHandle: r.author_handle,
    authorName: r.author_name, publishedAt: r.published_at,
    discoveredAt: r.discovered_at, metrics: r.metrics ?? {}, scores: r.scores ?? {},
    status: r.status, sourceId: r.source_id,
  };
}

// ── Trend feed ─────────────────────────────────────────────────────────────────

const FeedInput = z.object({
  status: z.enum(["all", "recommended", "screened", "discovered", "dismissed", "stale"]).optional(),
});

export const getTrendFeed = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: z.infer<typeof FeedInput> | undefined) => (i ? FeedInput.parse(i) : {}))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    let q = sb
      .from("growthmind_trend_items")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("discovered_at", { ascending: false })
      .limit(150);
    const status = data?.status ?? "all";
    if (status !== "all") q = q.eq("status", status);

    const [itemsRes, runsRes, settingsRes] = await Promise.all([
      q,
      sb.from("growthmind_discovery_runs")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(40),
      sb.from("workspace_settings")
        .select("growthmind_discovery_daily_limit, growthmind_min_opportunity_score, growthmind_trend_scout_enabled")
        .eq("workspace_id", workspaceId)
        .maybeSingle(),
    ]);
    if (itemsRes.error) throw new Error(`Failed to load trend items: ${itemsRes.error.message}`);
    if (runsRes.error)  throw new Error(`Failed to load discovery runs: ${runsRes.error.message}`);

    const items = (itemsRes.data ?? []).map(mapItem);
    // Recommended first (by total score), then screened by prescreen
    items.sort((a, b) => {
      const rank = (s: string) => (s === "recommended" ? 0 : s === "screened" ? 1 : s === "discovered" ? 2 : 3);
      const r = rank(a.status) - rank(b.status);
      if (r !== 0) return r;
      return (Number(b.scores.total ?? b.scores.prescreen ?? 0)) - (Number(a.scores.total ?? a.scores.prescreen ?? 0));
    });

    const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
    const runs = (runsRes.data ?? []).map((r: any) => ({
      id: r.id, runKind: r.run_kind, source: r.source, status: r.status,
      itemsFound: r.items_found, itemsNew: r.items_new,
      errorMessage: r.error_message, skipReason: r.skip_reason,
      costEstimate: Number(r.cost_estimate ?? 0), durationMs: r.duration_ms,
      triggeredBy: r.triggered_by, createdAt: r.created_at,
    }));
    const runsToday = runs.filter((r: any) => r.runKind === "discovery" && r.source === "internal" && r.createdAt >= dayStart.toISOString()).length;
    const costToday = runs.filter((r: any) => r.createdAt >= dayStart.toISOString()).reduce((s: number, r: any) => s + r.costEstimate, 0);

    return {
      items,
      runs,
      settings: {
        dailyLimit: settingsRes.data?.growthmind_discovery_daily_limit ?? 4,
        minScore:   settingsRes.data?.growthmind_min_opportunity_score ?? 55,
        enabled:    settingsRes.data?.growthmind_trend_scout_enabled ?? true,
      },
      runsToday,
      costToday,
    };
  });

// ── Manual discovery / screening / scoring triggers ───────────────────────────

export const runTrendDiscoveryNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    await assertMember(context.supabase, workspaceId, context.userId);

    const { runTrendDiscoveryForWorkspace } = await import("@/lib/growthmind/trend-discovery.server");
    const summary = await runTrendDiscoveryForWorkspace(workspaceId, "user");
    if (!summary.ran) throw new Error(`Discovery skipped: ${summary.skipReason ?? "unknown reason"}`);

    // Cheap deterministic screening runs automatically after discovery.
    const { screenTrendItems } = await import("@/lib/growthmind/trend-scoring.server");
    const screening = await screenTrendItems(workspaceId);

    try {
      const { logGrowthMindActivity } = await import("@/lib/growthmind/growthmind.activity.server");
      await logGrowthMindActivity({
        workspaceId,
        actor: "user",
        actorUserId: context.userId,
        category: "trends",
        action: "trends.discovery_run",
        summary: `Manual discovery found ${summary.totalNew} new items across ${summary.runs.filter(r => r.status === "success").length} sources; ${screening.screened} passed screening.`,
      });
    } catch { /* non-fatal */ }

    return { summary, screening };
  });

export const runTrendAiScoring = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    await assertMember(context.supabase, workspaceId, context.userId);

    const { scoreTrendItemsWithAI } = await import("@/lib/growthmind/trend-scoring.server");
    return await scoreTrendItemsWithAI(workspaceId, "user");
  });

// ── Item actions: save / ignore ────────────────────────────────────────────────

const ItemActionInput = z.object({
  id:     z.string().uuid(),
  action: z.enum(["save", "ignore", "restore", "analyse", "block_source", "add_to_monitoring"]),
});

export const applyTrendItemAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: z.infer<typeof ItemActionInput>) => ItemActionInput.parse(i))
  .handler(async ({ data, context }) => {
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    await assertMember(context.supabase, workspaceId, context.userId);

    const { getTrendAdminClient } = await import("@/lib/growthmind/trend-discovery.server");
    const admin = getTrendAdminClient() as any;

    // ── Analyse deeply: AI-score just this item (same DNA gate + cost logging) ──
    if (data.action === "analyse") {
      const { scoreTrendItemsWithAI } = await import("@/lib/growthmind/trend-scoring.server");
      const outcome = await scoreTrendItemsWithAI(workspaceId, "user", [data.id]);
      if (outcome.scored === 0 && outcome.rejected === 0) {
        throw new Error("Item could not be analysed (already archived or not found).");
      }
      return { id: data.id, status: outcome.scored > 0 ? "recommended" : "dismissed" };
    }

    // ── Source-derived actions need the item first ──────────────────────────────
    if (data.action === "block_source" || data.action === "add_to_monitoring") {
      const { data: item, error: itemErr } = await admin
        .from("growthmind_trend_items")
        .select("id, platform, author_handle, author_name")
        .eq("id", data.id)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (itemErr) throw new Error(`Failed to load item: ${itemErr.message}`);
      if (!item) throw new Error("Trend item not found");
      const handle = (item.author_handle ?? "").replace(/^@/, "").trim();
      if (!handle) throw new Error("This item has no account handle to act on.");

      const kind = data.action === "block_source" ? "excluded_account" : "industry_creator";
      const { error: srcErr } = await admin
        .from("growthmind_monitored_sources")
        .insert({
          workspace_id: workspaceId,
          source_kind:  kind,
          platform:     item.platform === "internal" ? null : item.platform,
          value:        handle,
          label:        item.author_name ?? null,
          added_by_user_id: context.userId,
        });
      // 23505 = source already exists — treat as done.
      if (srcErr && srcErr.code !== "23505") throw new Error(`Failed to update sources: ${srcErr.message}`);

      // Blocking a source also dismisses this item.
      if (data.action === "block_source") {
        await admin
          .from("growthmind_trend_items")
          .update({ status: "dismissed", updated_at: new Date().toISOString() })
          .eq("id", data.id)
          .eq("workspace_id", workspaceId);
        return { id: data.id, status: "dismissed" };
      }
      return { id: data.id, status: "monitoring_added" };
    }

    const status = data.action === "save" ? "recommended" : data.action === "ignore" ? "dismissed" : "screened";
    const { data: row, error } = await admin
      .from("growthmind_trend_items")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("workspace_id", workspaceId)
      .select("id, status")
      .maybeSingle();
    if (error) throw new Error(`Failed to update item: ${error.message}`);
    if (!row) throw new Error("Trend item not found");
    return { id: row.id, status: row.status };
  });

// ── Settings (cost controls) ──────────────────────────────────────────────────

const SettingsInput = z.object({
  dailyLimit: z.number().int().min(1).max(24).optional(),
  minScore:   z.number().int().min(0).max(100).optional(),
  enabled:    z.boolean().optional(),
});

export const updateTrendScoutSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: z.infer<typeof SettingsInput>) => SettingsInput.parse(i))
  .handler(async ({ data, context }) => {
    const workspaceId = context.workspaceId;
    const userId = context.userId;
    if (!workspaceId) throw new Error("No workspace");

    // Owner/admin only — cost controls affect spend.
    const { data: member, error: memErr } = await (context.supabase as any)
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .maybeSingle();
    if (memErr) throw new Error("Membership check failed");
    if (member?.role !== "owner" && member?.role !== "admin") {
      throw new Error("Only workspace owners and admins can change Trend Scout limits.");
    }

    const { getTrendAdminClient } = await import("@/lib/growthmind/trend-discovery.server");
    const admin = getTrendAdminClient() as any;

    const patch: Record<string, unknown> = {};
    if (data.dailyLimit !== undefined) patch.growthmind_discovery_daily_limit = data.dailyLimit;
    if (data.minScore !== undefined)   patch.growthmind_min_opportunity_score = data.minScore;
    if (data.enabled !== undefined)    patch.growthmind_trend_scout_enabled = data.enabled;
    if (Object.keys(patch).length === 0) return { ok: true };

    const { error } = await admin
      .from("workspace_settings")
      .update(patch)
      .eq("workspace_id", workspaceId);
    if (error) throw new Error(`Failed to update settings: ${error.message}`);
    return { ok: true };
  });

// ── Competitor intelligence ────────────────────────────────────────────────────

export const getCompetitorIntelligence = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const since30 = new Date(Date.now() - 30 * 86400000).toISOString();
    const [srcRes, itemsRes] = await Promise.all([
      sb.from("growthmind_monitored_sources")
        .select("*")
        .eq("workspace_id", workspaceId)
        .in("source_kind", ["competitor_direct", "competitor_indirect", "industry_creator", "aspirational_brand", "customer_account"])
        .order("priority", { ascending: false })
        .limit(100),
      sb.from("growthmind_trend_items")
        .select("*")
        .eq("workspace_id", workspaceId)
        .not("source_id", "is", null)
        .gte("discovered_at", since30)
        .order("discovered_at", { ascending: false })
        .limit(400),
    ]);
    if (srcRes.error)   throw new Error(`Failed to load sources: ${srcRes.error.message}`);
    if (itemsRes.error) throw new Error(`Failed to load items: ${itemsRes.error.message}`);

    const items = (itemsRes.data ?? []).map(mapItem);
    const bySource = new Map<string, TrendFeedItem[]>();
    for (const it of items) {
      if (!it.sourceId) continue;
      const arr = bySource.get(it.sourceId) ?? [];
      arr.push(it);
      bySource.set(it.sourceId, arr);
    }

    // Repeated topics across ALL monitored account content
    const topicCounts: Record<string, number> = {};
    for (const it of items) {
      const text = `${it.title ?? ""} ${it.caption ?? ""}`.toLowerCase();
      for (const w of new Set(text.split(/[^a-z0-9#]+/).filter(w => w.length > 4).slice(0, 20))) {
        topicCounts[w] = (topicCounts[w] ?? 0) + 1;
      }
    }
    const repeatedTopics = Object.entries(topicCounts)
      .filter(([, n]) => n >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([topic, count]) => ({ topic, count }));

    // Owned content topics (for gap analysis) — items marked owned in metrics
    const { data: ownedRows, error: ownErr } = await sb
      .from("growthmind_trend_items")
      .select("title, caption")
      .eq("workspace_id", workspaceId)
      .in("platform", ["instagram", "facebook"])
      .gte("discovered_at", since30)
      .contains("metrics", { owned: true })
      .limit(200);
    if (ownErr) throw new Error(`Failed to load owned content: ${ownErr.message}`);
    const ownedText = (ownedRows ?? []).map((r: any) => `${r.title ?? ""} ${r.caption ?? ""}`).join(" ").toLowerCase();
    const contentGaps = repeatedTopics.filter(t => !ownedText.includes(t.topic)).slice(0, 10);

    const accounts = (srcRes.data ?? []).map((s: any) => {
      const posts = bySource.get(s.id) ?? [];
      const successful = [...posts].sort((a, b) =>
        Number(b.scores.momentum ?? 0) - Number(a.scores.momentum ?? 0)).slice(0, 5);
      return {
        id: s.id, sourceKind: s.source_kind, platform: s.platform,
        value: s.value, label: s.label, status: s.status, priority: s.priority ?? 0,
        postCount30d: posts.length,
        topPosts: successful,
      };
    });

    return { accounts, repeatedTopics, contentGaps };
  });
