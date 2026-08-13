/**
 * WATI chat status — the "Expired" / "Open" / "Solved" chips shown on each chat in WATI's inbox.
 *
 * WATI has no chat-list endpoint, so this state is only available as `eventType: "ticket"` rows
 * interleaved with the messages returned by getMessages, e.g.
 *
 *   type=0  "The chat has been initialized by contact <name> (<phone>)"
 *   type=1  "The ticket status has been set as Open by agent Bot"
 *   type=4  "The chat has been expired (after 24 hours of last received message)"
 *
 * The numeric `type` codes are undocumented, so the human-readable description is the primary
 * signal and the code is only a tie-breaker.
 */

/** WhatsApp closes the free-form messaging window 24h after the customer's last message. */
export const WATI_SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

export const WATI_CHAT_STATUSES = ["open", "pending", "solved", "expired"] as const;
export type WatiChatStatus = (typeof WATI_CHAT_STATUSES)[number];

export type WatiTicketEvent = {
  status: WatiChatStatus;
  /** Operator named in the description ("…by agent Bot"), used for the inbox's operator label. */
  agentName: string | null;
  topicName: string | null;
  at: string;
};

export type WatiChatState = {
  status: WatiChatStatus | null;
  agentName: string | null;
  topicName: string | null;
  statusAt: string | null;
};

function classifyTicketDescription(description: string): WatiChatStatus | null {
  const d = description.toLowerCase();
  if (d.includes("expired")) return "expired";
  if (/\bsolved\b|\bresolved\b|has been closed/.test(d)) return "solved";
  if (/\bpending\b/.test(d)) return "pending";
  if (/\bopen(ed)?\b|reopen|initialized/.test(d)) return "open";
  return null;
}

/**
 * Read a chat-status change out of one getMessages row.
 * Returns null for anything that is not a recognised ticket event.
 */
export function parseWatiTicketEvent(msg: Record<string, unknown>): WatiTicketEvent | null {
  const eventType = String(msg.eventType ?? "").toLowerCase();
  if (eventType !== "ticket") return null;

  const description = String(msg.eventDescription ?? msg.detailedEventDescription ?? "");
  const status = classifyTicketDescription(description);
  if (!status) return null;

  // "…by agent Bot" — WATI omits this on contact-driven events such as expiry.
  const agentMatch = /by agent\s+(.+?)\s*$/i.exec(description);
  const agentName = agentMatch?.[1]?.trim() || null;

  const topicRaw = msg.topicName == null ? "" : String(msg.topicName).trim();
  const created = String(msg.created ?? msg.timestamp ?? "");
  const at = Number.isNaN(Date.parse(created)) ? new Date().toISOString() : created;

  return { status, agentName, topicName: topicRaw || null, at };
}

/**
 * Webhook variant of {@link parseWatiTicketEvent}.
 *
 * Webhook payloads don't reliably carry `eventType: "ticket"` the way getMessages rows do, so a
 * classifiable `eventDescription` is accepted on its own. Callers must run this only after the
 * message branches so it can never swallow an actual message.
 */
export function parseWatiTicketWebhook(
  payload: Record<string, unknown>,
): WatiTicketEvent | null {
  const description = String(payload.eventDescription ?? payload.detailedEventDescription ?? "");
  if (!description.trim()) return null;
  return parseWatiTicketEvent({ ...payload, eventType: "ticket", eventDescription: description });
}

/**
 * Collapse a conversation's ticket events into its current state — latest event wins.
 *
 * `agentName` and `topicName` fall back to the most recent event that carried them, since the
 * newest status change (typically an automatic expiry) usually names neither.
 */
export function deriveWatiChatState(messages: Array<Record<string, unknown>>): WatiChatState {
  const events: WatiTicketEvent[] = [];
  for (const msg of messages) {
    const event = parseWatiTicketEvent(msg);
    if (event) events.push(event);
  }
  if (events.length === 0)
    return { status: null, agentName: null, topicName: null, statusAt: null };

  events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const latest = events[events.length - 1]!;

  const lastWith = <K extends "agentName" | "topicName">(key: K): string | null => {
    for (let i = events.length - 1; i >= 0; i--) {
      const value = events[i]![key];
      if (value) return value;
    }
    return null;
  };

  return {
    status: latest.status,
    agentName: lastWith("agentName"),
    topicName: lastWith("topicName"),
    statusAt: latest.at,
  };
}

/**
 * Whether the 24h reply window has closed.
 *
 * Derived from the last inbound message rather than trusting a stored status: expiry is purely a
 * function of time, so WATI's "expired" ticket event only exists once we poll again. Computing it
 * keeps the inbox chip correct between syncs.
 */
export function isWatiSessionExpired(
  lastInboundAt: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!lastInboundAt) return false;
  const ms = Date.parse(lastInboundAt);
  if (Number.isNaN(ms)) return false;
  return now - ms > WATI_SESSION_WINDOW_MS;
}

/**
 * The status to show on a thread: a closed session window outranks a stale stored status, but an
 * explicit operator resolution still wins so "Solved" doesn't silently become "Expired".
 */
export function resolveWatiChatStatus(input: {
  watiChatStatus?: string | null;
  lastInboundAt?: string | null;
  now?: number;
}): WatiChatStatus | null {
  const stored = WATI_CHAT_STATUSES.includes(input.watiChatStatus as WatiChatStatus)
    ? (input.watiChatStatus as WatiChatStatus)
    : null;

  if (stored === "solved") return "solved";
  if (isWatiSessionExpired(input.lastInboundAt, input.now ?? Date.now())) return "expired";
  return stored;
}
