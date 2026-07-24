/**
 * WEBEE Mind API — HiveMind actions (approval queue)
 * GET /api/v1/minds/actions[?status=pending&limit=200] — action list with
 *     pending count, including authoriser identities for the audit trail.
 *
 * Auth: user token OR workspace API key with `minds:read`.
 */
import { createFileRoute } from "@tanstack/react-router";
import { authenticateMindApiRequest } from "@/lib/developer-api/mind-auth.middleware";
import { jsonOk, jsonErr } from "@/lib/developer-api/v1-auth.middleware";

const STATUSES = ["pending", "approved", "executed", "failed", "rejected"] as const;

export const Route = createFileRoute("/api/v1/minds/actions")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await authenticateMindApiRequest(request, "minds:read");
        if (!auth.ok) return auth.response;
        const { workspaceId, supabase } = auth.ctx;

        const url = new URL(request.url);
        const status = url.searchParams.get("status");
        if (status && !(STATUSES as readonly string[]).includes(status)) {
          return jsonErr(`Invalid ?status — expected one of: ${STATUSES.join(", ")}`, 400);
        }
        const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "200") || 200, 1), 200);

        try {
          const sb = supabase ?? (await import("@/integrations/supabase/client.server")).supabaseAdmin;
          let q = (sb as any)
            .from("hivemind_actions")
            .select("*")
            .eq("workspace_id", workspaceId)
            .order("created_at", { ascending: false })
            .limit(limit);
          if (status) q = q.eq("status", status);
          const { data, error } = await q;
          if (error) return jsonErr(error.message, 500);
          const actions = data ?? [];

          // Resolve authoriser identities (best-effort, display-only) — same
          // enrichment as the web action centre.
          try {
            const userIds = [...new Set(actions.map((a: any) => a.authorised_by_user_id).filter(Boolean))] as string[];
            if (userIds.length > 0) {
              const { data: profs } = await (sb as any)
                .from("profiles")
                .select("user_id, email, full_name")
                .in("user_id", userIds);
              const byId = new Map<string, string>(
                (profs ?? []).map((p: any) => [p.user_id, p.full_name || p.email]),
              );
              for (const a of actions as any[]) {
                if (a.authorised_by_user_id) {
                  a.authorised_by_email = byId.get(a.authorised_by_user_id) ?? null;
                }
              }
            }
          } catch { /* display-only */ }

          const pending = actions.filter((a: any) => a.status === "pending").length;
          return jsonOk({ object: "list", actions, pending, total: actions.length });
        } catch (err: any) {
          return jsonErr(err?.message ?? "Failed to load actions", 500);
        }
      },
    },
  },
});
