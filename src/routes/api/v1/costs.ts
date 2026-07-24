/**
 * WEBEE Developer API v1 — Costs
 * GET /api/v1/costs — provider cost breakdown for current period (billing:read)
 *
 * Query params: ?month=2026-06 (YYYY-MM, default current month)
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { authenticateV1Request, jsonOk, jsonErr } from "@/lib/developer-api/v1-auth.middleware";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const sb = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

export const Route = createFileRoute("/api/v1/costs")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await authenticateV1Request(request, "billing:read");
        if (!auth.ok) return auth.response;
        const { workspaceId } = auth.ctx;

        const url   = new URL(request.url);
        const now   = new Date();
        const month = url.searchParams.get("month") ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

        // Validate month format
        if (!/^\d{4}-\d{2}$/.test(month)) return jsonErr("month must be in YYYY-MM format");

        const startOfMonth = new Date(`${month}-01T00:00:00.000Z`).toISOString();
        const endOfMonth   = new Date(new Date(`${month}-01`).setMonth(new Date(`${month}-01`).getMonth() + 1)).toISOString();

        const client = sb() as any;

        const { data: rows, error } = await client.from("provider_usage")
          .select("provider_category, provider_name, requests, errors, total_cost_usd, total_duration_ms, units_consumed, unit_type")
          .eq("workspace_id", workspaceId)
          .gte("window_start", startOfMonth)
          .lt("window_start", endOfMonth);

        if (error) return jsonErr(error.message, 500);

        // Aggregate by category
        const byCategory: Record<string, { total_usd: number; providers: any[] }> = {};
        for (const r of (rows ?? []) as any[]) {
          const cat = r.provider_category ?? "other";
          if (!byCategory[cat]) byCategory[cat] = { total_usd: 0, providers: [] };
          const existing = byCategory[cat].providers.find((p: any) => p.name === r.provider_name);
          if (existing) {
            existing.requests    += r.requests ?? 0;
            existing.errors      += r.errors ?? 0;
            existing.cost_usd    += parseFloat(r.total_cost_usd ?? 0);
          } else {
            byCategory[cat].providers.push({
              name:          r.provider_name,
              requests:      r.requests ?? 0,
              errors:        r.errors ?? 0,
              cost_usd:      parseFloat(r.total_cost_usd ?? 0),
              duration_sec:  r.total_duration_ms ? Math.round(r.total_duration_ms / 1000) : null,
              units:         r.units_consumed ?? null,
              unit_type:     r.unit_type ?? null,
            });
          }
          byCategory[cat].total_usd += parseFloat(r.total_cost_usd ?? 0);
        }

        const grandTotal = Object.values(byCategory).reduce((s, c) => s + c.total_usd, 0);

        return jsonOk({
          object:      "costs",
          month,
          grand_total_usd: parseFloat(grandTotal.toFixed(4)),
          by_category: byCategory,
        });
      },
    },
  },
});
