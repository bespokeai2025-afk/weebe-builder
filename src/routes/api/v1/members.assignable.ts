/**
 * WEBEE Mind API — Assignable members
 * GET /api/v1/members/assignable — active, non-suspended workspace members
 * a lead can be assigned to. Callers without the `lead_assignment` grant
 * get an empty list (they have no assignment picker).
 *
 * Auth: Supabase user JWT ONLY (result depends on the caller's grants).
 */
import { createFileRoute } from "@tanstack/react-router";
import { authenticateMindApiRequest } from "@/lib/developer-api/mind-auth.middleware";
import { jsonOk, jsonErr } from "@/lib/developer-api/v1-auth.middleware";

export const Route = createFileRoute("/api/v1/members/assignable")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await authenticateMindApiRequest(request, "leads:read", { requireUser: true });
        if (!auth.ok) return auth.response;
        const { workspaceId, userId } = auth.ctx;

        try {
          const { listAssignableMembersCore } = await import("@/lib/leads/lead-assignment.server");
          const members = await listAssignableMembersCore(workspaceId, userId!);
          return jsonOk({ object: "list", data: members });
        } catch (err: any) {
          const msg = err?.message ?? "Failed to list assignable members";
          return jsonErr(msg, /not a member/i.test(msg) ? 403 : 500);
        }
      },
    },
  },
});
