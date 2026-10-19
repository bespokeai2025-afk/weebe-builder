/**
 * WEBEE Developer API v1 — Agents
 * GET /api/v1/agents — list workspace agents (agents:read)
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { authenticateV1Request, jsonOk, jsonErr } from "@/lib/developer-api/v1-auth.middleware";

// Untyped view of the shared service-role client (these routes predate the generated types).
const sb = () => supabaseAdmin as any;

export const Route = createFileRoute("/api/v1/agents")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await authenticateV1Request(request, "agents:read");
        if (!auth.ok) return auth.response;
        const { workspaceId } = auth.ctx;

        const { data, error } = await sb().from("agents")
          .select("id, name, inbound_phone_number, created_at, updated_at, settings")
          .eq("workspace_id", workspaceId)
          .order("created_at", { ascending: false });

        if (error) return jsonErr(error.message, 500);

        const agents = ((data ?? []) as any[]).map((a) => ({
          id:               a.id,
          name:             a.name,
          phone_number:     a.inbound_phone_number ?? null,
          is_deployed:      !!(a.settings?.deployedRetellAgentId || a.settings?.deployedElevenLabsAgentId),
          provider:         "webee_voice",
          created_at:       a.created_at,
          updated_at:       a.updated_at,
        }));

        return jsonOk({ object: "list", data: agents });
      },
    },
  },
});
