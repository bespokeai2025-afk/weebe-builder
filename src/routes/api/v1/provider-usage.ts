/**
 * WEBEE Developer API v1 — Provider Usage
 * GET /api/v1/provider-usage — per-provider request + cost metrics (billing:read)
 *
 * Query params: ?category=voice|llm|email|video|whatsapp, ?days=30
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { authenticateV1Request, jsonOk, jsonErr } from "@/lib/developer-api/v1-auth.middleware";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const sb = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

export const Route = createFileRoute("/api/v1/provider-usage")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await authenticateV1Request(request, "billing:read");
        if (!auth.ok) return auth.response;
        const { workspaceId } = auth.ctx;

        const url      = new URL(request.url);
        const days     = Math.min(parseInt(url.searchParams.get("days") ?? "30"), 365);
        const category = url.searchParams.get("category");
        const since    = new Date(Date.now() - days * 86_400_000).toISOString();

        let q = (sb() as any).from("provider_usage")
          .select("provider_category, provider_name, requests, errors, total_cost_usd, total_duration_ms, units_consumed, unit_type, window_start")
          .eq("workspace_id", workspaceId)
          .gte("window_start", since)
          .order("window_start", { ascending: false });

        if (category) q = q.eq("provider_category", category);

        const { data: rows, error } = await q;
        if (error) return jsonErr(error.message, 500);

        // Aggregate by provider_category + provider_name across all windows
        const aggMap: Record<string, any> = {};
        for (const r of (rows ?? []) as any[]) {
          const key = `${r.provider_category}:${r.provider_name}`;
          if (!aggMap[key]) {
            aggMap[key] = {
              category:      r.provider_category,
              provider:      r.provider_name,
              requests:      0,
              errors:        0,
              success_rate:  100,
              total_cost_usd: 0,
              total_duration_sec: 0,
              units_consumed: 0,
              unit_type:     r.unit_type ?? null,
            };
          }
          aggMap[key].requests        += r.requests ?? 0;
          aggMap[key].errors          += r.errors ?? 0;
          aggMap[key].total_cost_usd  += parseFloat(r.total_cost_usd ?? 0);
          aggMap[key].total_duration_sec += r.total_duration_ms ? Math.round(r.total_duration_ms / 1000) : 0;
          aggMap[key].units_consumed  += r.units_consumed ?? 0;
        }

        // Compute success rates and round costs
        const providers = Object.values(aggMap).map((p: any) => ({
          ...p,
          success_rate_pct: p.requests > 0 ? Math.round(((p.requests - p.errors) / p.requests) * 100) : 100,
          total_cost_usd:   parseFloat(p.total_cost_usd.toFixed(4)),
          avg_cost_per_request: p.requests > 0 ? parseFloat((p.total_cost_usd / p.requests).toFixed(6)) : 0,
        }));

        providers.sort((a: any, b: any) => b.total_cost_usd - a.total_cost_usd);

        return jsonOk({
          object:      "provider_usage",
          period_days: days,
          since,
          total_cost_usd: parseFloat(providers.reduce((s: number, p: any) => s + p.total_cost_usd, 0).toFixed(4)),
          providers,
        });
      },
    },
  },
});
