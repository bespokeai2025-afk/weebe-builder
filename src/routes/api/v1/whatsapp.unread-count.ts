/**
 * WEBEE Developer API v1 — WhatsApp unread count
 * GET /api/v1/whatsapp/unread-count
 *   → { unread_conversations: number, unread_messages: number }
 *
 * Auth: dual (Supabase user JWT with X-Workspace-Id, or workspace API key).
 */
import { createFileRoute } from "@tanstack/react-router";
import { authenticateMindApiRequest } from "@/lib/developer-api/mind-auth.middleware";
import { jsonOk, jsonErr } from "@/lib/developer-api/v1-auth.middleware";

export const Route = createFileRoute("/api/v1/whatsapp/unread-count")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await authenticateMindApiRequest(request, "contacts:read");
        if (!auth.ok) return auth.response;
        const { workspaceId } = auth.ctx;

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const sb = supabaseAdmin as any;

          // Count conversations with unread_count > 0 (open / pending only).
          const { data: convRows, error: convErr } = await sb
            .from("whatsapp_conversations")
            .select("unread_count")
            .eq("workspace_id", workspaceId)
            .gt("unread_count", 0)
            .in("status", ["open", "pending"]);

          if (convErr) return jsonErr(convErr.message, 500);

          const unreadConversations = (convRows ?? []).length;
          const unreadMessages = (convRows ?? []).reduce(
            (sum: number, r: any) => sum + (Number(r.unread_count) || 0),
            0,
          );

          return jsonOk({ unread_conversations: unreadConversations, unread_messages: unreadMessages });
        } catch (err: any) {
          return jsonErr(err?.message ?? "Failed to load unread count", 500);
        }
      },
    },
  },
});
