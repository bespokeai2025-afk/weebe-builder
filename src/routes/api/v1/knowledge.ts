/**
 * WEBEE Developer API v1 — Knowledge
 * POST /api/v1/knowledge — upload a text/URL knowledge document (knowledge:write)
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { authenticateV1Request, jsonOk, jsonErr } from "@/lib/developer-api/v1-auth.middleware";

// Untyped view of the shared service-role client (these routes predate the generated types).
const sb = () => supabaseAdmin as any;

export const Route = createFileRoute("/api/v1/knowledge")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authenticateV1Request(request, "knowledge:write");
        if (!auth.ok) return auth.response;
        const { workspaceId } = auth.ctx;

        let body: any;
        try { body = await request.json(); }
        catch { return jsonErr("Invalid JSON body"); }

        const { agent_id, title, content, url, type } = body ?? {};
        if (!title) return jsonErr("title is required");
        if (!content && !url) return jsonErr("Either content (text) or url is required");
        if (!agent_id) return jsonErr("agent_id is required");

        // Verify agent belongs to workspace
        const { data: agent } = await sb().from("agents")
          .select("id")
          .eq("id", agent_id)
          .eq("workspace_id", workspaceId)
          .maybeSingle();

        if (!agent) return jsonErr("Agent not found or does not belong to this workspace", 404);

        const docType = type ?? (url ? "url" : "text");

        const { data, error } = await sb().from("knowledge_documents").insert({
          workspace_id: workspaceId,
          agent_id,
          title,
          content:      content ?? null,
          source_url:   url ?? null,
          doc_type:     docType,
          status:       "pending_index",
          created_at:   new Date().toISOString(),
          updated_at:   new Date().toISOString(),
        }).select("id, title, doc_type, status, created_at").single();

        if (error) return jsonErr(error.message, 500);

        import("@/lib/developer-api/webhook-delivery.server")
          .then(m => m.fireWebhookEvent(workspaceId, "document.uploaded", data))
          .catch(() => {});

        return jsonOk({ object: "knowledge_document", ...data }, 201);
      },
    },
  },
});
