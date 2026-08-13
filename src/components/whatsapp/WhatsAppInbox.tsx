import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { RelativeTime } from "@/components/ui/relative-time";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Search,
  Send,
  MessageCircle,
  Phone,
  Clock,
  MessageSquareReply,
  Tag as TagIcon,
  X,
  Paperclip,
  FileText,
  Headphones,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  getWhatsappInboxMeta,
  listWhatsappThreads,
  markWhatsappThreadRead,
  refreshWatiInboxFromWati,
  sendWhatsappMessage,
  syncWhatsappThread,
  updateWhatsappConversation,
} from "@/lib/dashboard/whatsapp.functions";
import { getWatiConnection } from "@/lib/whatsapp/wati.functions";
import { sortWhatsappInboxThreads } from "@/lib/whatsapp/wa-inbox-threads.shared";
import { resolveWatiChatStatus } from "@/lib/whatsapp/wati-chat-status.shared";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type InboxMessage = {
  id: string;
  body?: string | null;
  direction: string;
  sent_at: string;
  status?: string;
  sender_channel?: string | null;
  media_url?: string | null;
  media_mime_type?: string | null;
  media_filename?: string | null;
};

type InboxThread = {
  phone: string;
  name?: string | null;
  lastMessage?: string | null;
  lastAt: string;
  unread: number;
  needsReply?: boolean;
  lastDirection?: string;
  messages?: InboxMessage[];
  status?: string;
  assigneeId?: string | null;
  assignedTeamId?: string | null;
  tags?: string[];
  watiChatStatus?: string | null;
  watiTopic?: string | null;
  watiAgentName?: string | null;
  lastInboundAt?: string | null;
  lastMessageOrigin?: string | null;
};

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  pending: "Pending",
  solved: "Solved",
};

/** Mirrors the chips WATI shows on each chat in its own inbox. */
const WATI_STATUS_CHIPS: Record<string, { label: string; className: string }> = {
  expired: {
    label: "Expired",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
  },
  solved: {
    label: "Solved",
    className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
  },
  pending: {
    label: "Pending",
    className: "bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300",
  },
  open: {
    label: "Open",
    className: "bg-muted text-muted-foreground",
  },
};

/** Where the newest outbound message came from — WATI's teal "Campaign" chip and friends. */
const MESSAGE_ORIGIN_CHIPS: Record<string, { label: string; className: string }> = {
  campaign: {
    label: "Campaign",
    className: "bg-teal-100 text-teal-800 dark:bg-teal-500/20 dark:text-teal-300",
  },
  template: {
    label: "Template",
    className: "bg-indigo-100 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-300",
  },
  bot: {
    label: "Bot",
    className: "bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-300",
  },
};

const ASSIGNEE_ALL = "__all__";
const ASSIGNEE_UNASSIGNED = "__unassigned__";
const TAG_ALL = "__all__";
const STATUS_ALL = "__all__";
const CHAT_STATUS_ALL = "__all__";
const TEAM_NONE = "__none__";

