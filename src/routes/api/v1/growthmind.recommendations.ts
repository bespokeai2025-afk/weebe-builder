/**
 * WEBEE Developer API v1 — GrowthMind Recommendations
 * GET /api/v1/growthmind/recommendations — active growth recommendations (growthmind:read)
 *
 * Query params: ?limit=20, ?category=, ?priority=high|medium|low
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { authenticateV1Request, jsonOk, jsonErr } from "@/lib/developer-api/v1-auth.middleware";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const sb = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

export const Route = createFileRoute("/api/v1/growthmind/recommendations")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await authenticateV1Request(request, "growthmind:read");
        if (!auth.ok) return auth.response;
        const { workspaceId } = auth.ctx;

        const url      = new URL(request.url);
        const limit    = Math.min(parseInt(url.searchParams.get("limit") ?? "20"), 100);
        const category = url.searchParams.get("category");
        const priority = url.searchParams.get("priority");

        const client = sb() as any;

        // Fetch recommendations + opportunities in parallel
        const [recRes, oppRes] = await Promise.all([
          (() => {
            let q = client.from("growthmind_recommendations")
              .select("id, category, priority, problem, fix, impact, created_at, source")
              .eq("workspace_id", workspaceId)
              .eq("is_dismissed", false)
              .order("created_at", { ascending: false })
              .limit(limit);
            if (category) q = q.eq("category", category);
            if (priority)  q = q.eq("priority", priority);
            return q;
          })(),
          client.from("growthmind_opportunities")
            .select("id, title, recommended_action, urgency, score, created_at")
            .eq("workspace_id", workspaceId)
            .order("score", { ascending: false })
            .limit(10),
        ]);

        const recommendations = (recRes.data ?? []).map((r: any) => ({
          id:          r.id,
          type:        "recommendation",
          category:    r.category,
          priority:    r.priority,
          problem:     r.problem,
          fix:         r.fix,
          impact:      r.impact ?? null,
          source:      r.source ?? "analysis",
          created_at:  r.created_at,
        }));

        const opportunities = (oppRes.data ?? []).map((o: any) => ({
          id:                 o.id,
          type:               "opportunity",
          title:              o.title,
          recommended_action: o.recommended_action,
          urgency:            o.urgency,
          score:              o.score,
          created_at:         o.created_at,
        }));

        return jsonOk({
          object:          "list",
          recommendations,
          opportunities,
          total_recommendations: recommendations.length,
          total_opportunities:   opportunities.length,
        });
      },
    },
  },
});
