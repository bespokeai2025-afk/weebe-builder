/**
 * WEBEE Mind API — Executive summary
 * GET /api/v1/minds/summary — one call for a mobile home screen:
 *     executive recommendations (with linked follow-through actions),
 *     pending approval count, open task / unread event badges.
 *
 * Auth: user token OR workspace API key with `minds:read`.
 */
import { createFileRoute } from "@tanstack/react-router";
import { authenticateMindApiRequest } from "@/lib/developer-api/mind-auth.middleware";
import { jsonOk, jsonErr } from "@/lib/developer-api/v1-auth.middleware";

export const Route = createFileRoute("/api/v1/minds/summary")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await authenticateMindApiRequest(request, "minds:read");
        if (!auth.ok) return auth.response;
        const { workspaceId, userId, supabase } = auth.ctx;

        try {
          const sb = supabase ?? (await import("@/integrations/supabase/client.server")).supabaseAdmin;

          const { listExecutiveRecommendationsCore } = await import("@/lib/hivemind/executive-recommendations");
          const { getHiveMindTasksAndEventsCore } = await import("@/lib/hivemind/hivemind.tasks");

          const [recs, tasksOut, pendingRes] = await Promise.all([
            listExecutiveRecommendationsCore({ sb, workspaceId }),
            getHiveMindTasksAndEventsCore({ sb, workspaceId, userId }),
            (sb as any)
              .from("hivemind_actions")
              .select("id", { count: "exact", head: true })
              .eq("workspace_id", workspaceId)
              .eq("status", "pending"),
          ]);

          const openTasks = tasksOut.tasks.filter(
            (t: any) => t.status !== "completed",
          ).length;

          return jsonOk({
            recommendations: recs.recommendations,
            linked_actions: recs.linkedActions,
            open_recommendations: recs.openCount,
            pending_approvals: pendingRes.count ?? 0,
            open_tasks: openTasks,
            unread_events: tasksOut.unread,
            badge: tasksOut.badge,
          });
        } catch (err: any) {
          return jsonErr(err?.message ?? "Failed to build summary", 500);
        }
      },
    },
  },
});
