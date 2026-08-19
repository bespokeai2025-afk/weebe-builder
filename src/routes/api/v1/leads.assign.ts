/**
 * WEBEE Mind API — Lead assignment
 * GET  /api/v1/leads/assign?lead_id=... — assignment history for one lead
 * POST /api/v1/leads/assign             — assign / reassign / unassign
 *      body: { "lead_ids": [...], "assigned_to": "<user id>" | null }
 *
 * Auth: Supabase user JWT ONLY — assignment is a person-scoped permission
 * (`lead_assignment` action grant, enforced fail-closed inside the shared
 * core). History respects assigned-records-only roles.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { authenticateMindApiRequest } from "@/lib/developer-api/mind-auth.middleware";
import { jsonOk, jsonErr } from "@/lib/developer-api/v1-auth.middleware";

export const Route = createFileRoute("/api/v1/leads/assign")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await authenticateMindApiRequest(request, "leads:read", { requireUser: true });
        if (!auth.ok) return auth.response;
        const { workspaceId, userId } = auth.ctx;

        const leadId = new URL(request.url).searchParams.get("lead_id");
        if (!leadId) return jsonErr("lead_id query parameter is required", 400);

        try {
          const { getLeadAssignmentHistoryCore } = await import("@/lib/leads/lead-assignment.server");
          const rows = await getLeadAssignmentHistoryCore(workspaceId, userId!, leadId);
          return jsonOk({ object: "list", data: rows });
        } catch (err: any) {
          const msg = err?.message ?? "Failed to load assignment history";
          return jsonErr(msg, /not a member/i.test(msg) ? 403 : 500);
        }
      },

      POST: async ({ request }) => {
        const auth = await authenticateMindApiRequest(request, "leads:write", { requireUser: true });
        if (!auth.ok) return auth.response;
        const { workspaceId, userId } = auth.ctx;

        let body: { lead_ids: string[]; assigned_to: string | null };
        try {
          body = z
            .object({
              lead_ids: z.array(z.string().min(1)).min(1).max(200),
              assigned_to: z.string().uuid().nullable(),
            })
            .parse(await request.json());
        } catch (err: any) {
          return jsonErr(`Invalid request body: ${err?.message ?? "expected { lead_ids, assigned_to }"}`, 400);
        }

        try {
          const { assignLeadsCore } = await import("@/lib/leads/lead-assignment.server");
          const out = await assignLeadsCore(workspaceId, userId!, {
            leadIds: body.lead_ids,
            assignedTo: body.assigned_to,
          });
          return jsonOk({ object: "assignment_result", ...out });
        } catch (err: any) {
          const msg = err?.message ?? "Failed to assign leads";
          const forbidden = /not (a member|permitted)|permission|not available|suspended/i.test(msg);
          return jsonErr(msg, forbidden ? 403 : 500);
        }
      },
    },
  },
});
