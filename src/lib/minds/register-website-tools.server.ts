/**
 * Website UX / conversion-diagnosis mind tools.
 *
 * Read-only evidence tools that combine Ads spend, SEO performance, Microsoft
 * Clarity behavioural signals and the conversion_events ledger to answer
 * "why are visitors not converting?" with real data — never invented metrics.
 * Missing data sources are reported as explicit limitations, not guessed.
 */
import { z } from "zod";
import { registerMindTool, type MindToolContext, type MindToolRunResult } from "./tool-registry.server";

registerMindTool({
  name: "hivemind.conversion_diagnosis",
  mind: "hivemind",
  title: "Why are visitors not converting?",
  description: "Combined conversion diagnosis: Ads spend/clicks, Search Console performance, Microsoft Clarity frustration signals (rage/dead clicks, quick-backs, excessive scrolling) and the conversion_events ledger. Every claim cites the underlying data; unavailable sources are listed as limitations, never invented.",
  access: "read",
  surface: "registry",
  sensitive: false,
  idempotent: true,
  estimatedCost: "none",
  platforms: ["web", "mobile", "api", "system"],
  featureFamily: "seo",
  capabilityState: "available",
  mobileAvailable: true,
  currentHealth: "healthy",
  inputSchema: z.object({ days: z.number().int().min(7).max(90).default(28) }),
  run: async (ctx: MindToolContext, input: any): Promise<MindToolRunResult> => {
    const { buildConversionDiagnosis } = await import("@/lib/growthmind/conversion-diagnosis.server");
    const r = await buildConversionDiagnosis(ctx.workspaceId, input.days);
    return { result: r as any };
  },
});

registerMindTool({
  name: "growthmind.website.get_ux_signals",
  mind: "growthmind",
  title: "Get website UX signals",
  description: "Microsoft Clarity behavioural signals per page (dead/rage clicks, excessive scroll, quick-backs, script errors) aggregated over synced days, plus the current Website Change Queue. Reports honestly when Clarity is not connected or has too little data.",
  access: "read",
  surface: "registry",
  sensitive: false,
  idempotent: true,
  estimatedCost: "none",
  platforms: ["web", "mobile", "api", "system"],
  featureFamily: "seo",
  capabilityState: "available",
  requiredIntegrations: ["microsoft_clarity"],
  mobileAvailable: true,
  currentHealth: "healthy",
  inputSchema: z.object({ days: z.number().int().min(2).max(30).default(7) }),
  run: async (ctx: MindToolContext, input: any): Promise<MindToolRunResult> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;
    const since = new Date(Date.now() - input.days * 86400_000).toISOString().slice(0, 10);
    const [{ data: metricRows }, { data: queue }] = await Promise.all([
      admin.from("clarity_metrics_daily")
        .select("metric_date, url, device, sessions, metrics")
        .eq("workspace_id", ctx.workspaceId)
        .gte("metric_date", since)
        .limit(5000),
      admin.from("website_change_queue")
        .select("id, title, page_url, change_type, status, score, confidence, why")
        .eq("workspace_id", ctx.workspaceId)
        .in("status", ["open", "executing", "handled"])
        .order("score", { ascending: false })
        .limit(20),
    ]);
    if (!metricRows?.length) {
      return {
        result: {
          available: false,
          limitation: "No Clarity behavioural data synced yet — connect Microsoft Clarity (Settings → Providers → Analytics) with a Data Export API token. Clarity's API only exposes the last 1-3 days per request (10 requests/day), so history builds up one day at a time.",
          changeQueue: queue ?? [],
        },
      };
    }
    const { aggregateClaritySignals } = await import("@/lib/growthmind/clarity-sync-core");
    const signals = aggregateClaritySignals(metricRows)
      .sort((a, b) => (b.deadClicks + b.rageClicks + b.quickbackClicks) - (a.deadClicks + a.rageClicks + a.quickbackClicks))
      .slice(0, 25);
    return { result: { available: true, windowDays: input.days, pageSignals: signals, changeQueue: queue ?? [] } };
  },
});
