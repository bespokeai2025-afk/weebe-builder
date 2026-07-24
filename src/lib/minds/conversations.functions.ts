/**
 * Server-side Mind conversation persistence (Shared Intelligence Contract).
 *
 * Conversations are scoped per workspace + user + Mind so the same chat
 * history appears on every device/browser. Web (and later mobile/API) load
 * and append through these functions; localStorage is never authoritative.
 *
 * All reads/writes go through the authenticated context.supabase client, so
 * workspace-members RLS applies on top of the explicit workspace/user scoping
 * below.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const MINDS = ["hivemind", "growthmind", "systemmind", "accountsmind"] as const;
export type MindName = (typeof MINDS)[number];

export type MindConversationMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolRefs: unknown | null;
  createdRefs: unknown | null;
  metadata: unknown | null;
  clientMsgId: string | null;
  createdAt: string;
};

export type MindConversationSummary = {
  id: string;
  mind: MindName;
  title: string | null;
  status: "active" | "archived";
  currentObjective: string | null;
  messageCount: number;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const MAX_CONTENT_CHARS = 20_000;

function mapMessage(row: any): MindConversationMessage {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    toolRefs: row.tool_refs ?? null,
    createdRefs: row.created_refs ?? null,
    metadata: row.metadata ?? null,
    clientMsgId: row.client_msg_id ?? null,
    createdAt: row.created_at,
  };
}

function mapConversation(row: any): MindConversationSummary {
  return {
    id: row.id,
    mind: row.mind,
    title: row.title ?? null,
    status: row.status,
    currentObjective: row.current_objective ?? null,
    messageCount: row.message_count ?? 0,
    lastMessageAt: row.last_message_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Assert a conversation belongs to this workspace + user; returns the row. */
