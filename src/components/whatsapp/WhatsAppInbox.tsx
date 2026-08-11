import { useState, useRef, useEffect } from "react";
import { RelativeTime } from "@/components/ui/relative-time";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, Send, MessageCircle, Phone, Clock, MessageSquareReply } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  listWhatsappThreads,
  refreshWatiInboxFromWati,
  sendWhatsappMessage,
  syncWhatsappThread,
} from "@/lib/dashboard/whatsapp.functions";
import { getWatiConnection } from "@/lib/whatsapp/wati.functions";
import { sortWhatsappInboxThreads } from "@/lib/whatsapp/wa-inbox-threads.shared";
import { toast } from "sonner";

type InboxThread = {
  phone: string;
  name?: string | null;
  lastMessage?: string | null;
  lastAt: string;
  unread: number;
  needsReply?: boolean;
  lastDirection?: string;
  messages?: Array<Record<string, unknown>>;
};

export function WhatsAppInbox() {
  const qc = useQueryClient();
  const listFn = useServerFn(listWhatsappThreads);
  const refreshInboxFn = useServerFn(refreshWatiInboxFromWati);
  const sendFn = useServerFn(sendWhatsappMessage);
  const syncThreadFn = useServerFn(syncWhatsappThread);

  const watiFn = useServerFn(getWatiConnection);
  const { data: watiConn } = useQuery({
    queryKey: ["wati-connection"],
    queryFn: () => watiFn(),
    throwOnError: false,
  });
  const watiConnected = watiConn?.status === "connected";

  const { data: threads = [], isLoading } = useQuery({
    queryKey: ["wa-threads"],
    queryFn: () => listFn(),
    refetchInterval: 10_000,
    throwOnError: false,
  });

  useQuery({
    queryKey: ["wa-inbox-wati-sync"],
    queryFn: async () => {
      const result = await refreshInboxFn();
      await qc.invalidateQueries({ queryKey: ["wa-threads"] });
      return result;
    },
    enabled: watiConnected,
    refetchInterval: 15_000,
    throwOnError: false,
  });

  const [search, setSearch] = useState("");
  const [activePhone, setActivePhone] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const messagesRef = useRef<HTMLDivElement>(null);

  const filtered = sortWhatsappInboxThreads(
    threads.filter(
      (t: InboxThread) =>
        (t.name ?? t.phone).toLowerCase().includes(search.toLowerCase()) ||
        t.phone.includes(search),
    ),
  );
  const replyWaitingCount = filtered.filter((t: InboxThread) => t.needsReply).length;
  const active =
    filtered.find((t: InboxThread) => t.phone === activePhone) ?? filtered[0] ?? null;

  const msgs = active
    ? [...(active.messages ?? [])].sort(
        (a: { sent_at: string }, b: { sent_at: string }) =>
          new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime(),
      )
    : [];

  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [active?.phone, msgs.length]);

  // WATI webhooks hit production only — poll getMessages for the open thread (local + prod).
  useEffect(() => {
    if (!active?.phone) return;

    let cancelled = false;
    const pullFromWati = async () => {
      try {
        await syncThreadFn({ data: { phone: active.phone } });
        if (!cancelled) qc.invalidateQueries({ queryKey: ["wa-threads"] });
      } catch {
        /* background poll — listWhatsappThreads still refreshes on interval */
      }
    };

    pullFromWati();
    const interval = setInterval(pullFromWati, 10_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [active?.phone, syncThreadFn, qc]);

  const send = useMutation({
    mutationFn: () =>
      sendFn({
        data: {
          to: active!.phone,
          body: reply,
          contactName: active!.name ?? undefined,
        },
      }),
    onSuccess: () => {
      setReply("");
      qc.invalidateQueries({ queryKey: ["wa-threads"] });
      toast.success("Message sent");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) {
    return (
      <div className="flex h-[min(640px,calc(100vh-14rem))] items-center justify-center text-muted-foreground text-sm">
        Loading conversations…
      </div>
    );
  }

  if (threads.length === 0) {
    return (
      <div className="flex h-[min(640px,calc(100vh-14rem))] flex-col items-center justify-center gap-3 text-muted-foreground">
        <MessageCircle className="h-10 w-10 opacity-30" />
        <p className="text-sm font-medium">No conversations yet</p>
        <p className="text-xs">Inbound WhatsApp messages will appear here automatically.</p>
      </div>
    );
  }

  return (
    <div className="grid h-[min(640px,calc(100vh-14rem))] min-h-[480px] grid-cols-[minmax(260px,300px)_1fr] overflow-hidden rounded-lg border border-border">
      {/* Sidebar */}
      <div className="flex min-h-0 flex-col overflow-hidden border-r border-border bg-muted/20">
        <div className="shrink-0 border-b border-border p-3 space-y-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search conversations…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 pl-8 text-xs"
            />
          </div>
          {watiConnected && replyWaitingCount > 0 && (
            <p className="flex items-center gap-1.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
              <MessageSquareReply className="h-3 w-3 shrink-0" />
              {replyWaitingCount} waiting for your reply — shown at top
            </p>
          )}
          {watiConnected && (
            <p className="text-[10px] text-muted-foreground">
              Replies sync from WATI in the background every ~15s while this tab is open.
            </p>
          )}
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto divide-y divide-border/60">
          {filtered.map((t: InboxThread) => {
            const waiting = Boolean(t.needsReply);
            return (
            <li key={t.phone}>
              <button
                type="button"
                onClick={() => setActivePhone(t.phone)}
                className={cn(
                  "w-full px-3 py-3 text-left transition-colors hover:bg-accent/50",
                  active?.phone === t.phone && "border-r-2 border-primary bg-primary/8",
                  waiting && active?.phone !== t.phone && "border-l-2 border-emerald-500 bg-emerald-500/10",
                  waiting && active?.phone === t.phone && "border-l-2 border-emerald-500 bg-emerald-500/15",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      {waiting && (
                        <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden />
                      )}
                      <p className={cn("truncate text-xs font-semibold", waiting && "text-emerald-900 dark:text-emerald-100")}>
                        {t.name ?? t.phone}
                      </p>
                    </div>
                    {t.name && (
                      <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Phone className="h-2.5 w-2.5" />
                        {t.phone}
                      </p>
                    )}
                    <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap break-words text-[10px] text-muted-foreground">
                      {t.lastMessage ?? "—"}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="flex items-center gap-0.5 text-[9px] text-muted-foreground">
                      <Clock className="h-2 w-2" />
                      <RelativeTime date={t.lastAt} short />
                    </span>
                    {waiting && (
                      <Badge className="h-4 border-0 bg-emerald-600 px-1.5 text-[9px] hover:bg-emerald-600">
                        Replied
                      </Badge>
                    )}
                    {!waiting && t.unread > 0 && (
                      <Badge variant="default" className="h-4 min-w-4 px-1 text-[9px]">
                        {t.unread}
                      </Badge>
                    )}
                  </div>
                </div>
              </button>
            </li>
          );})}
        </ul>
      </div>

      {/* Chat pane */}
      {active ? (
        <div className="flex min-h-0 flex-col overflow-hidden">
          <div className="flex shrink-0 items-center gap-3 border-b border-border bg-background px-4 py-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/15">
              <span className="text-xs font-bold text-primary">
                {(active.name ?? active.phone).charAt(0).toUpperCase()}
              </span>
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{active.name ?? active.phone}</p>
              <p className="truncate text-[10px] text-muted-foreground">{active.phone}</p>
            </div>
          </div>

          <div
            ref={messagesRef}
            className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-muted/10 px-4 py-4"
          >
            <div className="flex flex-col gap-2">
              {msgs.map((m: { id: string; body?: string; direction: string; sent_at: string; status?: string; sender_channel?: string | null }) => (
                <div
                  key={m.id}
                  className={cn(
                    "max-w-[85%] shrink-0 rounded-2xl px-3 py-2 text-xs shadow-sm",
                    m.direction === "outbound"
                      ? "ml-auto bg-primary text-primary-foreground"
                      : "border border-border bg-background text-foreground",
                  )}
                >
                  {m.direction === "outbound" && m.sender_channel && (
                    <p
                      className={cn(
                        "mb-1 text-[9px] font-medium uppercase tracking-wide",
                        m.direction === "outbound"
                          ? "text-primary-foreground/75"
                          : "text-muted-foreground",
                      )}
                    >
                      {m.sender_channel === "bot"
                        ? "Bot"
                        : m.sender_channel === "campaign" || m.sender_channel === "template"
                          ? "Campaign"
                          : "WATI"}
                    </p>
                  )}
                  <p className="whitespace-pre-wrap break-words">{m.body ?? "(media)"}</p>
                  <p
                    className={cn(
                      "mt-1 text-[9px]",
                      m.direction === "outbound"
                        ? "text-primary-foreground/70"
                        : "text-muted-foreground",
                    )}
                  >
                    {new Date(m.sent_at).toLocaleString()} · {m.status ?? ""}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="shrink-0 space-y-2 border-t border-border bg-background px-4 py-3">
            {watiConnected && (
              <p className="text-[10px] text-muted-foreground">
                WATI: free-text replies work within 24 hours of their last message. For cold
                outreach, use Campaigns with an approved template. Conversation history syncs
                from WATI every 10 seconds while this chat is open.
              </p>
            )}
            <div className="flex items-end gap-2">
              <Textarea
                placeholder="Type a message…"
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                className="max-h-32 min-h-[60px] flex-1 resize-none text-sm"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (reply.trim()) send.mutate();
                  }
                }}
              />
              <Button
                size="icon"
                disabled={!reply.trim() || send.isPending}
                onClick={() => send.mutate()}
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-center text-sm text-muted-foreground">
          Select a conversation
        </div>
      )}
    </div>
  );
}
