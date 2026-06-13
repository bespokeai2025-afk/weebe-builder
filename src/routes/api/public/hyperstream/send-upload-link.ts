/**
 * POST /api/public/hyperstream/send-upload-link
 *
 * HyperStream (OpenAI Realtime) custom-tool webhook. Called by tool-executor.ts
 * when the AI invokes `send_upload_link` mid-call.
 *
 * Body shape (sent by tool-executor.ts):
 *   { tool: "send_upload_link", args: { agent_id: "...", phone: "..." } }
 *
 * The agent is identified by its internal UUID (not a Retell agent ID).
 * Workspace is resolved directly from the agents table.
 *
 * NOTE: This endpoint is intentionally separate from the Retell endpoint.
 *       Do not merge or share request-parsing logic between the two.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendUploadLinkByPhone } from "@/lib/documents/send-upload-link.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const Body = z.object({
  agent_id: z.string().min(1).max(128),
  phone: z.string().min(1).max(60),
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/public/hyperstream/send-upload-link")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),

      POST: async ({ request }) => {
        const body = await request.json().catch(() => null) as Record<string, unknown> | null;
        const args = (body?.args ?? body ?? {}) as Record<string, unknown>;

        const parsed = Body.safeParse(args);
        if (!parsed.success) {
          return json({
            ok: false,
            sms_sent: false,
            upload_url: null,
            summary:
              "I wasn't able to send the upload link — required information was missing.",
          });
        }

        const { agent_id, phone } = parsed.data;
        const sb = supabaseAdmin as any;

        const { data: agentRow } = await sb
          .from("agents")
          .select("workspace_id")
          .eq("id", agent_id)
          .maybeSingle();

        if (!agentRow?.workspace_id) {
          return json({
            ok: false,
            sms_sent: false,
            upload_url: null,
            summary:
              "I wasn't able to generate an upload link due to a configuration issue.",
          });
        }

        try {
          const result = await sendUploadLinkByPhone(phone, agentRow.workspace_id as string);
          return json({ ...result });
        } catch (err) {
          console.error("[send-upload-link/hyperstream] Error:", err);
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
