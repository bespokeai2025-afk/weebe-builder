/**
 * Server-side Mind conversation persistence (Shared Intelligence Contract).
 *
 * Conversations are scoped per workspace + user + Mind so the same chat
 * history appears on every device/browser. Web loads and appends through
 * these server functions; the mobile/API surface (/api/v1/minds/*) consumes
 * the SAME core service in conversations.service.ts — logic is never
 * duplicated between surfaces.
 *
 * All reads/writes go through the authenticated context.supabase client, so
 * workspace-members RLS applies on top of the explicit workspace/user
 * scoping in the core service.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  MINDS,
  MAX_CONTENT_CHARS,
  getOrCreateActiveConversationCore,
  appendMindMessagesCore,
  listMindConversationsCore,
  loadMindConversationMessagesCore,
  renameMindConversationCore,
  archiveMindConversationCore,
  type MindConvCtx,
} from "./conversations.service";

export type { MindName, MindConversationMessage, MindConversationSummary } from "./conversations.service";
export { MINDS } from "./conversations.service";

function ctxOf(context: any): MindConvCtx {
  const workspaceId = context.workspaceId as string | null;
  if (!workspaceId) throw new Error("No active workspace");
  return {
    sb: context.supabase,
    workspaceId,
    userId: context.userId as string,
  };
}

/**
 * Get (or create) the user's active conversation for a Mind, with its most
 * recent messages (chronological order). One call powers chat mount.
 */
export const getOrCreateActiveMindConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        mind: z.enum(MINDS),
        messageLimit: z.number().int().min(1).max(500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) =>
    getOrCreateActiveConversationCore(ctxOf(context), data),
  );

/** Append one or more messages (a user/assistant exchange) to a conversation. */
export const appendMindMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        conversationId: z.string().uuid(),
        messages: z
          .array(
            z.object({
              role: z.enum(["user", "assistant", "system", "tool"]),
              content: z.string().min(1).max(MAX_CONTENT_CHARS),
              toolRefs: z.unknown().optional(),
              createdRefs: z.unknown().optional(),
              metadata: z.unknown().optional(),
              clientMsgId: z.string().max(64).optional(),
            }),
          )
          .min(1)
          .max(10),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) =>
    appendMindMessagesCore(ctxOf(context), data),
  );

/** List the user's conversations for a Mind (most recent first). */
export const listMindConversations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        mind: z.enum(MINDS),
        includeArchived: z.boolean().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) =>
    listMindConversationsCore(ctxOf(context), data),
  );

/** Load older messages for a conversation (paginated, before a cursor). */
export const loadMindConversationMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        conversationId: z.string().uuid(),
        before: z.string().datetime({ offset: true }).optional(),
        limit: z.number().int().min(1).max(500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) =>
    loadMindConversationMessagesCore(ctxOf(context), data),
  );

/** Rename a conversation or update its current objective. */
export const renameMindConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        conversationId: z.string().uuid(),
        title: z.string().min(1).max(120).optional(),
        currentObjective: z.string().max(500).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) =>
    renameMindConversationCore(ctxOf(context), data),
  );

/**
 * Archive the conversation (starts a fresh one on next chat mount).
 * Used by "clear chat" — history is preserved server-side, never deleted.
 */
export const archiveMindConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ conversationId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) =>
    archiveMindConversationCore(ctxOf(context), data),
  );
