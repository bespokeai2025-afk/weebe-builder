/**
 * WEBEE Mind API — WhatsApp / BuzzChat conversation threads
 * GET /api/v1/whatsapp/conversations
 *     ?status=open|pending|solved &unread_only=true &limit &offset
 *       — workspace thread list, most recent activity first
 * GET /api/v1/whatsapp/conversations?phone=+447...
 *       — one thread's state + its recent messages (limit ≤ 200)
 * POST /api/v1/whatsapp/conversations
 *       { phone | conversation_id, body } — send an operator reply
 *
 * Auth: GET is dual (Supabase user JWT or workspace API key). POST is JWT-only
 * and requires the workspace's outbound-message action grant.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { authenticateMindApiRequest } from "@/lib/developer-api/mind-auth.middleware";
import { jsonOk, jsonErr } from "@/lib/developer-api/v1-auth.middleware";

const ReplyBodySchema = z
  .object({
    phone: z.string().min(1).max(40).optional(),
    to: z.string().min(1).max(40).optional(),
    conversation_id: z.string().min(1).max(200).optional(),
    body: z.string().trim().min(1).max(4096),
    contact_name: z.string().max(200).nullable().optional(),
  })
  .refine((value) => value.phone || value.to || value.conversation_id, {
    message: "Provide either 'phone', 'to', or 'conversation_id'",
  });

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
              // The schema calls this media_mime_type; keep the mobile
              // contract's message_type field stable via a PostgREST alias.
              .select(
                "id, direction, body, message_type:media_mime_type, status, sent_at, created_at",
              )
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
      POST: async ({ request }) => {
        const auth = await authenticateMindApiRequest(request, "contacts:write", {
          requireUser: true,
        });
        if (!auth.ok) return auth.response;
        const { workspaceId, userId } = auth.ctx;

        let body: z.infer<typeof ReplyBodySchema>;
        try {
          body = ReplyBodySchema.parse(await request.json());
        } catch (err: any) {
          return jsonErr(`Invalid request body: ${err?.message ?? "expected a reply body"}`, 400);
        }

        // Outbound replies are an operator action, not merely a contacts write.
        // The existing campaign_activation grant is the workspace's gate for
        // sending external WhatsApp messages and is checked fail-closed.
        try {
          const { requireAction } = await import("@/lib/permissions/permissions.server");
          await requireAction(workspaceId, userId, "campaign_activation");
        } catch (err: any) {
          return jsonErr(err?.message ?? "You are not permitted to send WhatsApp replies", 403);
        }

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const sb = supabaseAdmin as any;
          const convMod = await import("@/lib/whatsapp/whatsapp-conversations.server");
          const { sendWhatsAppMessageViaRuntime } = await import("@/lib/whatsapp/runtime");

          let contactPhone = body.phone ?? body.to ?? "";
          let contactName = body.contact_name ?? null;

          if (body.conversation_id) {
            const { data: thread, error: threadError } = await sb
              .from("whatsapp_conversations")
              .select("contact_phone, contact_name")
              .eq("workspace_id", workspaceId)
              .or(`id.eq.${body.conversation_id},conversation_id.eq.${body.conversation_id}`)
              .maybeSingle();
            if (threadError) return jsonErr(threadError.message, 500);
            if (!thread?.contact_phone) return jsonErr("Conversation not found", 404);
            contactPhone = thread.contact_phone;
            contactName = contactName ?? thread.contact_name ?? null;
          }

          contactPhone = contactPhone.replace(/^whatsapp:/i, "");
          const { normalizeWhatsAppPhone } = await import(
            "@/lib/whatsapp/wati-campaign.server"
          );
          const normalizedPhone = normalizeWhatsAppPhone(contactPhone);
          if (normalizedPhone.length < 7) return jsonErr("Invalid phone number", 400);

          const sent = await sendWhatsAppMessageViaRuntime({
            workspaceId,
            contactPhone: normalizedPhone,
            contactName,
            body: body.body,
          });
          await convMod.syncWhatsappConversation(workspaceId, normalizedPhone);

          const { data: thread } = await sb
            .from("whatsapp_conversations")
            .select(convMod.WHATSAPP_CONVERSATION_COLUMNS)
            .eq("workspace_id", workspaceId)
            .eq("contact_phone", normalizedPhone)
            .maybeSingle();

          return jsonOk({
            object: "whatsapp_message",
            message_id: sent.messageId,
            provider: sent.provider,
            thread: thread ?? null,
          });
        } catch (err: any) {
          return jsonErr(err?.message ?? "Failed to send WhatsApp reply", 500);
        }
      },
    },
  },
});
