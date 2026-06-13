/**
 * POST /api/public/retell/send-upload-link
 *
 * Retell custom-tool webhook. Called mid-call when the AI invokes the
 * `send_upload_link` tool. Finds the contact by phone, generates their
 * secure upload URL, and sends it as an SMS via Twilio.
 *
 * Retell body shape (after normalizeRetellPayload):
 *   { agent_id, phone?, call: { from_number, to_number, call_type } }
 *
 * The `phone` arg is used if explicitly passed by the agent; otherwise
 * the call direction (inbound → from_number, outbound → to_number) is used.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { normalizeRetellPayload } from "@/lib/calendar/retell-payload";
import { extractPhoneFromRetellCall } from "@/lib/documents/check-documents.server";
import { sendUploadLinkByPhone } from "@/lib/documents/send-upload-link.server";

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

  const { data: agentRow } = await sb
    .from("agents")
    .select("workspace_id")
    .or(`retell_agent_id.eq.${agentId},settings->>deployedRetellAgentId.eq.${agentId}`)
    .maybeSingle();
  if (agentRow?.workspace_id) return agentRow.workspace_id as string;

  const { data: wsRow } = await sb
    .from("workspace_settings")
    .select("workspace_id")
    .eq("retell_default_agent_id", agentId)
    .maybeSingle();
  return (wsRow?.workspace_id as string | undefined) ?? null;
}

export const Route = createFileRoute("/api/public/retell/send-upload-link")({
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
            sms_sent: false,
            upload_url: null,
            summary:
              "I wasn't able to determine the phone number to send the upload link to.",
          });
        }

        const workspaceId = await resolveWorkspaceFromAgent(agentId);
        if (!workspaceId) {
          console.warn("[send-upload-link/retell] Unknown agent_id:", agentId);
          return json({
            ok: false,
            sms_sent: false,
            upload_url: null,
            summary:
              "I wasn't able to generate an upload link at this time due to a configuration issue.",
          });
        }

        try {
          const result = await sendUploadLinkByPhone(phone, workspaceId);
          return json({ ...result });
        } catch (err) {
          console.error("[send-upload-link/retell] Error:", err);
          return json({
            ok: false,
            sms_sent: false,
            upload_url: null,
            summary:
              "I encountered an error generating your upload link. Please try again.",
          });
        }
      },
    },
  },
});
