import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyContext } from "@/lib/workspace/workspace.functions";
import {
  getOrCreateActiveMindConversation,
  appendMindMessages,
  type MindName,
  type MindConversationMessage,
} from "@/lib/minds/conversations.functions";

/**
 * Server-side Mind conversation persistence for chat UIs.
 *
 * Loads the user's active conversation (per workspace + user + Mind) on mount
 * and exposes a fire-and-forget `persist` that appends messages idempotently
 * (clientMsgId dedup). The server is authoritative — localStorage is kept
 * only as a NON-authoritative offline cache:
 *   - after every successful server load / persist, the last messages are
 *     mirrored to a per-(mind, workspace) localStorage key;
 *   - if the server load fails (offline), the cached messages are surfaced
 *     so the user still sees their history;
 *   - if the server conversation is empty but a local cache exists (history
 *     written before server persistence existed, or while offline), the
 *     cached messages seed the first server conversation exactly once.
 *
 * Query keys include the workspace id so switching workspaces can never serve
 * another tenant's conversation from the React Query cache; the localStorage
 * key is scoped by workspace AND user id for the same reason (shared-browser
 * account switches must never surface or seed another user's history).
 */

const CACHE_LIMIT = 100;

// Cache keys MUST be scoped by user as well as workspace + mind: on a shared
// browser, a workspace-only key would let one user see (and seed the server
// with) another user's cached conversation.
function cacheKeyFor(mind: MindName, workspaceId: string, userId: string) {
  return `mind-conv-cache:${mind}:${workspaceId}:${userId}`;
}

function readCache(key: string): MindConversationMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (m: any) =>
        m &&
        typeof m.content === "string" &&
        (m.role === "user" || m.role === "assistant"),
    );
  } catch {
    return [];
  }
}

function writeCache(key: string, messages: MindConversationMessage[]) {
  if (typeof window === "undefined") return;
  try {
    const slim = messages.slice(-CACHE_LIMIT).map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      clientMsgId: m.clientMsgId ?? null,
      createdAt: m.createdAt,
    }));
    window.localStorage.setItem(key, JSON.stringify(slim));
  } catch {
    // Quota/serialization issues never break chat — cache is best-effort.
  }
}

export function useMindConversation(mind: MindName) {
  const convFn = useServerFn(getOrCreateActiveMindConversation);
  const appendFn = useServerFn(appendMindMessages);
  const ctxFn = useServerFn(getMyContext);

  const { data: ctx } = useQuery({
    queryKey: ["my-context"],
    queryFn: () => ctxFn(),
    staleTime: 60_000,
    throwOnError: false,
  });
  const workspaceId = ctx?.workspaceId ?? null;
  const userId = ctx?.userId ?? null;
  const cacheKey =
    workspaceId && userId ? cacheKeyFor(mind, workspaceId, userId) : null;

  const { data, isSuccess, isError } = useQuery({
    queryKey: ["mind-conversation", mind, workspaceId],
    queryFn: () => convFn({ data: { mind } }),
    enabled: !!workspaceId,
    staleTime: 30_000,
    retry: 1,
    throwOnError: false,
  });

  const conversationIdRef = useRef<string | null>(null);
  if (data?.conversation?.id) conversationIdRef.current = data.conversation.id;

  /**
   * Append messages in chunks of 10 (the server-fn batch cap). Resolves true
   * only if every chunk was accepted, so callers can un-mark IDs on failure
   * and retry later. Never throws — chat UX must not break on persist errors.
   * Successfully sent messages are mirrored into the offline cache.
   */
  const persist = useCallback(
    async (
      messages: {
        role: "user" | "assistant" | "system" | "tool";
        content: string;
        clientMsgId?: string;
        metadata?: unknown;
      }[],
    ): Promise<boolean> => {
      const conversationId = conversationIdRef.current;
      const toSend = messages.filter((m) => m.content.trim().length > 0);
      if (!conversationId || toSend.length === 0) return true;
      try {
        for (let i = 0; i < toSend.length; i += 10) {
          await appendFn({ data: { conversationId, messages: toSend.slice(i, i + 10) } });
        }
        if (cacheKey) {
          const cached = readCache(cacheKey);
          const known = new Set(cached.map((c) => c.clientMsgId ?? c.id));
          const additions = toSend
            .filter((m) => (m.role === "user" || m.role === "assistant") && m.clientMsgId && !known.has(m.clientMsgId))
            .map((m) => ({
              id: m.clientMsgId!,
              role: m.role as "user" | "assistant",
              content: m.content,
              toolRefs: null,
              createdRefs: null,
              metadata: null,
              clientMsgId: m.clientMsgId!,
              createdAt: new Date().toISOString(),
            }));
          if (additions.length > 0) writeCache(cacheKey, [...cached, ...additions]);
        }
        return true;
      } catch (err: any) {
        console.warn(`[${mind}] failed to persist conversation messages:`, err?.message);
        return false;
      }
    },
    [appendFn, mind, cacheKey],
  );

  // Local history that seeded (or is standing in for) the server conversation.
  const [seededMessages, setSeededMessages] = useState<MindConversationMessage[] | null>(null);

  // Reset any seeded state when the user/workspace context (cache key) changes
  // so a stale seed from a previous account can never leak across a switch.
  useEffect(() => {
    setSeededMessages(null);
  }, [cacheKey]);

  // On server load: refresh the offline cache; if the server conversation is
  // empty but a local cache exists, seed the server once from it.
  useEffect(() => {
    if (!data || !cacheKey) return;
    if (data.messages.length > 0) {
      writeCache(cacheKey, data.messages as MindConversationMessage[]);
      return;
    }
    const seededFlagKey = `${cacheKey}:seeded`;
    let alreadySeeded = true;
    try {
      alreadySeeded = window.localStorage.getItem(seededFlagKey) === "1";
    } catch {
      return;
    }
    if (alreadySeeded) return;
    const cached = readCache(cacheKey);
    try {
      window.localStorage.setItem(seededFlagKey, "1");
    } catch {
      /* best effort */
    }
    if (cached.length === 0) return;
    setSeededMessages(cached);
    // clientMsgId (unique per conversation) makes retries of this idempotent.
    void persist(
      cached.map((m) => ({
        role: m.role === "user" ? ("user" as const) : ("assistant" as const),
        content: m.content,
        clientMsgId: m.clientMsgId ?? m.id,
      })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, cacheKey]);

  // Offline fallback: server load failed → surface the cached history.
  const offlineMessages = useMemo(
    () => (isError && cacheKey ? readCache(cacheKey) : null),
    [isError, cacheKey],
  );

  const initialMessages: MindConversationMessage[] = useMemo(() => {
    if (data) {
      if (data.messages.length > 0) return data.messages as MindConversationMessage[];
      return seededMessages ?? [];
    }
    return offlineMessages ?? [];
  }, [data, seededMessages, offlineMessages]);

  return {
    workspaceId,
    conversationId: data?.conversation?.id ?? null,
    initialMessages,
    historyLoaded: isSuccess || isError,
    persist,
  };
}
