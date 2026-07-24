// ── AI usage & production cost summary (workspace-facing) ────────────────────
// Month-to-date usage costs for the current workspace, aggregated from:
//   - growthmind_generation_logs (GrowthMind / Content Studio text+media gen)
//   - provider_usage_log         (instrumented provider calls: voice, LLM,
//                                 image, video, WhatsApp, email, telephony…)
// Deliberately excludes billing profiles / margins — those are AccountsMind
// admin-only. This fn only exposes the workspace's own usage costs.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface AiUsageCostBucket {
  key: string;
  label: string;
  costUsd: number;
  events: number;
}

export interface AiUsageCostSummary {
  monthLabel: string;          // e.g. "July 2026"
  totalUsd: number;            // sum of everything below
  growthmindUsd: number;       // GrowthMind generation logs total
  growthmind: AiUsageCostBucket[]; // by task bucket (video / image / text)
  providers: AiUsageCostBucket[];  // provider_usage_log by category
}

function monthBounds(now: Date) {
  const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
  return { start, end };
}

const CATEGORY_LABELS: Record<string, string> = {
  llm: "AI text (LLM)",
  voice: "Voice & voiceover",
  image: "Image generation",
  video: "Video generation",
  whatsapp: "WhatsApp",
  email: "Email",
  telephony: "Telephony",
  storage: "Storage",
};

export const getAiUsageCosts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AiUsageCostSummary> => {
    const workspaceId = context.workspaceId!;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;

    const now = new Date();
    const { start, end } = monthBounds(now);

    // PostgREST silently caps responses at 1000 rows, so page explicitly.
    async function fetchAllRows(table: string, columns: string, extraEq?: [string, string]) {
      const PAGE = 1000;
      const MAX_PAGES = 50; // hard safety ceiling (50k rows/month)
      const rows: any[] = [];
      for (let page = 0; page < MAX_PAGES; page++) {
        let q = admin
          .from(table)
          .select(columns)
          .eq("workspace_id", workspaceId)
          .gte("created_at", start)
          .lt("created_at", end)
          .order("created_at", { ascending: true })
          .range(page * PAGE, page * PAGE + PAGE - 1);
        if (extraEq) q = q.eq(extraEq[0], extraEq[1]);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        rows.push(...(data ?? []));
        if (!data || data.length < PAGE) break;
      }
      return rows;
    }

    const [genRows, provRows] = await Promise.all([
      fetchAllRows("growthmind_generation_logs", "task_type,provider,estimated_cost_usd", ["status", "success"]),
      fetchAllRows("provider_usage_log", "provider_category,cost_usd"),
    ]);

    // GrowthMind generation logs → video / image / text buckets
    const gm: Record<string, AiUsageCostBucket> = {};
    let growthmindUsd = 0;
    for (const g of genRows as any[]) {
      const usd = Number(g.estimated_cost_usd ?? 0);
      const taskType = String(g.task_type ?? "").toLowerCase();
      const provider = String(g.provider ?? "").toLowerCase();
      let key = "text";
      let label = "Content generation (text)";
      if (taskType.includes("video") || provider === "veo" || provider === "runway") {
        key = "video"; label = "Video generation";
      } else if (taskType.includes("image") || provider.includes("imagen") || provider.includes("dall")) {
        key = "image"; label = "Image generation";
      }
      const b = (gm[key] ??= { key, label, costUsd: 0, events: 0 });
      b.costUsd += usd;
      b.events += 1;
      growthmindUsd += usd;
    }

    // Provider usage log → category buckets
    const pv: Record<string, AiUsageCostBucket> = {};
    let providersUsd = 0;
    for (const p of provRows as any[]) {
      const usd = Number(p.cost_usd ?? 0);
      const cat = String(p.provider_category ?? "other").toLowerCase();
      const b = (pv[cat] ??= {
        key: cat,
        label: CATEGORY_LABELS[cat] ?? cat.charAt(0).toUpperCase() + cat.slice(1),
        costUsd: 0,
        events: 0,
      });
      b.costUsd += usd;
      b.events += 1;
      providersUsd += usd;
    }

    const round = (n: number) => Math.round(n * 10000) / 10000;
    const sortDesc = (arr: AiUsageCostBucket[]) =>
      arr
        .map((b) => ({ ...b, costUsd: round(b.costUsd) }))
        .sort((a, b) => b.costUsd - a.costUsd);

    return {
      monthLabel: now.toLocaleDateString("en-GB", { month: "long", year: "numeric" }),
      totalUsd: round(growthmindUsd + providersUsd),
      growthmindUsd: round(growthmindUsd),
      growthmind: sortDesc(Object.values(gm)),
      providers: sortDesc(Object.values(pv)),
    };
  });
