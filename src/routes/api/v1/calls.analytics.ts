/**
 * WEBEE Developer API v1 — Call Analytics
 * GET /api/v1/calls/analytics — detailed call metrics (calls:analytics)
 *
 * Query params:
 *   ?days=30        — lookback window (default 30, max 365)
 *   ?agent_id=      — filter to one agent
 *   ?bucket=day|week — time-series bucket (default: day)
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { authenticateV1Request, jsonOk, jsonErr } from "@/lib/developer-api/v1-auth.middleware";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const sb = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

export const Route = createFileRoute("/api/v1/calls/analytics")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await authenticateV1Request(request, "calls:analytics");
        if (!auth.ok) return auth.response;
        const { workspaceId } = auth.ctx;

        const url     = new URL(request.url);
        const days    = Math.min(parseInt(url.searchParams.get("days") ?? "30"), 365);
        const agentId = url.searchParams.get("agent_id");
        const bucket  = url.searchParams.get("bucket") === "week" ? "week" : "day";
        const since   = new Date(Date.now() - days * 86_400_000).toISOString();

        let q = (sb() as any).from("calls")
          .select("id, call_status, call_type, duration_seconds, sentiment, cost_cents, started_at, ended_at, agent_id, agent_name, disconnection_reason")
          .eq("workspace_id", workspaceId)
          .gte("started_at", since)
          .order("started_at", { ascending: true });

        if (agentId) q = q.eq("agent_id", agentId);

        const { data: rows, error } = await q;
        if (error) return jsonErr(error.message, 500);
        const calls = (rows ?? []) as any[];

        // Time-series bucketing
        const bucketMap: Record<string, { count: number; completed: number; total_dur_sec: number; cost_cents: number }> = {};
        for (const c of calls) {
          const d    = new Date(c.started_at);
          let key: string;
          if (bucket === "week") {
            const startOfWeek = new Date(d);
            startOfWeek.setDate(d.getDate() - d.getDay());
            key = startOfWeek.toISOString().slice(0, 10);
          } else {
            key = d.toISOString().slice(0, 10);
          }
          if (!bucketMap[key]) bucketMap[key] = { count: 0, completed: 0, total_dur_sec: 0, cost_cents: 0 };
          bucketMap[key].count++;
          if (c.call_status === "completed" || c.call_status === "ended") {
            bucketMap[key].completed++;
            bucketMap[key].total_dur_sec += c.duration_seconds ?? 0;
          }
          bucketMap[key].cost_cents += c.cost_cents ?? 0;
        }

        const timeline = Object.entries(bucketMap).map(([date, v]) => ({
          date,
          calls:          v.count,
          completed:      v.completed,
          avg_duration_sec: v.completed ? Math.round(v.total_dur_sec / v.completed) : 0,
          cost_usd:       parseFloat((v.cost_cents / 100).toFixed(2)),
        }));

        // Agent breakdown
        const byAgent: Record<string, any> = {};
        for (const c of calls) {
          const key = c.agent_id ?? "unknown";
          if (!byAgent[key]) byAgent[key] = { agent_id: key, agent_name: c.agent_name ?? null, calls: 0, completed: 0, avg_duration_sec: 0, total_dur: 0 };
          byAgent[key].calls++;
          if (c.call_status === "completed" || c.call_status === "ended") {
            byAgent[key].completed++;
            byAgent[key].total_dur += c.duration_seconds ?? 0;
          }
        }
        const agents = Object.values(byAgent).map((a: any) => ({
          ...a,
          avg_duration_sec: a.completed ? Math.round(a.total_dur / a.completed) : 0,
          total_dur: undefined,
        }));

        const completedCalls = calls.filter(c => c.call_status === "completed" || c.call_status === "ended");
        const totalDur = completedCalls.reduce((s, c) => s + (c.duration_seconds ?? 0), 0);
        const sentimentCounts = calls.reduce((acc: Record<string, number>, c) => {
          if (c.sentiment) acc[c.sentiment] = (acc[c.sentiment] ?? 0) + 1;
          return acc;
        }, {});

        const disconnectReasons = calls.reduce((acc: Record<string, number>, c) => {
          if (c.disconnection_reason) acc[c.disconnection_reason] = (acc[c.disconnection_reason] ?? 0) + 1;
          return acc;
        }, {});

        return jsonOk({
          object: "call_analytics",
          period_days: days,
          since,
          bucket,
          summary: {
            total_calls:          calls.length,
            completed:            completedCalls.length,
            inbound:              calls.filter(c => c.call_type === "inbound").length,
            outbound:             calls.filter(c => c.call_type === "outbound").length,
            avg_duration_sec:     completedCalls.length ? Math.round(totalDur / completedCalls.length) : 0,
            total_duration_min:   Math.round(totalDur / 60),
            completion_rate_pct:  calls.length ? Math.round(completedCalls.length / calls.length * 100) : 0,
            total_cost_usd:       parseFloat((calls.reduce((s, c) => s + (c.cost_cents ?? 0), 0) / 100).toFixed(2)),
            sentiment:            sentimentCounts,
            disconnection_reasons: disconnectReasons,
          },
          timeline,
          by_agent: agents,
        });
      },
    },
  },
});
