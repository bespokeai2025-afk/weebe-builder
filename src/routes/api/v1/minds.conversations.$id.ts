/**
 * WEBEE Mind API — Conversation management
 * PATCH  /api/v1/minds/conversations/:id — rename / set current objective
 *        body { "title"?: string, "current_objective"?: string|null }
 * DELETE /api/v1/minds/conversations/:id — archive ("clear chat"; history is
 *        preserved server-side, never deleted — same semantics as web).
 *
 * Auth: Supabase user token ONLY (per-user ownership enforced by the core
 * service + RLS via the user-bound client).
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { authenticateMindApiRequest } from "@/lib/developer-api/mind-auth.middleware";
import { jsonOk, jsonErr } from "@/lib/developer-api/v1-auth.middleware";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const Route = createFileRoute("/api/v1/minds/conversations/$id")({
  server: {
    handlers: {
      PATCH: async ({ request, params }) => {
        const auth = await authenticateMindApiRequest(request, "minds:read", { requireUser: true });
        if (!auth.ok) return auth.response;
        const { workspaceId, userId, supabase } = auth.ctx;
        const conversationId = (params as any).id as string;
        if (!UUID_RE.test(conversationId)) return jsonErr("Invalid conversation id", 400);

        let body: { title?: string; current_objective?: string | null };
        try {
          body = z
            .object({
              title: z.string().min(1).max(120).optional(),
              current_objective: z.string().max(500).nullable().optional(),
            })
            .parse(await request.json());
        } catch (err: any) {
          return jsonErr(`Invalid request body: ${err?.message ?? "expected { title? , current_objective? }"}`, 400);
        }
        if (body.title === undefined && body.current_objective === undefined) {
          return jsonErr("Nothing to update — provide title and/or current_objective", 400);
        }

        try {
          const { renameMindConversationCore } = await import("@/lib/minds/conversations.service");
          await renameMindConversationCore(
            { sb: supabase, workspaceId, userId: userId! },
            { conversationId, title: body.title, currentObjective: body.current_objective },
          );
          return jsonOk({ ok: true });
        } catch (err: any) {
          const msg = err?.message ?? "Failed to update conversation";
          return jsonErr(msg, msg === "Conversation not found" ? 404 : 500);
        }
      },

      DELETE: async ({ request, params }) => {
        const auth = await authenticateMindApiRequest(request, "minds:read", { requireUser: true });
        if (!auth.ok) return auth.response;
        const { workspaceId, userId, supabase } = auth.ctx;
        const conversationId = (params as any).id as string;
        if (!UUID_RE.test(conversationId)) return jsonErr("Invalid conversation id", 400);

        try {
          const { archiveMindConversationCore } = await import("@/lib/minds/conversations.service");
          await archiveMindConversationCore(
            { sb: supabase, workspaceId, userId: userId! },
            { conversationId },
          );
          return jsonOk({ ok: true, archived: true });
        } catch (err: any) {
          const msg = err?.message ?? "Failed to archive conversation";
          return jsonErr(msg, msg === "Conversation not found" ? 404 : 500);
        }
      },
    },
  },
});
