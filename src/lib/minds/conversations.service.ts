/**
 * Mind conversation persistence — shared core service (SERVER ONLY).
 *
 * ONE implementation of every conversation operation, consumed by BOTH:
 *   - TanStack server functions (web) in conversations.functions.ts
 *   - /api/v1/minds/* routes (mobile / API clients)
 *
 * Callers pass an authenticated, user-JWT-bound Supabase client so
 * workspace-members RLS applies on top of the explicit workspace/user
 * scoping below. Never pass the service-role client from user-facing paths.
 */

export const MINDS = ["hivemind", "growthmind", "systemmind", "accountsmind"] as const;
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

export const MAX_CONTENT_CHARS = 20_000;

export interface MindConvCtx {
  sb: any;
  workspaceId: string;
  userId: string;
}

export function mapMessage(row: any): MindConversationMessage {
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

export function mapConversation(row: any): MindConversationSummary {
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
export async function requireOwnConversation(
  ctx: MindConvCtx,
  conversationId: string,
) {
  const { data, error } = await ctx.sb
    .from("mind_conversations")
    .select("*")
    .eq("id", conversationId)
    .eq("workspace_id", ctx.workspaceId)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load conversation: ${error.message}`);
  if (!data) throw new Error("Conversation not found");
  return data;
}

/**
 * Get (or create) the user's active conversation for a Mind, with its most
 * recent messages (chronological order).
 */
export async function getOrCreateActiveConversationCore(
  ctx: MindConvCtx,
  input: { mind: MindName; messageLimit?: number },
) {
  const { sb, workspaceId, userId } = ctx;
  const { data: existing, error: findErr } = await sb
    .from("mind_conversations")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .eq("mind", input.mind)
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(1);
  if (findErr) throw new Error(`Failed to load conversation: ${findErr.message}`);

  let conv = existing?.[0] ?? null;
  if (!conv) {
    const { data: created, error: insErr } = await sb
      .from("mind_conversations")
      .insert({ workspace_id: workspaceId, user_id: userId, mind: input.mind })
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
          .eq("mind", input.mind)
          .eq("status", "active")
          .limit(1);
        if (raceErr || !raced?.[0]) {
          throw new Error(
            `Failed to load conversation after race: ${raceErr?.message ?? "not found"}`,
          );
        }
        conv = raced[0];
      } else {
        throw new Error(`Failed to create conversation: ${insErr.message}`);
      }
    } else {
      conv = created;
    }
  }

  const limit = input.messageLimit ?? 200;
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
}

export interface AppendMessageInput {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolRefs?: unknown;
  createdRefs?: unknown;
  metadata?: unknown;
  clientMsgId?: string;
}

/** Append one or more messages (a user/assistant exchange) to a conversation. */
export async function appendMindMessagesCore(
  ctx: MindConvCtx,
  input: { conversationId: string; messages: AppendMessageInput[] },
) {
  const { sb, workspaceId, userId } = ctx;
  const conv = await requireOwnConversation(ctx, input.conversationId);

  let inserted = 0;
  // Row-by-row so a duplicate clientMsgId (retry) skips just that message.
  for (const m of input.messages) {
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
    const firstUser = input.messages.find((m) => m.role === "user");
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
}

/** List the user's conversations for a Mind (most recent first). */
export async function listMindConversationsCore(
  ctx: MindConvCtx,
  input: { mind: MindName; includeArchived?: boolean; limit?: number },
) {
  const { sb, workspaceId, userId } = ctx;
  let q = sb
    .from("mind_conversations")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .eq("mind", input.mind)
    .order("updated_at", { ascending: false })
    .limit(input.limit ?? 20);
  if (!input.includeArchived) q = q.eq("status", "active");

  const { data: rows, error } = await q;
  if (error) throw new Error(`Failed to list conversations: ${error.message}`);
  return { conversations: (rows ?? []).map(mapConversation), workspaceId };
}

/** Load older messages for a conversation (paginated, before a cursor). */
export async function loadMindConversationMessagesCore(
  ctx: MindConvCtx,
  input: { conversationId: string; before?: string; limit?: number },
) {
  const { sb, workspaceId } = ctx;
  await requireOwnConversation(ctx, input.conversationId);

  let q = sb
    .from("mind_conversation_messages")
    .select("*")
    .eq("conversation_id", input.conversationId)
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(input.limit ?? 100);
  if (input.before) q = q.lt("created_at", input.before);

  const { data: rows, error } = await q;
  if (error) throw new Error(`Failed to load messages: ${error.message}`);
  const messages = (rows ?? []).reverse().map(mapMessage);
  return { messages, hasMore: (rows ?? []).length === (input.limit ?? 100) };
}

/** Rename a conversation or update its current objective. */
export async function renameMindConversationCore(
  ctx: MindConvCtx,
  input: { conversationId: string; title?: string; currentObjective?: string | null },
) {
  const { sb, workspaceId, userId } = ctx;
  await requireOwnConversation(ctx, input.conversationId);

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.title !== undefined) update.title = input.title;
  if (input.currentObjective !== undefined) update.current_objective = input.currentObjective;

  const { error } = await sb
    .from("mind_conversations")
    .update(update)
    .eq("id", input.conversationId)
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId);
  if (error) throw new Error(`Failed to update conversation: ${error.message}`);
  return { ok: true };
}

/**
 * Archive the conversation (starts a fresh one on next chat mount).
 * History is preserved server-side, never deleted.
 */
export async function archiveMindConversationCore(
  ctx: MindConvCtx,
  input: { conversationId: string },
) {
  const { sb, workspaceId, userId } = ctx;
  await requireOwnConversation(ctx, input.conversationId);

  const { error } = await sb
    .from("mind_conversations")
    .update({ status: "archived", updated_at: new Date().toISOString() })
    .eq("id", input.conversationId)
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId);
  if (error) throw new Error(`Failed to archive conversation: ${error.message}`);
  return { ok: true };
}
