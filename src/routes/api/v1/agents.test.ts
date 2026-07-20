/**
 * WEBEE Developer API v1 — Agent Test Call
 * POST /api/v1/agents/test — initiate a test call from an agent (calls:trigger)
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { authenticateV1Request, jsonOk, jsonErr } from "@/lib/developer-api/v1-auth.middleware";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const sb = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

export const Route = createFileRoute("/api/v1/agents/test")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authenticateV1Request(request, "calls:trigger");
        if (!auth.ok) return auth.response;
        const { workspaceId } = auth.ctx;

        let body: any;
        try { body = await request.json(); } catch { return jsonErr("Invalid JSON body"); }

        const { agent_id, to_number, from_number } = body ?? {};
        if (!agent_id) return jsonErr("agent_id is required");
        if (!to_number) return jsonErr("to_number is required (E.164 format, e.g. +15005550001)");

        const { data: agent, error } = await sb().from("agents")
          .select("id, name, inbound_phone_number, settings")
          .eq("id", agent_id)
          .eq("workspace_id", workspaceId)
          .maybeSingle();

        if (error) return jsonErr(error.message, 500);
        if (!agent) return jsonErr("Agent not found", 404);

        const isDeployed = !!(
          (agent.settings as any)?.deployedRetellAgentId ||
          (agent.settings as any)?.deployedElevenLabsAgentId
        );
        if (!isDeployed) {
          return jsonErr("Agent must be deployed before a test call can be initiated. Deploy the agent in the Builder first.", 422);
        }

        const callRow = {
          workspace_id: workspaceId,
          agent_id:     agent.id,
          agent_name:   agent.name,
          call_type:    "outbound",
          call_status:  "initiated",
          from_number:  from_number ?? agent.inbound_phone_number ?? null,
          to_number,
          started_at:   new Date().toISOString(),
        };

        const { data: call, error: callErr } = await sb().from("calls")
          .insert(callRow)
          .select("id, call_status, from_number, to_number, started_at")
          .single();

        if (callErr) return jsonErr(callErr.message, 500);

        import("@/lib/developer-api/webhook-delivery.server")
          .then(m => m.fireWebhookEvent(workspaceId, "call.started", call))
          .catch(() => {});

        return jsonOk({ object: "call", ...call, mode: "test" }, 201);
      },
    },
  },
});
