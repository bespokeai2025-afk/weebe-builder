/**
 * WEBEE Mind API — Conversations
 * GET  /api/v1/minds/conversations?mind=hivemind[&include_archived=true][&limit=20]
 * POST /api/v1/minds/conversations — body { "mind": "hivemind"[, "message_limit": 200] }
 *      → get-or-create the user's ACTIVE conversation with recent messages
 *        (same call that powers web chat mount).
 *
 * Auth: Supabase user token ONLY (conversations are per-user).
 * All reads/writes use the user-JWT-bound client, so RLS applies exactly
 * as on the web.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { authenticateMindApiRequest } from "@/lib/developer-api/mind-auth.middleware";
import { jsonOk, jsonErr } from "@/lib/developer-api/v1-auth.middleware";
import { MINDS } from "@/lib/minds/conversations.service";

export const Route = createFileRoute("/api/v1/minds/conversations")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await authenticateMindApiRequest(request, "minds:read", { requireUser: true });
        if (!auth.ok) return auth.response;
        const { workspaceId, userId, supabase } = auth.ctx;

        const url = new URL(request.url);
        const mind = url.searchParams.get("mind") ?? "";
        if (!(MINDS as readonly string[]).includes(mind)) {
          return jsonErr(`Invalid or missing ?mind — expected one of: ${MINDS.join(", ")}`, 400);
        }
        const includeArchived = url.searchParams.get("include_archived") === "true";
        const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "20") || 20, 1), 100);

        try {
          const { listMindConversationsCore } = await import("@/lib/minds/conversations.service");
          const out = await listMindConversationsCore(
            { sb: supabase, workspaceId, userId: userId! },
            { mind: mind as any, includeArchived, limit },
          );
          return jsonOk({
            object: "list",
            conversations: out.conversations,
            workspace_id: out.workspaceId,
            total: out.conversations.length,
          });
        } catch (err: any) {
          return jsonErr(err?.message ?? "Failed to list conversations", 500);
        }
      },

      POST: async ({ request }) => {
        const auth = await authenticateMindApiRequest(request, "minds:read", { requireUser: true });
        if (!auth.ok) return auth.response;
        const { workspaceId, userId, supabase } = auth.ctx;

        let body: { mind: string; message_limit?: number };
        try {
          body = z
            .object({
              mind: z.enum(MINDS),
              message_limit: z.number().int().min(1).max(500).optional(),
            })
            .parse(await request.json());
        } catch (err: any) {
          return jsonErr(`Invalid request body: ${err?.message ?? "expected { mind }"}`, 400);
        }

        try {
          const { getOrCreateActiveConversationCore } = await import("@/lib/minds/conversations.service");
          const out = await getOrCreateActiveConversationCore(
            { sb: supabase, workspaceId, userId: userId! },
            { mind: body.mind as any, messageLimit: body.message_limit },
          );
          return jsonOk({
            conversation: out.conversation,
            messages: out.messages,
            workspace_id: out.workspaceId,
          });
        } catch (err: any) {
          return jsonErr(err?.message ?? "Failed to open conversation", 500);
        }
      },
    },
  },
});
