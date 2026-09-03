import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { RelativeTime } from "@/components/ui/relative-time";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import {
  Search,
  Send,
  MessageCircle,
  Phone,
  Tag as TagIcon,
  X,
  Paperclip,
  FileText,
  Copy,
  ChevronLeft,
  ExternalLink,
  SlidersHorizontal,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
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
import { updateListingOutcome } from "@/lib/whatsapp/campaign-leads.functions";
import {
  DEFAULT_INBOX_QUEUE_FILTER,
  INBOX_PRIMARY_QUEUE_FILTERS,
  INBOX_QUEUE_FILTERS,
  LISTING_OUTCOME_LABELS,
  LISTING_OUTCOMES,
  isWhatsappFreeTextAllowed,
  threadMatchesInboxQueue,
  whatsappPersonalLink,
  type InboxQueueFilter,
  type ListingOutcome,
} from "@/lib/whatsapp/campaign-leads.shared";
import type { InboxCampaignScope } from "@/lib/whatsapp/inbox-campaign-org.shared";
import { getWatiConnection } from "@/lib/whatsapp/wati.functions";
import {
  type InboxSortMode,
  sortWhatsappInboxThreads,
} from "@/lib/whatsapp/wa-inbox-threads.shared";
import { resolveWatiChatStatus } from "@/lib/whatsapp/wati-chat-status.shared";
import { supabase } from "@/integrations/supabase/client";
import { OpenLeadLink } from "@/components/whatsapp/OpenLeadLink";
import { InboxTemplateComposer } from "@/components/whatsapp/InboxTemplateComposer";
import {
  BUZZ_SEARCH,
  BUZZ_SELECT,
  BuzzchatEmptyState,
  BuzzchatFilterChip,
  BuzzchatThreadSkeleton,
} from "@/components/whatsapp/buzzchat-ui";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
  leadId?: string | null;
  status?: string;
  assigneeId?: string | null;
  assignedTeamId?: string | null;
  tags?: string[];
  watiChatStatus?: string | null;
  watiTopic?: string | null;
  watiAgentName?: string | null;
  lastInboundAt?: string | null;
  lastMessageOrigin?: string | null;
  lastCampaignId?: string | null;
  lastCampaignName?: string | null;
  campaignArchived?: boolean;
  area?: string | null;
  listingOutcome?: string | null;
};

const ASSIGNEE_ALL = "__all__";
const ASSIGNEE_UNASSIGNED = "__unassigned__";
const TAG_ALL = "__all__";
const TEAM_NONE = "__none__";
const CAMPAIGN_ALL = "__all__";
const CAMPAIGN_OLDER = "__older__";
const AREA_ALL = "__all__";
const THREAD_PAGE_SIZE = 60;

