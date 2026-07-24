/**
 * WEBEE Mind API — Reject a HiveMind action
 * POST /api/v1/minds/actions/:id/reject
 *
 * Auth: Supabase user token ONLY. Uses the shared rejection core (also
 * reflects the outcome onto the source executive recommendation).
 */
import { createFileRoute } from "@tanstack/react-router";
import { authenticateMindApiRequest } from "@/lib/developer-api/mind-auth.middleware";
import { jsonOk, jsonErr } from "@/lib/developer-api/v1-auth.middleware";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const Route = createFileRoute("/api/v1/minds/actions/$id/reject")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const auth = await authenticateMindApiRequest(request, "minds:execute", { requireUser: true });
        if (!auth.ok) return auth.response;
        const { workspaceId, supabase } = auth.ctx;
        const id = (params as any).id as string;
        if (!UUID_RE.test(id)) return jsonErr("Invalid action id", 400);

        try {
          const { rejectHiveMindActionCore } = await import("@/lib/hivemind/hivemind.actions");
          await rejectHiveMindActionCore({ sb: supabase, workspaceId }, { id });
          return jsonOk({ ok: true, status: "rejected" });
        } catch (err: any) {
          return jsonErr(err?.message ?? "Rejection failed", 500);
        }
      },
    },
  },
});
