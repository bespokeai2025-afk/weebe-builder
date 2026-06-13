/**
 * POST /api/public/retell/check-documents
 *
 * Retell custom-tool webhook. Called mid-call when the AI invokes the
 * `check_documents` tool. Resolves the caller's workspace via agent_id,
 * looks up their documents, and returns a ready-to-speak summary.
 *
 * Retell body shape (after normalizeRetellPayload):
 *   { agent_id, phone?, retell_call_id?, call: { from_number, to_number, call_type } }
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { normalizeRetellPayload } from "@/lib/calendar/retell-payload";
import {
  checkDocumentsByPhone,
  extractPhoneFromRetellCall,
} from "@/lib/documents/check-documents.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-retell-signature",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

async function resolveWorkspaceFromAgent(agentId: string): Promise<string | null> {
  if (!agentId) return null;
  const sb = supabaseAdmin as any;

  // Try agents table first (builder agent or deployed clone)
  const { data: agentRow } = await sb
    .from("agents")
    .select("workspace_id")
    .or(`retell_agent_id.eq.${agentId},settings->>deployedRetellAgentId.eq.${agentId}`)
    .maybeSingle();
  if (agentRow?.workspace_id) return agentRow.workspace_id as string;

  // Fall back to workspace_settings default agent
  const { data: wsRow } = await sb
    .from("workspace_settings")
    .select("workspace_id")
    .eq("retell_default_agent_id", agentId)
    .maybeSingle();
  return (wsRow?.workspace_id as string | undefined) ?? null;
}

export const Route = createFileRoute("/api/public/retell/check-documents")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),

      POST: async ({ request }) => {
        const rawBody = await request.text();

        const payload = normalizeRetellPayload(rawBody);
        const agentId = (payload.agent_id as string | undefined)?.trim() ?? "";
        const explicitPhone = payload.phone as string | undefined;

        let parsed: Record<string, unknown> = {};
        try { parsed = JSON.parse(rawBody) as Record<string, unknown>; } catch { /* ignore */ }
        const call = (parsed.call as Record<string, unknown> | undefined) ?? {};

        const phone = extractPhoneFromRetellCall(explicitPhone, call);

        if (!phone) {
          return json({
            ok: false,
            summary: "I wasn't able to determine the phone number to look up documents for.",
            documents_found: false,
            total_count: 0,
            client_count: 0,
            admin_count: 0,
            documents: [],
            upload_url: null,
          });
        }

        const workspaceId = await resolveWorkspaceFromAgent(agentId);
        if (!workspaceId) {
          console.warn("[check-documents/retell] Unknown agent_id:", agentId);
          return json({
            ok: false,
            summary: "I wasn't able to look up documents at this time due to a configuration issue.",
            documents_found: false,
            total_count: 0,
            client_count: 0,
            admin_count: 0,
            documents: [],
            upload_url: null,
          });
        }

        try {
          const result = await checkDocumentsByPhone(phone, workspaceId);
          return json({ ok: true, ...result });
        } catch (err) {
          console.error("[check-documents/retell] Error:", err);
          return json({
            ok: false,
            summary: "I encountered an error checking your documents. Please try again.",
            documents_found: false,
            total_count: 0,
            client_count: 0,
            admin_count: 0,
            documents: [],
            upload_url: null,
          });
        }
      },
    },
  },
});
