/**
 * WEBEE Mind API — HiveMind task update
 * PATCH /api/v1/minds/tasks/:id — update status/priority/assignment/etc.
 *
 * Auth: Supabase user token ONLY (task lifecycle changes are user actions).
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { authenticateMindApiRequest } from "@/lib/developer-api/mind-auth.middleware";
import { jsonOk, jsonErr } from "@/lib/developer-api/v1-auth.middleware";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const Route = createFileRoute("/api/v1/minds/tasks/$id")({
  server: {
    handlers: {
      PATCH: async ({ request, params }) => {
        const auth = await authenticateMindApiRequest(request, "minds:execute", { requireUser: true });
        if (!auth.ok) return auth.response;
        const { workspaceId, supabase } = auth.ctx;
        const id = (params as any).id as string;
        if (!UUID_RE.test(id)) return jsonErr("Invalid task id", 400);

        let body: any;
        try {
          body = z
            .object({
              status: z.enum(["suggested", "approved", "in_progress", "completed"]).optional(),
              priority: z.enum(["low", "medium", "high", "critical"]).optional(),
              assigned_to: z.string().max(200).optional().nullable(),
              due_date: z.string().optional().nullable(),
              title: z.string().min(1).max(300).optional(),
              description: z.string().max(2000).optional().nullable(),
            })
            .parse(await request.json());
        } catch (err: any) {
          return jsonErr(`Invalid request body: ${err?.message ?? "no valid fields"}`, 400);
        }
        if (Object.keys(body).length === 0) {
          return jsonErr("Nothing to update — provide at least one field", 400);
        }

        try {
          const { updateHiveMindTaskCore } = await import("@/lib/hivemind/hivemind.tasks");
          await updateHiveMindTaskCore({ sb: supabase, workspaceId }, { id, ...body });
          return jsonOk({ ok: true });
        } catch (err: any) {
          return jsonErr(err?.message ?? "Failed to update task", 500);
        }
      },
    },
  },
});
