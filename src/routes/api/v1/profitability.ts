/**
 * WEBEE Developer API v1 — Profitability
 * GET /api/v1/profitability — per-call profitability and margin (billing:read)
 *
 * Query params: ?days=30, ?agent_id=, ?limit=100
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { authenticateV1Request, jsonOk, jsonErr } from "@/lib/developer-api/v1-auth.middleware";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const sb = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

export const Route = createFileRoute("/api/v1/profitability")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await authenticateV1Request(request, "billing:read");
        if (!auth.ok) return auth.response;
        const { workspaceId } = auth.ctx;

        const url     = new URL(request.url);
        const days    = Math.min(parseInt(url.searchParams.get("days") ?? "30"), 365);
        const agentId = url.searchParams.get("agent_id");
        const limit   = Math.min(parseInt(url.searchParams.get("limit") ?? "100"), 500);
        const since   = new Date(Date.now() - days * 86_400_000).toISOString();

        const client = sb() as any;

        // Try call_profitability view first, fall back to calls table
        let data: any[] = [];
        const { data: profRows, error: profErr } = await client.from("call_profitability")
          .select("call_id, agent_id, agent_name, duration_seconds, cost_cents, revenue_cents, profit_cents, margin_pct, started_at")
          .eq("workspace_id", workspaceId)
          .gte("started_at", since)
          .order("started_at", { ascending: false })
          .limit(limit);

        if (!profErr && profRows) {
          data = profRows;
        } else {
          // Fallback: use calls table with cost data
          let q = client.from("calls")
            .select("id, agent_id, agent_name, duration_seconds, cost_cents, call_status, started_at")
            .eq("workspace_id", workspaceId)
            .gte("started_at", since)
            .order("started_at", { ascending: false })
            .limit(limit);
          if (agentId) q = q.eq("agent_id", agentId);
          const { data: callRows } = await q;
          data = (callRows ?? []).map((c: any) => ({
            call_id:         c.id,
            agent_id:        c.agent_id,
            agent_name:      c.agent_name,
            duration_seconds: c.duration_seconds,
            cost_cents:      c.cost_cents ?? 0,
            revenue_cents:   null,
            profit_cents:    null,
            margin_pct:      null,
            started_at:      c.started_at,
          }));
        }

        const totalCost    = data.reduce((s, r) => s + (r.cost_cents ?? 0), 0);
        const totalRevenue = data.reduce((s, r) => s + (r.revenue_cents ?? 0), 0);
        const totalProfit  = data.reduce((s, r) => s + (r.profit_cents ?? 0), 0);

        return jsonOk({
          object:      "profitability",
          period_days: days,
          since,
          summary: {
            total_calls:       data.length,
            total_cost_usd:    parseFloat((totalCost / 100).toFixed(2)),
            total_revenue_usd: totalRevenue ? parseFloat((totalRevenue / 100).toFixed(2)) : null,
            total_profit_usd:  totalProfit  ? parseFloat((totalProfit  / 100).toFixed(2)) : null,
            avg_margin_pct:    data.filter(r => r.margin_pct != null).length > 0
              ? parseFloat((data.filter(r => r.margin_pct != null).reduce((s, r) => s + r.margin_pct, 0) / data.filter(r => r.margin_pct != null).length).toFixed(1))
              : null,
          },
          records: data.map(r => ({
            call_id:          r.call_id,
            agent_id:         r.agent_id,
            agent_name:       r.agent_name ?? null,
            duration_sec:     r.duration_seconds ?? null,
            cost_usd:         r.cost_cents != null ? parseFloat((r.cost_cents / 100).toFixed(4)) : null,
            revenue_usd:      r.revenue_cents != null ? parseFloat((r.revenue_cents / 100).toFixed(4)) : null,
            profit_usd:       r.profit_cents  != null ? parseFloat((r.profit_cents  / 100).toFixed(4)) : null,
            margin_pct:       r.margin_pct    ?? null,
            started_at:       r.started_at,
          })),
        });
      },
    },
  },
});
