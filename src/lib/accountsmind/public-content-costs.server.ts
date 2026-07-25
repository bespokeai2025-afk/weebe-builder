/**
 * AccountsMind — Public Content Publishing cost tracking (§15 continuation programme).
 *
 * Evidence-only: aggregates recorded generation logs (research, article,
 * image, safety-check task types) and publication execution counts.
 * Cost per published article = recorded content-generation spend ÷ published
 * article count. Organic lead / revenue attribution is reported honestly:
 * "Unknown" until GSC + lead-source evidence links exist — never invented.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const sb = supabaseAdmin as any;

const CONTENT_TASK_TYPES = [
  "article_research", "article_generation", "content_generation", "blog_article",
  "image_generation", "safety_check", "content_safety_check", "seo_article",
];

export interface PublicContentCostSummary {
  generatedAt: string;
  windowDays: number;
  generation: {
    totalCostUsd: number;
    byTaskType: Record<string, { costUsd: number; runs: number }>;
    loggedRuns: number;
  };
  publication: {
    executionsTotal: number;
    completed: number;
    deadLetter: number;
    executionCostNote: string;
  };
  publishedArticles: number;
  costPerPublishedArticleUsd: number | null;
  organicAttribution: {
    costPerOrganicLead: string;
    costPerQualifiedOrganicLead: string;
    attributedOrganicRevenue: string;
    attributionState: "Attributed" | "Partially Attributed" | "Unknown";
    note: string;
  };
}

export async function getPublicContentCostSummary(workspaceId: string, windowDays = 90): Promise<PublicContentCostSummary> {
  const since = new Date(Date.now() - windowDays * 86400_000).toISOString();

  const [logsRes, execRes, deadRes, pubRes] = await Promise.all([
    sb.from("growthmind_generation_logs")
      .select("task_type, estimated_cost_usd, status")
      .eq("workspace_id", workspaceId)
      .gte("created_at", since)
      .limit(5000),
    sb.from("growthmind_publication_executions")
      .select("id, status", { count: "exact" })
      .eq("workspace_id", workspaceId)
      .gte("created_at", since)
      .limit(1000),
    sb.from("growthmind_publication_executions")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("status", "dead_letter"),
    sb.from("growthmind_public_content_items")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .in("status", ["api_published", "awaiting_website_refresh", "live", "live_verification_failed"]),
  ]);

  const logs: any[] = (logsRes.data ?? []).filter((l: any) =>
    CONTENT_TASK_TYPES.includes(String(l.task_type ?? "")) || /article|content|image|safety/i.test(String(l.task_type ?? "")));
  const byTaskType: Record<string, { costUsd: number; runs: number }> = {};
  let total = 0;
  for (const l of logs) {
    const t = String(l.task_type ?? "unknown");
    const c = Number(l.estimated_cost_usd ?? 0);
    byTaskType[t] = byTaskType[t] ?? { costUsd: 0, runs: 0 };
    byTaskType[t].costUsd = Math.round((byTaskType[t].costUsd + c) * 10000) / 10000;
    byTaskType[t].runs += 1;
    total += c;
  }
  total = Math.round(total * 10000) / 10000;

  const executions: any[] = execRes.data ?? [];
  const published = pubRes.count ?? 0;

  return {
    generatedAt: new Date().toISOString(),
    windowDays,
    generation: { totalCostUsd: total, byTaskType, loggedRuns: logs.length },
    publication: {
      executionsTotal: execRes.count ?? executions.length,
      completed: executions.filter((e) => e.status === "completed").length,
      deadLetter: deadRes.count ?? 0,
      executionCostNote: "Publication executions are internal database operations — no external provider spend is incurred per execution.",
    },
    publishedArticles: published,
    costPerPublishedArticleUsd: published > 0 ? Math.round((total / published) * 10000) / 10000 : null,
    organicAttribution: {
      costPerOrganicLead: "Unknown",
      costPerQualifiedOrganicLead: "Unknown",
      attributedOrganicRevenue: "Unknown",
      attributionState: "Unknown",
      note: "No published article is live on the Lovable frontend yet, and no lead carries organic-search source evidence linked to a published article. Attribution stays Unknown until real evidence exists — it is never estimated.",
    },
  };
}
