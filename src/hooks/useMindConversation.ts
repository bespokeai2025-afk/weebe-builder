import { useCallback, useRef } from "react";
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
 * (clientMsgId dedup). The server is authoritative — component state is only
 * an in-session cache.
 *
 * Query keys include the workspace id so switching workspaces can never serve
 * another tenant's conversation from the React Query cache.
 */
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

  const { data, isSuccess } = useQuery({
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
        return true;
      } catch (err: any) {
        console.warn(`[${mind}] failed to persist conversation messages:`, err?.message);
        return false;
      }
    },
    [appendFn, mind],
  );

  return {
    workspaceId,
    conversationId: data?.conversation?.id ?? null,
    initialMessages: (data?.messages ?? []) as MindConversationMessage[],
    historyLoaded: isSuccess,
    persist,
  };
}
