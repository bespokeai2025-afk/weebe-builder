/**
 * WEBEE Mind API — HiveMind tasks & events
 * GET  /api/v1/minds/tasks — tasks (assigned-record visibility honored for
 *      user tokens) + recent events + unread/badge counts.
 * POST /api/v1/minds/tasks — create a manual task (mode-gated: blocked in
 *      Observe mode, same as web). User token only.
 *
 * Auth: user token OR workspace API key with `minds:read` for GET;
 * POST requires a user token.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { authenticateMindApiRequest } from "@/lib/developer-api/mind-auth.middleware";
import { jsonOk, jsonErr } from "@/lib/developer-api/v1-auth.middleware";

export const Route = createFileRoute("/api/v1/minds/tasks")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await authenticateMindApiRequest(request, "minds:read");
        if (!auth.ok) return auth.response;
        const { workspaceId, userId, supabase } = auth.ctx;
        try {
          const { getHiveMindTasksAndEventsCore } = await import("@/lib/hivemind/hivemind.tasks");
          const sb = supabase ?? (await import("@/integrations/supabase/client.server")).supabaseAdmin;
          const out = await getHiveMindTasksAndEventsCore({ sb, workspaceId, userId });
          return jsonOk({
            object: "list",
            tasks: out.tasks,
            events: out.events,
            unread_events: out.unread,
            badge: out.badge,
          });
        } catch (err: any) {
          return jsonErr(err?.message ?? "Failed to load tasks", 500);
        }
      },

      POST: async ({ request }) => {
        const auth = await authenticateMindApiRequest(request, "minds:execute", { requireUser: true });
        if (!auth.ok) return auth.response;
        const { workspaceId, supabase } = auth.ctx;

        let body: any;
        try {
          body = z
            .object({
              title: z.string().min(1).max(300),
              description: z.string().max(2000).optional(),
              priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
              assigned_to: z.string().max(200).optional(),
              due_date: z.string().optional(),
            })
            .parse(await request.json());
        } catch (err: any) {
          return jsonErr(`Invalid request body: ${err?.message ?? "expected { title, ... }"}`, 400);
        }

        try {
          const { createHiveMindTaskCore } = await import("@/lib/hivemind/hivemind.tasks");
          const out = await createHiveMindTaskCore({ sb: supabase, workspaceId }, body);
          return jsonOk({ task: out.task }, 201);
        } catch (err: any) {
          return jsonErr(err?.message ?? "Failed to create task", 500);
        }
      },
    },
  },
});
