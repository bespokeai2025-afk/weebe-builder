/**
 * WEBEE Developer API v1 — Analytics Overview
 * GET /api/v1/analytics — aggregate workspace metrics (analytics:read)
 *
 * Query params:
 *   ?days=30    — lookback window in days (default 30, max 365)
 *   ?agent_id=  — filter to one agent
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { authenticateV1Request, jsonOk, jsonErr } from "@/lib/developer-api/v1-auth.middleware";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const sb = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

export const Route = createFileRoute("/api/v1/analytics")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await authenticateV1Request(request, "analytics:read");
        if (!auth.ok) return auth.response;
        const { workspaceId } = auth.ctx;

        const url      = new URL(request.url);
        const days     = Math.min(parseInt(url.searchParams.get("days") ?? "30"), 365);
        const agentId  = url.searchParams.get("agent_id");
        const since    = new Date(Date.now() - days * 86_400_000).toISOString();

        const client = sb() as any;

        // Parallel fetch
        const [callsRes, leadsRes, bookingsRes] = await Promise.all([
          client.from("calls")
            .select("id, call_status, duration_seconds, sentiment, cost_cents, started_at")
            .eq("workspace_id", workspaceId)
            .gte("started_at", since)
            .then((r: any) => r),
          client.from("leads")
            .select("id, status, created_at")
            .eq("workspace_id", workspaceId)
            .gte("created_at", since)
            .then((r: any) => r),
          client.from("calendar_bookings")
            .select("id, status, created_at")
            .eq("workspace_id", workspaceId)
            .gte("created_at", since)
            .then((r: any) => r),
        ]);

        const calls    = (callsRes.data  ?? []) as any[];
        const leads    = (leadsRes.data  ?? []) as any[];
        const bookings = (bookingsRes.data ?? []) as any[];

        const completedCalls = calls.filter(c => c.call_status === "completed" || c.call_status === "ended");
        const totalDurationSec = completedCalls.reduce((s: number, c: any) => s + (c.duration_seconds ?? 0), 0);
        const totalCostCents   = calls.reduce((s: number, c: any) => s + (c.cost_cents ?? 0), 0);

        const sentimentCounts = calls.reduce((acc: Record<string, number>, c: any) => {
          if (c.sentiment) acc[c.sentiment] = (acc[c.sentiment] ?? 0) + 1;
          return acc;
        }, {});

        return jsonOk({
          object: "analytics",
          period_days: days,
          since,
          calls: {
            total:              calls.length,
            completed:          completedCalls.length,
            failed:             calls.filter(c => c.call_status === "failed" || c.call_status === "error").length,
            avg_duration_sec:   completedCalls.length ? Math.round(totalDurationSec / completedCalls.length) : 0,
            total_duration_min: Math.round(totalDurationSec / 60),
            total_cost_usd:     parseFloat((totalCostCents / 100).toFixed(2)),
            sentiment:          sentimentCounts,
          },
          leads: {
            total:      leads.length,
            by_status:  leads.reduce((acc: Record<string, number>, l: any) => {
              const s = l.status ?? "unknown";
              acc[s] = (acc[s] ?? 0) + 1;
              return acc;
            }, {}),
          },
          bookings: {
            total:      bookings.length,
            confirmed:  bookings.filter((b: any) => b.status === "confirmed").length,
            cancelled:  bookings.filter((b: any) => b.status === "cancelled").length,
          },
        });
      },
    },
  },
});
