/** Shared inbox thread shape + sort/highlight rules (WATI / Avenue Elite Properties). */

export type WhatsappChatStatus = "open" | "pending" | "solved";

export type WhatsappInboxThread = {
  phone: string;
  name: string | null;
  lastMessage: string | null;
  lastAt: string;
  /**
   * Unread inbound messages. Comes from whatsapp_conversations when a conversation row exists;
   * otherwise falls back to 1 when the contact replied last and needs a team response.
   */
  unread: number;
  lastDirection?: "inbound" | "outbound" | string;
  needsReply?: boolean;
  messages: any[];

  /** Conversation state — absent only when derived purely from messages. */
  conversationId?: string;
  status?: WhatsappChatStatus | string;
  assigneeId?: string | null;
  assignedTeamId?: string | null;
  tags?: string[];
  /** Free-form contact attributes mirrored from WATI. `any` so it passes serialization checks. */
  attributes?: Record<string, any>;
  lastReadAt?: string | null;

  /** WATI's own view of the chat, mirrored from its ticket events. */
  watiChatStatus?: string | null;
  watiTopic?: string | null;
  watiAgentName?: string | null;
  /** Last inbound message — the 24h reply window is measured from here. */
  lastInboundAt?: string | null;
  /** Where the newest outbound message came from: campaign / bot / template / wati. */
  lastMessageOrigin?: string | null;
};

/** True when the contact's message is the latest in the thread. */
export function threadNeedsReply(thread: {
  lastDirection?: string | null;
}): boolean {
  return thread.lastDirection === "inbound";
}

/** Replies waiting first, then most recent activity. */
export function sortWhatsappInboxThreads<T extends { lastAt: string; lastDirection?: string | null; needsReply?: boolean }>(
  threads: T[],
): T[] {
  return [...threads].sort((a, b) => {
    const aReply = a.needsReply ?? threadNeedsReply(a) ? 1 : 0;
    const bReply = b.needsReply ?? threadNeedsReply(b) ? 1 : 0;
    if (bReply !== aReply) return bReply - aReply;
    return new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime();
  });
}

export function buildWhatsappThreadFromMessages(
  phone: string,
  messages: Array<{
    contact_name?: string | null;
    body?: string | null;
    sent_at: string;
    direction: string;
    [key: string]: unknown;
  }>,
): WhatsappInboxThread | null {
  if (!messages.length) return null;
  const sorted = [...messages].sort(
    (a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime(),
  );
  const latest = sorted[sorted.length - 1]!;
  const name =
    sorted.find((m) => m.contact_name)?.contact_name ??
    latest.contact_name ??
    null;
  const needsReply = threadNeedsReply({ lastDirection: latest.direction });
  return {
    phone,
    name,
    lastMessage: latest.body ?? null,
    lastAt: latest.sent_at,
    lastDirection: latest.direction,
    needsReply,
    unread: needsReply ? 1 : 0,
    messages: sorted,
  };
}
