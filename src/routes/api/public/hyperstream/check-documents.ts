/**
 * POST /api/public/hyperstream/check-documents
 *
 * HyperStream (OpenAI Realtime) custom-tool webhook. Called by tool-executor.ts
 * when the AI invokes `check_documents` mid-call.
 *
 * Body shape (sent by tool-executor.ts):
 *   { tool: "check_documents", args: { agent_id: "...", phone: "..." } }
 *
 * The `phone` arg should be the caller's number. If the agent passes it
 * explicitly from what it knows (e.g. inbound caller ID), great. If not,
 * the relay can inject `caller_phone` — handled here as a fallback.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { checkDocumentsByPhone } from "@/lib/documents/check-documents.server";

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

export const Route = createFileRoute("/api/public/hyperstream/check-documents")({
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
            summary: "I wasn't able to check documents — required information was missing.",
            documents_found: false,
            total_count: 0,
            client_count: 0,
            admin_count: 0,
            documents: [],
            upload_url: null,
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
            summary: "I wasn't able to look up documents due to a configuration issue.",
            documents_found: false,
            total_count: 0,
            client_count: 0,
            admin_count: 0,
            documents: [],
            upload_url: null,
          });
        }

        try {
          const result = await checkDocumentsByPhone(phone, agentRow.workspace_id as string);
          return json({ ok: true, ...result });
        } catch (err) {
          console.error("[check-documents/hyperstream] Error:", err);
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
