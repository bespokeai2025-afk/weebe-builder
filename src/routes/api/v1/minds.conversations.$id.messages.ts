/**
 * WEBEE Mind API — Conversation messages
 * GET  /api/v1/minds/conversations/:id/messages[?before=<ISO>&limit=100]
 *      — paginated history (chronological; `before` cursors backwards).
 * POST /api/v1/minds/conversations/:id/messages
 *      body { "messages": [{ role, content, client_msg_id?, tool_refs?, created_refs?, metadata? }, ...] }
 *      — append up to 10 messages; duplicate client_msg_id retries are
 *        skipped idempotently (same semantics as web).
 *
 * Auth: Supabase user token ONLY.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { authenticateMindApiRequest } from "@/lib/developer-api/mind-auth.middleware";
import { jsonOk, jsonErr } from "@/lib/developer-api/v1-auth.middleware";
import { MAX_CONTENT_CHARS } from "@/lib/minds/conversations.service";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const Route = createFileRoute("/api/v1/minds/conversations/$id/messages")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const auth = await authenticateMindApiRequest(request, "minds:read", { requireUser: true });
        if (!auth.ok) return auth.response;
        const { workspaceId, userId, supabase } = auth.ctx;
        const conversationId = (params as any).id as string;
        if (!UUID_RE.test(conversationId)) return jsonErr("Invalid conversation id", 400);

        const url = new URL(request.url);
        const before = url.searchParams.get("before") ?? undefined;
        if (before && Number.isNaN(Date.parse(before))) {
          return jsonErr("Invalid ?before — expected an ISO timestamp", 400);
        }
        const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "100") || 100, 1), 500);

        try {
          const { loadMindConversationMessagesCore } = await import("@/lib/minds/conversations.service");
          const out = await loadMindConversationMessagesCore(
            { sb: supabase, workspaceId, userId: userId! },
            { conversationId, before, limit },
          );
          return jsonOk({
            object: "list",
            messages: out.messages,
            has_more: out.hasMore,
            total: out.messages.length,
          });
        } catch (err: any) {
          const msg = err?.message ?? "Failed to load messages";
          return jsonErr(msg, msg === "Conversation not found" ? 404 : 500);
        }
      },

      POST: async ({ request, params }) => {
        const auth = await authenticateMindApiRequest(request, "minds:read", { requireUser: true });
        if (!auth.ok) return auth.response;
        const { workspaceId, userId, supabase } = auth.ctx;
        const conversationId = (params as any).id as string;
        if (!UUID_RE.test(conversationId)) return jsonErr("Invalid conversation id", 400);

        let body: any;
        try {
          body = z
            .object({
              messages: z
                .array(
                  z.object({
                    role: z.enum(["user", "assistant", "system", "tool"]),
                    content: z.string().min(1).max(MAX_CONTENT_CHARS),
                    tool_refs: z.unknown().optional(),
                    created_refs: z.unknown().optional(),
                    metadata: z.unknown().optional(),
                    client_msg_id: z.string().max(64).optional(),
                  }),
                )
                .min(1)
                .max(10),
            })
            .parse(await request.json());
        } catch (err: any) {
          return jsonErr(`Invalid request body: ${err?.message ?? "expected { messages: [...] }"}`, 400);
        }

        try {
          const { appendMindMessagesCore } = await import("@/lib/minds/conversations.service");
          const out = await appendMindMessagesCore(
            { sb: supabase, workspaceId, userId: userId! },
            {
              conversationId,
              messages: body.messages.map((m: any) => ({
                role: m.role,
                content: m.content,
                toolRefs: m.tool_refs,
                createdRefs: m.created_refs,
                metadata: m.metadata,
                clientMsgId: m.client_msg_id,
              })),
            },
          );
          return jsonOk({ ok: true, inserted: out.inserted }, 201);
        } catch (err: any) {
          const msg = err?.message ?? "Failed to append messages";
          return jsonErr(msg, msg === "Conversation not found" ? 404 : 500);
        }
      },
    },
  },
});
