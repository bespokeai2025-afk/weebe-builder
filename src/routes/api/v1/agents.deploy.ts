/**
 * WEBEE Developer API v1 — Agent Deploy
 * POST /api/v1/agents/deploy — trigger agent deployment (agents:deploy)
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { authenticateV1Request, jsonOk, jsonErr } from "@/lib/developer-api/v1-auth.middleware";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const sb = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

export const Route = createFileRoute("/api/v1/agents/deploy")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authenticateV1Request(request, "agents:deploy");
        if (!auth.ok) return auth.response;
        const { workspaceId } = auth.ctx;

        let body: any;
        try { body = await request.json(); } catch { return jsonErr("Invalid JSON body"); }

        const { agent_id } = body ?? {};
        if (!agent_id) return jsonErr("agent_id is required");

        const { data: agent, error } = await sb().from("agents")
          .select("id, name, settings")
          .eq("id", agent_id)
          .eq("workspace_id", workspaceId)
          .maybeSingle();

        if (error) return jsonErr(error.message, 500);
        if (!agent) return jsonErr("Agent not found", 404);

        const isDeployed = !!(
          (agent.settings as any)?.deployedRetellAgentId ||
          (agent.settings as any)?.deployedElevenLabsAgentId ||
          (agent.settings as any)?.deploymentMode
        );

        import("@/lib/developer-api/webhook-delivery.server")
          .then(m => m.fireWebhookEvent(workspaceId, "agent.deployed", {
            agent_id: agent.id,
            name:     agent.name,
            status:   "deploy_requested",
          }))
          .catch(() => {});

        return jsonOk({
          object:     "agent_deploy",
          agent_id:   agent.id,
          name:       agent.name,
          status:     isDeployed ? "already_deployed" : "deploy_requested",
          message:    isDeployed
            ? "Agent is already deployed. Open the Builder to re-deploy with updated configuration."
            : "Deployment requested. Open the Builder to complete deployment with your voice provider.",
        });
      },
    },
  },
});
