/**
 * WEBEE Mind API — WhatsApp / BuzzChat conversation threads (read-only)
 * GET /api/v1/whatsapp/conversations
 *     ?status=open|pending|solved &unread_only=true &limit &offset
 *       — workspace thread list, most recent activity first
 * GET /api/v1/whatsapp/conversations?phone=+447...
 *       — one thread's state + its recent messages (limit ≤ 200)
 *
 * Auth: dual (Supabase user JWT with X-Workspace-Id, or workspace API key
 * with contacts:read). Read-only — replying stays in the web inbox.
 */
import { createFileRoute } from "@tanstack/react-router";
import { authenticateMindApiRequest } from "@/lib/developer-api/mind-auth.middleware";
import { jsonOk, jsonErr } from "@/lib/developer-api/v1-auth.middleware";

export const Route = createFileRoute("/api/v1/whatsapp/conversations")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await authenticateMindApiRequest(request, "contacts:read");
        if (!auth.ok) return auth.response;
        const { workspaceId } = auth.ctx;

        const url = new URL(request.url);
        const phone = url.searchParams.get("phone");
        const status = url.searchParams.get("status");
        const unreadOnly = url.searchParams.get("unread_only") === "true";
        const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "50") || 50, 1), 200);
        const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0") || 0, 0);

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const sb = supabaseAdmin as any;
          const convMod = await import("@/lib/whatsapp/whatsapp-conversations.server");

          if (phone) {
            // Single thread + recent messages.
            const byPhone = await convMod.getWhatsappConversationsByPhone(sb, workspaceId, [phone]);
            const thread = byPhone.size ? [...byPhone.values()][0] : null;
            const contactPhone = thread?.contact_phone ?? phone;
            const { data: messages, error: msgErr } = await sb
              .from("whatsapp_messages")
              .select("id, direction, body, message_type, status, sent_at, created_at")
              .eq("workspace_id", workspaceId)
              .eq("contact_phone", contactPhone)
              .order("sent_at", { ascending: false })
              .limit(limit);
            if (msgErr) return jsonErr(msgErr.message, 500);
            return jsonOk({
              object: "whatsapp_thread",
              thread,
              messages: (messages ?? []).reverse(),
            });
          }

          let q = sb
            .from("whatsapp_conversations")
            .select(convMod.WHATSAPP_CONVERSATION_COLUMNS, { count: "exact" })
            .eq("workspace_id", workspaceId)
            .order("last_message_at", { ascending: false, nullsFirst: false })
            .range(offset, offset + limit - 1);
          if (status) {
            if (!convMod.isWhatsappChatStatus(status)) {
              return jsonErr(`status must be one of: ${convMod.WHATSAPP_CHAT_STATUSES.join(", ")}`, 400);
            }
            q = q.eq("status", status);
          }
          if (unreadOnly) q = q.gt("unread_count", 0);

          const { data: convRows, error, count } = await q;
          if (error) return jsonErr(error.message, 500);

          // Enrich each conversation with the linked lead_id (if any) by
          // looking up leads whose buzzchat_conversation_id matches the
          // conversation's contact_phone or conversation_id.
          const rows = convRows ?? [];
          let leadMap: Map<string, string> = new Map();
          try {
            const convIds: string[] = rows
              .map((r: any) => r.conversation_id ?? r.id)
              .filter(Boolean);
            const phones: string[] = rows
              .map((r: any) => r.contact_phone)
              .filter(Boolean);
            if (convIds.length > 0) {
              const { data: byConvId } = await sb
                .from("leads")
                .select("id, buzzchat_conversation_id, phone")
                .eq("workspace_id", workspaceId)
                .in("buzzchat_conversation_id", convIds);
              for (const l of byConvId ?? []) {
                if (l.buzzchat_conversation_id) leadMap.set(l.buzzchat_conversation_id, l.id);
              }
            }
            if (phones.length > 0) {
              const { data: byPhone } = await sb
                .from("leads")
                .select("id, phone")
                .eq("workspace_id", workspaceId)
                .in("phone", phones);
              for (const l of byPhone ?? []) {
                if (l.phone && !leadMap.has(l.phone)) leadMap.set(l.phone, l.id);
              }
            }
          } catch { /* enrichment is best-effort */ }

          const enriched = rows.map((r: any) => ({
            ...r,
            lead_id: leadMap.get(r.conversation_id ?? r.id) ?? leadMap.get(r.contact_phone) ?? null,
          }));

          return jsonOk({ object: "list", data: enriched, total: count ?? null, limit, offset });
        } catch (err: any) {
          return jsonErr(err?.message ?? "Failed to load conversations", 500);
        }
      },
    },
  },
});