export function WhatsAppInbox() {
  const qc = useQueryClient();
  const listFn = useServerFn(listWhatsappThreads);
  const refreshInboxFn = useServerFn(refreshWatiInboxFromWati);
  const sendFn = useServerFn(sendWhatsappMessage);
  const syncThreadFn = useServerFn(syncWhatsappThread);
  const metaFn = useServerFn(getWhatsappInboxMeta);
  const markReadFn = useServerFn(markWhatsappThreadRead);
  const updateConversationFn = useServerFn(updateWhatsappConversation);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>(STATUS_ALL);
  const [assigneeFilter, setAssigneeFilter] = useState<string>(ASSIGNEE_ALL);
  const [tagFilter, setTagFilter] = useState<string>(TAG_ALL);
  const [chatStatusFilter, setChatStatusFilter] = useState<string>(CHAT_STATUS_ALL);
  const [activePhone, setActivePhone] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [newTag, setNewTag] = useState("");
  const [mediaToken, setMediaToken] = useState<string | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);

  // Debounced so each keystroke doesn't hit the database.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const watiFn = useServerFn(getWatiConnection);
  const { data: watiConn } = useQuery({
    queryKey: ["wati-connection"],
    queryFn: () => watiFn(),
    throwOnError: false,
  });
  const watiConnected = watiConn?.status === "connected";

  const { data: meta } = useQuery({
    queryKey: ["wa-inbox-meta"],
    queryFn: () => metaFn(),
    staleTime: 60_000,
    throwOnError: false,
  });

  const filters = useMemo(
    () => ({
      search: search || undefined,
      status:
        statusFilter === STATUS_ALL ? undefined : (statusFilter as "open" | "pending" | "solved"),
      unassigned: assigneeFilter === ASSIGNEE_UNASSIGNED ? true : undefined,
      assigneeId:
        assigneeFilter === ASSIGNEE_ALL || assigneeFilter === ASSIGNEE_UNASSIGNED
          ? undefined
          : assigneeFilter,
      tag: tagFilter === TAG_ALL ? undefined : tagFilter,
      chatStatus:
        chatStatusFilter === CHAT_STATUS_ALL
          ? undefined
          : (chatStatusFilter as "open" | "pending" | "solved" | "expired"),
    }),
    [search, statusFilter, assigneeFilter, tagFilter, chatStatusFilter],
  );

  const { data: threads = [], isLoading } = useQuery({
    queryKey: ["wa-threads", filters],
    queryFn: () => listFn({ data: filters }),
    // Realtime drives updates; this is just a safety net if the socket drops.
    refetchInterval: 60_000,
    throwOnError: false,
  });

  const invalidateThreads = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["wa-threads"] });
  }, [qc]);

  // Push new messages straight into the inbox instead of waiting for the next poll. RLS scopes
  // the stream to workspaces this user belongs to.
  useEffect(() => {
    const channel = supabase
      .channel("buzzchat-inbox")
      .on("postgres_changes", { event: "*", schema: "public", table: "whatsapp_messages" }, () =>
        invalidateThreads(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "whatsapp_conversations" },
        () => invalidateThreads(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [invalidateThreads]);

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

  // Media is proxied through our server, and <img> can't send an Authorization header.
  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) setMediaToken(data.session?.access_token ?? null);
    });
    return () => {
      active = false;
    };
  }, []);

  const sorted = sortWhatsappInboxThreads(threads as InboxThread[]);
  const replyWaitingCount = sorted.filter((t) => t.needsReply).length;
  const active = sorted.find((t) => t.phone === activePhone) ?? sorted[0] ?? null;

  const msgs = active
    ? [...(active.messages ?? [])].sort(
        (a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime(),
      )
    : [];

  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [active?.phone, msgs.length]);

  // Opening a thread clears its unread badge for the whole team.
  const openPhone = active?.phone;
  const openUnread = active?.unread ?? 0;
  useEffect(() => {
    if (!openPhone || openUnread === 0) return;
    markReadFn({ data: { phone: openPhone } })
      .then(() => invalidateThreads())
      .catch(() => {
        /* badge will clear on the next read attempt */
      });
  }, [openPhone, openUnread, markReadFn, invalidateThreads]);

  // WATI webhooks hit production only — poll getMessages for the open thread (local + prod).
  useEffect(() => {
    if (!active?.phone) return;

    let cancelled = false;
    const pullFromWati = async () => {
      try {
        await syncThreadFn({ data: { phone: active.phone } });
        if (!cancelled) invalidateThreads();
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
  }, [active?.phone, syncThreadFn, invalidateThreads]);

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
      invalidateThreads();
      toast.success("Message sent");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateConversation = useMutation({
    mutationFn: (patch: {
      status?: "open" | "pending" | "solved";
      assigneeId?: string | null;
      assignedTeamId?: string | null;
      tags?: string[];
    }) => updateConversationFn({ data: { phone: active!.phone, ...patch } }),
    onSuccess: () => {
      invalidateThreads();
      qc.invalidateQueries({ queryKey: ["wa-inbox-meta"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const mediaSrc = (message: InboxMessage): string | null => {
    if (!message.media_url || !mediaToken) return null;
    return `/api/whatsapp/media?messageId=${encodeURIComponent(message.id)}&token=${encodeURIComponent(mediaToken)}`;
  };

  const assigneeName = (userId: string | null | undefined): string => {
    if (!userId) return "Unassigned";
    return meta?.members.find((m) => m.userId === userId)?.name ?? "Assigned";
  };

  const hasFilters =
    Boolean(search) ||
    statusFilter !== STATUS_ALL ||
    assigneeFilter !== ASSIGNEE_ALL ||
    tagFilter !== TAG_ALL ||
    chatStatusFilter !== CHAT_STATUS_ALL;

  if (isLoading) {
    return (
      <div className="flex h-[min(640px,calc(100vh-14rem))] items-center justify-center text-muted-foreground text-sm">
        Loading conversations…
      </div>
    );
  }

  if (sorted.length === 0 && !hasFilters) {
    return (
      <div className="flex h-[min(640px,calc(100vh-14rem))] flex-col items-center justify-center gap-3 text-muted-foreground">
        <MessageCircle className="h-10 w-10 opacity-30" />
        <p className="text-sm font-medium">No conversations yet</p>
        <p className="text-xs">Inbound WhatsApp messages will appear here automatically.</p>
      </div>
    );
  }

  return (
    <div className="grid h-[min(640px,calc(100vh-14rem))] min-h-[480px] grid-cols-[minmax(280px,320px)_1fr] overflow-hidden rounded-lg border border-border">
      {/* Sidebar */}
      <div className="flex min-h-0 flex-col overflow-hidden border-r border-border bg-muted/20">
        <div className="shrink-0 space-y-2 border-b border-border p-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search name, number, or message…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="h-8 pl-8 text-xs"
            />
          </div>

          <div className="flex gap-1.5">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-7 flex-1 text-[10px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={STATUS_ALL}>All status</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="solved">Solved</SelectItem>
              </SelectContent>
            </Select>

            <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
              <SelectTrigger className="h-7 flex-1 text-[10px]">
                <SelectValue placeholder="Assignee" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ASSIGNEE_ALL}>Anyone</SelectItem>
                <SelectItem value={ASSIGNEE_UNASSIGNED}>Unassigned</SelectItem>
                {(meta?.members ?? []).map((m) => (
                  <SelectItem key={m.userId} value={m.userId}>
                    {m.name ?? m.userId.slice(0, 8)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Select value={chatStatusFilter} onValueChange={setChatStatusFilter}>
            <SelectTrigger className="h-7 w-full text-[10px]">
              <SelectValue placeholder="WhatsApp session" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={CHAT_STATUS_ALL}>Any WhatsApp session</SelectItem>
              <SelectItem value="expired">Expired (24h window closed)</SelectItem>
              <SelectItem value="open">Open in WATI</SelectItem>
              <SelectItem value="pending">Pending in WATI</SelectItem>
              <SelectItem value="solved">Solved in WATI</SelectItem>
            </SelectContent>
          </Select>

          {(meta?.tags?.length ?? 0) > 0 && (
            <Select value={tagFilter} onValueChange={setTagFilter}>
              <SelectTrigger className="h-7 w-full text-[10px]">
                <SelectValue placeholder="Tag" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TAG_ALL}>All tags</SelectItem>
                {(meta?.tags ?? []).map((tag) => (
                  <SelectItem key={tag} value={tag}>
                    {tag}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {watiConnected && replyWaitingCount > 0 && (
            <p className="flex items-center gap-1.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
              <MessageSquareReply className="h-3 w-3 shrink-0" />
              {replyWaitingCount} waiting for your reply — shown at top
            </p>
          )}
        </div>

        <ul className="min-h-0 flex-1 divide-y divide-border/60 overflow-y-auto">
          {sorted.length === 0 && (
            <li className="p-4 text-center text-xs text-muted-foreground">
              No conversations match these filters.
            </li>
          )}
          {sorted.map((t) => {
            const waiting = Boolean(t.needsReply);
            const watiStatus = resolveWatiChatStatus({
              watiChatStatus: t.watiChatStatus,
              lastInboundAt: t.lastInboundAt,
            });
            const statusChip = watiStatus ? WATI_STATUS_CHIPS[watiStatus] : null;
            const originChip = t.lastMessageOrigin
              ? MESSAGE_ORIGIN_CHIPS[t.lastMessageOrigin]
              : null;
            return (
              <li key={t.phone}>
                <button
                  type="button"
                  onClick={() => setActivePhone(t.phone)}
                  className={cn(
                    "w-full px-3 py-3 text-left transition-colors hover:bg-accent/50",
                    active?.phone === t.phone && "border-r-2 border-primary bg-primary/8",
                    waiting &&
                      active?.phone !== t.phone &&
                      "border-l-2 border-emerald-500 bg-emerald-500/10",
                    waiting &&
                      active?.phone === t.phone &&
                      "border-l-2 border-emerald-500 bg-emerald-500/15",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        {waiting && (
                          <span
                            className="h-2 w-2 shrink-0 rounded-full bg-emerald-500"
                            aria-hidden
                          />
                        )}
                        <p
                          className={cn(
                            "truncate text-xs font-semibold",
                            waiting && "text-emerald-900 dark:text-emerald-100",
                          )}
                        >
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
                      {(statusChip || originChip || (t.tags?.length ?? 0) > 0) && (
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          {statusChip && (
                            <span
                              className={cn(
                                "rounded px-1 py-0.5 text-[9px] font-medium",
                                statusChip.className,
                              )}
                            >
                              {statusChip.label}
                            </span>
                          )}
                          {originChip && (
                            <span
                              className={cn(
                                "rounded px-1 py-0.5 text-[9px] font-medium",
                                originChip.className,
                              )}
                            >
                              {originChip.label}
                            </span>
                          )}
                          {(t.tags ?? []).slice(0, 3).map((tag) => (
                            <span
                              key={tag}
                              className="rounded bg-muted px-1 py-0.5 text-[9px] text-muted-foreground"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {t.watiAgentName && (
                        <span className="flex items-center gap-0.5 text-[9px] font-medium text-muted-foreground">
                          <Headphones className="h-2.5 w-2.5" />
                          {t.watiAgentName}
                        </span>
                      )}
                      <span className="flex items-center gap-0.5 text-[9px] text-muted-foreground">
                        <Clock className="h-2 w-2" />
                        <RelativeTime date={t.lastAt} short />
                      </span>
                      {t.unread > 0 && (
                        <Badge variant="default" className="h-4 min-w-4 px-1 text-[9px]">
                          {t.unread}
                        </Badge>
                      )}
                      {t.status && t.status !== "open" && (
                        <span className="text-[9px] uppercase tracking-wide text-muted-foreground">
                          {STATUS_LABELS[t.status] ?? t.status}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Chat pane */}
      {active ? (
        <div className="flex min-h-0 flex-col overflow-hidden">
          <div className="shrink-0 border-b border-border bg-background px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/15">
                <span className="text-xs font-bold text-primary">
                  {(active.name ?? active.phone).charAt(0).toUpperCase()}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{active.name ?? active.phone}</p>
                <p className="truncate text-[10px] text-muted-foreground">{active.phone}</p>
              </div>

              <Select
                value={active.status ?? "open"}
                onValueChange={(value) =>
                  updateConversation.mutate({ status: value as "open" | "pending" | "solved" })
                }
              >
                <SelectTrigger className="h-7 w-[110px] text-[10px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="solved">Solved</SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={active.assigneeId ?? ASSIGNEE_UNASSIGNED}
                onValueChange={(value) =>
                  updateConversation.mutate({
                    assigneeId: value === ASSIGNEE_UNASSIGNED ? null : value,
                  })
                }
              >
                <SelectTrigger className="h-7 w-[140px] text-[10px]">
                  <SelectValue placeholder={assigneeName(active.assigneeId)} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ASSIGNEE_UNASSIGNED}>Unassigned</SelectItem>
                  {(meta?.members ?? []).map((m) => (
                    <SelectItem key={m.userId} value={m.userId}>
                      {m.name ?? m.userId.slice(0, 8)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {(meta?.teams?.length ?? 0) > 0 && (
                <Select
                  value={active.assignedTeamId ?? TEAM_NONE}
                  onValueChange={(value) =>
                    updateConversation.mutate({
                      assignedTeamId: value === TEAM_NONE ? null : value,
                    })
                  }
                >
                  <SelectTrigger className="h-7 w-[130px] text-[10px]">
                    <SelectValue placeholder="No team" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={TEAM_NONE}>No team</SelectItem>
                    {(meta?.teams ?? []).map((team) => (
                      <SelectItem key={team.id} value={team.id}>
                        {team.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <TagIcon className="h-3 w-3 text-muted-foreground" />
              {(active.tags ?? []).map((tag) => (
                <span
                  key={tag}
                  className="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px]"
                >
                  {tag}
                  <button
                    type="button"
                    aria-label={`Remove tag ${tag}`}
                    onClick={() =>
                      updateConversation.mutate({
                        tags: (active.tags ?? []).filter((t) => t !== tag),
                      })
                    }
                  >
                    <X className="h-2.5 w-2.5 text-muted-foreground hover:text-foreground" />
                  </button>
                </span>
              ))}
              <Input
                placeholder="Add tag…"
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  const tag = newTag.trim();
                  if (!tag) return;
                  updateConversation.mutate({
                    tags: [...new Set([...(active.tags ?? []), tag])],
                  });
                  setNewTag("");
                }}
                className="h-6 w-24 text-[10px]"
              />
            </div>
          </div>

          <div
            ref={messagesRef}
            className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-muted/10 px-4 py-4"
          >
            <div className="flex flex-col gap-2">
              {msgs.map((m) => {
                const src = mediaSrc(m);
                const isImage = (m.media_mime_type ?? "").startsWith("image/");
                return (
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

                    {src && isImage && (
                      <a href={src} target="_blank" rel="noreferrer">
                        <img
                          src={src}
                          alt={m.media_filename ?? "Attachment"}
                          className="mb-1 max-h-64 rounded-lg object-cover"
                          loading="lazy"
                        />
                      </a>
                    )}
                    {src && !isImage && (
                      <a
                        href={src}
                        target="_blank"
                        rel="noreferrer"
                        className="mb-1 flex items-center gap-1.5 underline underline-offset-2"
                      >
                        <FileText className="h-3 w-3 shrink-0" />
                        {m.media_filename ?? "Download attachment"}
                      </a>
                    )}
                    {!src && m.media_url && (
                      <p className="mb-1 flex items-center gap-1.5 opacity-70">
                        <Paperclip className="h-3 w-3 shrink-0" />
                        Attachment
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
                );
              })}
            </div>
          </div>

          <div className="shrink-0 space-y-2 border-t border-border bg-background px-4 py-3">
            {watiConnected && (
              <p className="text-[10px] text-muted-foreground">
                WATI: free-text replies work within 24 hours of their last message. For cold
                outreach, use Campaigns with an approved template.
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
