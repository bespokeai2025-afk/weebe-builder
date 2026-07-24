/**
 * WEBEE Mind API — Approve a HiveMind action
 * POST /api/v1/minds/actions/:id/approve — body { "approved_by"?: string }
 *
 * Auth: Supabase user token ONLY. Runs the exact same shared approval core
 * as the web: mode gate, sensitive-category entitlement (fail closed),
 * atomic single-use CAS consume, post-consume re-validation, execution via
 * the audited Mind tool registry, recommendation follow-through.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { authenticateMindApiRequest } from "@/lib/developer-api/mind-auth.middleware";
import { jsonOk, jsonErr } from "@/lib/developer-api/v1-auth.middleware";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const Route = createFileRoute("/api/v1/minds/actions/$id/approve")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const auth = await authenticateMindApiRequest(request, "minds:execute", { requireUser: true });
        if (!auth.ok) return auth.response;
        const { workspaceId, userId, supabase } = auth.ctx;
        const id = (params as any).id as string;
        if (!UUID_RE.test(id)) return jsonErr("Invalid action id", 400);

        let approvedBy = "API User";
        try {
          const raw = await request.text();
          if (raw) {
            const body = z.object({ approved_by: z.string().min(1).max(120).optional() }).parse(JSON.parse(raw));
            if (body.approved_by) approvedBy = body.approved_by;
          }
        } catch (err: any) {
          return jsonErr(`Invalid request body: ${err?.message ?? "expected optional { approved_by }"}`, 400);
        }

        try {
          const { approveHiveMindActionCore } = await import("@/lib/hivemind/hivemind.actions");
          const out = await approveHiveMindActionCore(
            { sb: supabase, workspaceId, userId: userId! },
            { id, approved_by: approvedBy },
          );
          return jsonOk({ ok: true, status: "executed", result: out.result });
        } catch (err: any) {
          const msg = err?.message ?? "Approval failed";
          const status =
            /not pending|already processed/i.test(msg) ? 409 :
            /permission|entitlement|not allowed|denied/i.test(msg) ? 403 : 500;
          return jsonErr(msg, status);
        }
      },
    },
  },
});