async function requireOwnConversation(
  sb: any,
  workspaceId: string,
  userId: string,
  conversationId: string,
) {
  const { data, error } = await sb
    .from("mind_conversations")
    .select("*")
    .eq("id", conversationId)
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load conversation: ${error.message}`);
  if (!data) throw new Error("Conversation not found");
  return data;
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
  .handler(async ({ data, context }) => {
    const sb = (context as any).supabase;
    const workspaceId = (context as any).workspaceId as string | null;
    const userId = (context as any).userId as string;
    if (!workspaceId) throw new Error("No active workspace");

    const { data: existing, error: findErr } = await sb
      .from("mind_conversations")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .eq("mind", data.mind)
      .eq("status", "active")
      .order("updated_at", { ascending: false })
      .limit(1);
    if (findErr) throw new Error(`Failed to load conversation: ${findErr.message}`);

    let conv = existing?.[0] ?? null;
    if (!conv) {
      const { data: created, error: insErr } = await sb
        .from("mind_conversations")
        .insert({ workspace_id: workspaceId, user_id: userId, mind: data.mind })
        .select("*")
        .single();
      if (insErr) {
        if (insErr.code === "23505") {
          // Concurrent first-load created it — re-select the active row.
          const { data: raced, error: raceErr } = await sb
            .from("mind_conversations")
            .select("*")
            .eq("workspace_id", workspaceId)
            .eq("user_id", userId)
            .eq("mind", data.mind)
            .eq("status", "active")
            .limit(1);
          if (raceErr || !raced?.[0]) {
            throw new Error(`Failed to load conversation after race: ${raceErr?.message ?? "not found"}`);
          }
          conv = raced[0];
        } else {
          throw new Error(`Failed to create conversation: ${insErr.message}`);
        }
      } else {
        conv = created;
      }
    }

    const limit = data.messageLimit ?? 200;
    // Fetch newest N, then reverse to chronological.
    const { data: msgs, error: msgErr } = await sb
      .from("mind_conversation_messages")
      .select("*")
      .eq("conversation_id", conv.id)
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (msgErr) throw new Error(`Failed to load messages: ${msgErr.message}`);

    return {
      conversation: mapConversation(conv),
      messages: (msgs ?? []).reverse().map(mapMessage),
      workspaceId,
    };
  });

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
  .handler(async ({ data, context }) => {
    const sb = (context as any).supabase;
    const workspaceId = (context as any).workspaceId as string | null;
    const userId = (context as any).userId as string;
    if (!workspaceId) throw new Error("No active workspace");

    const conv = await requireOwnConversation(sb, workspaceId, userId, data.conversationId);

    let inserted = 0;
    // Row-by-row so a duplicate clientMsgId (retry) skips just that message.
    for (const m of data.messages) {
      const { error } = await sb.from("mind_conversation_messages").insert({
        conversation_id: conv.id,
        workspace_id: workspaceId,
        user_id: userId,
        role: m.role,
        content: m.content,
        tool_refs: m.toolRefs ?? null,
        created_refs: m.createdRefs ?? null,
        metadata: m.metadata ?? null,
        client_msg_id: m.clientMsgId ?? null,
      });
      if (error) {
        if (error.code === "23505") continue; // idempotent retry — already stored
        throw new Error(`Failed to save message: ${error.message}`);
      }
      inserted++;
    }

    if (inserted > 0) {
      const firstUser = data.messages.find((m) => m.role === "user");
      const update: Record<string, unknown> = {
        message_count: (conv.message_count ?? 0) + inserted,
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      if (!conv.title && firstUser) {
        update.title = firstUser.content.slice(0, 80);
      }
      const { error: upErr } = await sb
        .from("mind_conversations")
        .update(update)
        .eq("id", conv.id)
        .eq("workspace_id", workspaceId)
        .eq("user_id", userId);
      if (upErr) console.warn("[mind-conversations] counter update failed:", upErr.message);
    }

    return { inserted };
  });

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
  .handler(async ({ data, context }) => {
    const sb = (context as any).supabase;
    const workspaceId = (context as any).workspaceId as string | null;
    const userId = (context as any).userId as string;
    if (!workspaceId) throw new Error("No active workspace");

    let q = sb
      .from("mind_conversations")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .eq("mind", data.mind)
      .order("updated_at", { ascending: false })
      .limit(data.limit ?? 20);
    if (!data.includeArchived) q = q.eq("status", "active");

    const { data: rows, error } = await q;
    if (error) throw new Error(`Failed to list conversations: ${error.message}`);
    return { conversations: (rows ?? []).map(mapConversation), workspaceId };
  });

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
  .handler(async ({ data, context }) => {
    const sb = (context as any).supabase;
    const workspaceId = (context as any).workspaceId as string | null;
    const userId = (context as any).userId as string;
    if (!workspaceId) throw new Error("No active workspace");

    await requireOwnConversation(sb, workspaceId, userId, data.conversationId);

    let q = sb
      .from("mind_conversation_messages")
      .select("*")
      .eq("conversation_id", data.conversationId)
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 100);
    if (data.before) q = q.lt("created_at", data.before);

    const { data: rows, error } = await q;
    if (error) throw new Error(`Failed to load messages: ${error.message}`);
    const messages = (rows ?? []).reverse().map(mapMessage);
    return { messages, hasMore: (rows ?? []).length === (data.limit ?? 100) };
  });

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
  .handler(async ({ data, context }) => {
    const sb = (context as any).supabase;
    const workspaceId = (context as any).workspaceId as string | null;
    const userId = (context as any).userId as string;
    if (!workspaceId) throw new Error("No active workspace");

    await requireOwnConversation(sb, workspaceId, userId, data.conversationId);

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.title !== undefined) update.title = data.title;
    if (data.currentObjective !== undefined) update.current_objective = data.currentObjective;

    const { error } = await sb
      .from("mind_conversations")
      .update(update)
      .eq("id", data.conversationId)
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId);
    if (error) throw new Error(`Failed to update conversation: ${error.message}`);
    return { ok: true };
  });

/**
 * Archive the conversation (starts a fresh one on next chat mount).
 * Used by "clear chat" — history is preserved server-side, never deleted.
 */
export const archiveMindConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ conversationId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const sb = (context as any).supabase;
    const workspaceId = (context as any).workspaceId as string | null;
    const userId = (context as any).userId as string;
    if (!workspaceId) throw new Error("No active workspace");

    await requireOwnConversation(sb, workspaceId, userId, data.conversationId);

    const { error } = await sb
      .from("mind_conversations")
      .update({ status: "archived", updated_at: new Date().toISOString() })
      .eq("id", data.conversationId)
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId);
    if (error) throw new Error(`Failed to archive conversation: ${error.message}`);
    return { ok: true };
  });
