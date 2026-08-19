/**
 * WEBEE Developer API v1 — Mark WhatsApp conversation as read
 * POST /api/v1/whatsapp/conversations/mark-read
 *   Body: { phone: string } OR { conversation_id: string }
 *   → { ok: true, updated: number }
 *
 * Resets unread_count to 0 for the matching conversation.
 * Auth: dual (Supabase user JWT with X-Workspace-Id, or workspace API key
 * with contacts:read — read scope is sufficient; marking-read is low-risk).
 */
import { createFileRoute } from "@tanstack/react-router";
import { authenticateMindApiRequest } from "@/lib/developer-api/mind-auth.middleware";
import { jsonOk, jsonErr } from "@/lib/developer-api/v1-auth.middleware";

export const Route = createFileRoute("/api/v1/whatsapp/conversations/mark-read")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authenticateMindApiRequest(request, "contacts:read");
        if (!auth.ok) return auth.response;
        const { workspaceId } = auth.ctx;

        let body: any;
        try { body = await request.json(); }
        catch { return jsonErr("Request body must be JSON", 400); }

        const phone: string | null = typeof body?.phone === "string" ? body.phone.trim() : null;
        const conversationId: string | null =
          typeof body?.conversation_id === "string" ? body.conversation_id.trim() : null;

        if (!phone && !conversationId) {
          return jsonErr("Provide either 'phone' or 'conversation_id'", 400);
        }

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const sb = supabaseAdmin as any;

          let q = sb
            .from("whatsapp_conversations")
            .update({ unread_count: 0 })
            .eq("workspace_id", workspaceId);

          if (conversationId) {
            q = q.or(`id.eq.${conversationId},conversation_id.eq.${conversationId}`);
          } else {
            q = q.eq("contact_phone", phone);
          }

          const { error, count } = await q;
          if (error) return jsonErr(error.message, 500);

          return jsonOk({ ok: true, updated: count ?? 0 });
        } catch (err: any) {
          return jsonErr(err?.message ?? "Failed to mark conversation read", 500);
        }
      },
    },
  },
});