export function WhatsAppInbox() {
  const qc = useQueryClient();
  const listFn = useServerFn(listWhatsappThreads);
  const refreshInboxFn = useServerFn(refreshWatiInboxFromWati);
  const sendFn = useServerFn(sendWhatsappMessage);
  const syncThreadFn = useServerFn(syncWhatsappThread);
  const metaFn = useServerFn(getWhatsappInboxMeta);
  const markReadFn = useServerFn(markWhatsappThreadRead);
  const updateConversationFn = useServerFn(updateWhatsappConversation);
  const listingOutcomeFn = useServerFn(updateListingOutcome);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState<string>(ASSIGNEE_ALL);
  const [tagFilter, setTagFilter] = useState<string>(TAG_ALL);
  const [queueFilter, setQueueFilter] = useState<InboxQueueFilter>(DEFAULT_INBOX_QUEUE_FILTER);
  const [sortMode, setSortMode] = useState<InboxSortMode>("replies-first");
  const [inboxScope, setInboxScope] = useState<InboxCampaignScope>("all");
  const [campaignFilter, setCampaignFilter] = useState<string>(CAMPAIGN_ALL);
  const [areaFilter, setAreaFilter] = useState<string>(AREA_ALL);
  const [visibleCount, setVisibleCount] = useState(THREAD_PAGE_SIZE);
  const [activePhone, setActivePhone] = useState<string | null>(null);
  const [mobileShowChat, setMobileShowChat] = useState(false);
  const [reply, setReply] = useState("");
  const [newTag, setNewTag] = useState("");
  const [mediaToken, setMediaToken] = useState<string | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);

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
      status: queueFilter === "closed" ? ("solved" as const) : undefined,
      unassigned: assigneeFilter === ASSIGNEE_UNASSIGNED ? true : undefined,
      assigneeId:
        assigneeFilter === ASSIGNEE_ALL || assigneeFilter === ASSIGNEE_UNASSIGNED
          ? undefined
          : assigneeFilter,
      tag: tagFilter === TAG_ALL ? undefined : tagFilter,
      chatStatus: queueFilter === "expired" ? ("expired" as const) : undefined,
      campaignId: campaignFilter === CAMPAIGN_ALL ? undefined : campaignFilter,
      area: areaFilter === AREA_ALL ? undefined : areaFilter,
      inboxScope: inboxScope === "all" ? undefined : inboxScope,
      limit: visibleCount,
    }),
    [search, assigneeFilter, tagFilter, queueFilter, campaignFilter, areaFilter, inboxScope, visibleCount],
  );

  useEffect(() => {
    setVisibleCount(THREAD_PAGE_SIZE);
  }, [search, assigneeFilter, tagFilter, queueFilter, campaignFilter, areaFilter, inboxScope]);

  const {
    data: threads = [],
    isLoading,
    isFetching,
  } = useQuery({
    queryKey: ["wa-threads", filters],
    queryFn: () => listFn({ data: filters }),
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
    throwOnError: false,
  });

  const invalidateThreads = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["wa-threads"] });
  }, [qc]);

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

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) setMediaToken(data.session?.access_token ?? null);
    });
    return () => {
      active = false;
    };
  }, []);

  const sorted = sortWhatsappInboxThreads(threads as InboxThread[], sortMode);
  const queued = sorted.filter((t) => {
    const watiStatus = resolveWatiChatStatus({
      watiChatStatus: t.watiChatStatus,
      lastInboundAt: t.lastInboundAt,
    });
    const expired = watiStatus === "expired" || !isWhatsappFreeTextAllowed(t.lastInboundAt);
    return threadMatchesInboxQueue(
      {
        lastDirection: t.lastDirection,
        lastInboundAt: t.lastInboundAt,
        listingOutcome: t.listingOutcome,
        needsReply: t.needsReply,
        status: t.status,
        expired,
      },
      queueFilter,
    );
  });
  const replyWaitingCount = queued.filter((t) => t.needsReply).length;
  const active = queued.find((t) => t.phone === activePhone) ?? queued[0] ?? null;

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

  useEffect(() => {
    if (!active?.phone) return;
    if (!isWhatsappFreeTextAllowed(active.lastInboundAt)) return;

    let cancelled = false;
    const pullFromWati = async () => {
      try {
        const result = await syncThreadFn({ data: { phone: active.phone } });
        if (!cancelled && result && "synced" in result && result.synced > 0) {
          invalidateThreads();
        }
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
  }, [active?.phone, active?.lastInboundAt, syncThreadFn, invalidateThreads]);

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

  const updateListingRemark = useMutation({
    mutationFn: (outcome: ListingOutcome) =>
      listingOutcomeFn({ data: { leadId: active!.leadId!, outcome } }),
    onSuccess: () => {
      invalidateThreads();
      qc.invalidateQueries({ queryKey: ["campaign-leads"] });
      qc.invalidateQueries({ queryKey: ["pipeline-leads"] });
      toast.success("Remark saved — chat moved to Listing leads");
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

  const extraFilters =
    Boolean(search) ||
    assigneeFilter !== ASSIGNEE_ALL ||
    tagFilter !== TAG_ALL ||
    campaignFilter !== CAMPAIGN_ALL ||
    areaFilter !== AREA_ALL ||
    inboxScope !== "all";
  const hasFilters = extraFilters || queueFilter !== DEFAULT_INBOX_QUEUE_FILTER;
  const blankInbox =
    !isLoading && queued.length === 0 && queueFilter === DEFAULT_INBOX_QUEUE_FILTER && !extraFilters;

  const campaigns = meta?.campaigns ?? [];
  const activeCampaigns = campaigns.filter((c) => !c.archived);
  const olderCampaigns = campaigns.filter((c) => c.archived);
  const areas = meta?.areas ?? [];
  const totalThreads = meta?.conversationCount ?? sorted.length;
  const canLoadMore = hasFilters
    ? sorted.length >= visibleCount
    : sorted.length < totalThreads && sorted.length >= visibleCount;

  const campaignSelectValue =
    campaignFilter !== CAMPAIGN_ALL
      ? campaignFilter
      : inboxScope === "archive"
        ? CAMPAIGN_OLDER
        : CAMPAIGN_ALL;

  const onCampaignChange = (value: string) => {
    if (value === CAMPAIGN_ALL) {
      setInboxScope("all");
      setCampaignFilter(CAMPAIGN_ALL);
      return;
    }
    if (value === CAMPAIGN_OLDER) {
      setInboxScope("archive");
      setCampaignFilter(CAMPAIGN_ALL);
      return;
    }
    setCampaignFilter(value);
    const picked = campaigns.find((c) => c.id === value);
    setInboxScope(picked?.archived ? "archive" : "active");
  };

  const clearFilters = () => {
    setSearchInput("");
    setSearch("");
    setAssigneeFilter(ASSIGNEE_ALL);
    setTagFilter(TAG_ALL);
    setQueueFilter(DEFAULT_INBOX_QUEUE_FILTER);
    setCampaignFilter(CAMPAIGN_ALL);
    setAreaFilter(AREA_ALL);
    setInboxScope("all");
    setSortMode("replies-first");
  };

  const moreFilterCount = [
    assigneeFilter !== ASSIGNEE_ALL,
    tagFilter !== TAG_ALL,
    sortMode !== "replies-first",
    queueFilter !== "working" && queueFilter !== "all",
  ].filter(Boolean).length;

  const showChat = Boolean(active) && mobileShowChat;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2.5">
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search name or number…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            aria-label="Search conversations"
            className={BUZZ_SEARCH}
          />
        </div>

        {campaigns.length > 0 && (
          <Select value={campaignSelectValue} onValueChange={onCampaignChange}>
            <SelectTrigger className={cn(BUZZ_SELECT, "w-44")} aria-label="Campaign">
              <SelectValue placeholder="Campaign" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={CAMPAIGN_ALL}>All campaigns</SelectItem>
              <SelectItem value={CAMPAIGN_OLDER}>Older campaigns</SelectItem>
              {activeCampaigns.length > 0 && (
                <SelectGroup>
                  <SelectLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Active
                  </SelectLabel>
                  {activeCampaigns.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
              {olderCampaigns.length > 0 && (
                <>
                  <SelectSeparator />
                  <SelectGroup>
                    <SelectLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Older
                    </SelectLabel>
                    {olderCampaigns.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </>
              )}
            </SelectContent>
          </Select>
        )}

        {areas.length > 0 && (
          <Select value={areaFilter} onValueChange={setAreaFilter}>
            <SelectTrigger className={cn(BUZZ_SELECT, "w-40")} aria-label="Area">
              <SelectValue placeholder="Area" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={AREA_ALL}>All areas</SelectItem>
              {areas.map((item) => (
                <SelectItem key={item} value={item}>
                  {item}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Popover>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="relative gap-1.5">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              More
              {moreFilterCount > 0 && (
                <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                  {moreFilterCount}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 space-y-3 p-3">
            <div className="space-y-1">
              <Label className="text-xs">Agent</Label>
              <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
                <SelectTrigger className={cn(BUZZ_SELECT, "w-full")}>
                  <SelectValue placeholder="Agent" />
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
            {(meta?.tags?.length ?? 0) > 0 && (
              <div className="space-y-1">
                <Label className="text-xs">Tag</Label>
                <Select value={tagFilter} onValueChange={setTagFilter}>
                  <SelectTrigger className={cn(BUZZ_SELECT, "w-full")}>
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
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-xs">Status</Label>
              <Select
                value={
                  queueFilter === "working" || queueFilter === "all" ? "__default__" : queueFilter
                }
                onValueChange={(v) =>
                  setQueueFilter(v === "__default__" ? DEFAULT_INBOX_QUEUE_FILTER : (v as InboxQueueFilter))
                }
              >
                <SelectTrigger className={cn(BUZZ_SELECT, "w-full")}>
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default__">Use Inbox / All above</SelectItem>
                  {INBOX_QUEUE_FILTERS.filter((f) => f.id !== "working" && f.id !== "all").map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Sort</Label>
              <Select value={sortMode} onValueChange={(v) => setSortMode(v as InboxSortMode)}>
                <SelectTrigger className={cn(BUZZ_SELECT, "w-full")}>
                  <SelectValue placeholder="Sort" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="replies-first">Replies first</SelectItem>
                  <SelectItem value="recent">Newest first</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </PopoverContent>
        </Popover>

        {hasFilters && (
          <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
            Clear
          </Button>
        )}
      </div>

      <div className="flex shrink-0 flex-col gap-1.5 border-b border-border px-3 py-2">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Show
        </p>
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Inbox queue">
          {INBOX_PRIMARY_QUEUE_FILTERS.map((f) => (
            <BuzzchatFilterChip
              key={f.id}
              active={queueFilter === f.id}
              onClick={() => setQueueFilter(f.id)}
            >
              {f.label}
            </BuzzchatFilterChip>
          ))}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-[20rem_minmax(0,1fr)] lg:grid-cols-[22rem_minmax(0,1fr)]">
        <div
          className={cn(
            "min-h-0 min-w-0 flex-col overflow-hidden border-border bg-muted/20 md:border-r",
            showChat ? "hidden md:flex" : "flex",
          )}
        >
          <p className="shrink-0 px-3 py-2 text-xs text-muted-foreground">
            {isLoading
              ? "Loading conversations…"
              : blankInbox
                ? "Waiting for replies"
                : `${replyWaitingCount > 0 ? `${replyWaitingCount} need a reply · ` : ""}${
                    hasFilters ? `${queued.length} matching` : `${queued.length} of ${totalThreads}`
                  }`}
          </p>
          {isLoading ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <BuzzchatThreadSkeleton />
            </div>
          ) : blankInbox || queued.length === 0 ? (
            <BuzzchatEmptyState
              icon={MessageCircle}
              title={blankInbox ? "Inbox is empty" : "Nothing matches"}
              description={
                blankInbox
                  ? "When an owner replies, the chat appears here. After you set a remark, it moves to Listing leads."
                  : "Clear search or change Campaign, Area, or Show to see other chats."
              }
              action={
                blankInbox ? undefined : (
                  <Button type="button" variant="outline" size="sm" onClick={clearFilters}>
                    Clear filters
                  </Button>
                )
              }
            />
          ) : (
          <ul className="min-h-0 flex-1 divide-y divide-border/60 overflow-y-auto">
            {queued.map((t) => {
              const waiting = Boolean(t.needsReply);
              const selected = active?.phone === t.phone;
              const expired =
                resolveWatiChatStatus({
                  watiChatStatus: t.watiChatStatus,
                  lastInboundAt: t.lastInboundAt,
                }) === "expired";
              return (
                <li key={t.phone}>
                  <button
                    type="button"
                    onClick={() => {
                      setActivePhone(t.phone);
                      setMobileShowChat(true);
                    }}
                    className={cn(
                      "w-full px-3 py-3 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                      selected && "border-l-2 border-l-primary bg-primary/10",
                    )}
                  >
                    <div className="flex min-w-0 items-baseline justify-between gap-2">
                      <p className="min-w-0 truncate text-sm font-medium">
                        {waiting && (
                          <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-success align-middle" title="Needs reply" />
                        )}
                        {t.name ?? t.phone}
                      </p>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        <RelativeTime date={t.lastAt} short />
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {t.lastMessage ?? "—"}
                    </p>
                    <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <span className="min-w-0 truncate">
                        {[t.lastCampaignName, t.area].filter(Boolean).join(" · ") || t.phone}
                      </span>
                      {expired && <span className="shrink-0">Expired</span>}
                      {t.unread > 0 && (
                        <Badge variant="default" className="ml-auto h-4 min-w-4 px-1 text-[9px]">
                          {t.unread}
                        </Badge>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
            {canLoadMore && (
              <li className="p-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 w-full text-[10px]"
                  disabled={isFetching}
                  onClick={() => setVisibleCount((n) => n + THREAD_PAGE_SIZE)}
                >
                  {isFetching ? "Loading…" : "Load more"}
                </Button>
              </li>
            )}
          </ul>
          )}
        </div>

        {active ? (
          <div
            className={cn(
              "min-h-0 min-w-0 flex-col overflow-hidden bg-card",
              mobileShowChat ? "flex" : "hidden md:flex",
            )}
          >
            <div className="shrink-0 space-y-2 border-b border-border px-3 py-2.5 sm:px-4">
              <div className="flex items-start gap-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="mt-0.5 md:hidden"
                  aria-label="Back to conversations"
                  onClick={() => setMobileShowChat(false)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold leading-tight">
                    {active.name ?? active.phone}
                  </p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => {
                        void navigator.clipboard.writeText(active.phone);
                        toast.success("Number copied");
                      }}
                    >
                      <Phone className="h-3 w-3" />
                      {active.phone}
                      <Copy className="h-3 w-3 opacity-60" />
                    </button>
                    {(active.lastCampaignName || active.area) && (
                      <span className="truncate">
                        {[active.lastCampaignName, active.area].filter(Boolean).join(" · ")}
                      </span>
                    )}
                    <OpenLeadLink leadId={active.leadId} />
                    {whatsappPersonalLink(active.phone) && (
                      <a
                        href={whatsappPersonalLink(active.phone)!}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                      >
                        <ExternalLink className="h-3 w-3" />
                        My WhatsApp
                      </a>
                    )}
                    {active.listingOutcome && (
                      <a
                        href="/campaign-leads"
                        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                      >
                        Listing leads
                      </a>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                  {active.leadId && (
                    <Select
                      value={active.listingOutcome ?? "__unset__"}
                      onValueChange={(value) => {
                        if (value === "__unset__") return;
                        updateListingRemark.mutate(value as ListingOutcome);
                      }}
                    >
                      <SelectTrigger className="h-8 w-40 text-xs" aria-label="Admin remark">
                        <SelectValue placeholder="Remark" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__unset__">Needs remark</SelectItem>
                        {LISTING_OUTCOMES.map((id) => (
                          <SelectItem key={id} value={id}>
                            {LISTING_OUTCOME_LABELS[id]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <Select
                    value={active.status ?? "open"}
                    onValueChange={(value) =>
                      updateConversation.mutate({ status: value as "open" | "pending" | "solved" })
                    }
                  >
                    <SelectTrigger className="h-8 w-28 text-xs" aria-label="Conversation status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="open">Open</SelectItem>
                      <SelectItem value="pending">Waiting</SelectItem>
                      <SelectItem value="solved">Closed</SelectItem>
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
                    <SelectTrigger className="h-8 w-32 text-xs" aria-label="Assigned agent">
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
                      <SelectTrigger className="h-8 w-32 text-xs" aria-label="Assigned team">
                        <SelectValue placeholder="Team" />
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
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
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
                          tags: (active.tags ?? []).filter((item) => item !== tag),
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
                        "max-w-[min(28rem,90%)] shrink-0 rounded-2xl px-3 py-2 text-sm leading-relaxed shadow-sm",
                        m.direction === "outbound"
                          ? "ml-auto bg-primary text-primary-foreground"
                          : "border border-border bg-background text-foreground",
                      )}
                    >
                      {m.direction === "outbound" && m.sender_channel && (
                        <p className="mb-1 text-[9px] font-medium uppercase tracking-wide text-primary-foreground/75">
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

            <div className="shrink-0 border-t border-border bg-card px-3 py-2.5 sm:px-4">
              {watiConnected && isWhatsappFreeTextAllowed(active.lastInboundAt) ? (
                <>
                  <p className="text-[10px] text-muted-foreground">
                    Free-text is open for 24 hours after their last message.
                  </p>
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
                      aria-label={send.isPending ? "Sending" : "Send message"}
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                </>
              ) : watiConnected ? (
                <InboxTemplateComposer
                  leadId={active.leadId}
                  phone={active.phone}
                  contactName={active.name}
                  onSent={() => invalidateThreads()}
                />
              ) : (
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
              )}
            </div>
          </div>
        ) : (
          <div className="hidden bg-muted/10 md:flex">
            <BuzzchatEmptyState
              icon={MessageCircle}
              title="Select a conversation"
              description="Choose a chat on the left to read the thread, set a remark, and reply."
            />
          </div>
        )}
      </div>
    </div>
  );
}
