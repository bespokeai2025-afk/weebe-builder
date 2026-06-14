import { useState, useRef, useEffect } from "react";
import { RelativeTime } from "@/components/ui/relative-time";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, Send, MessageCircle, Phone, Clock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { listWhatsappThreads, sendWhatsappMessage } from "@/lib/dashboard/whatsapp.functions";
import { toast } from "sonner";


export function WhatsAppInbox() {
  const qc = useQueryClient();
  const listFn = useServerFn(listWhatsappThreads);
  const sendFn = useServerFn(sendWhatsappMessage);

  const { data: threads = [], isLoading } = useQuery({
    queryKey: ["wa-threads"],
    queryFn: () => listFn(),
    refetchInterval: 30_000,
  });

  const [search, setSearch] = useState("");
  const [activePhone, setActivePhone] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const filtered = threads.filter((t: any) =>
    (t.name ?? t.phone).toLowerCase().includes(search.toLowerCase()) ||
    t.phone.includes(search),
  );
  const active = filtered.find((t: any) => t.phone === activePhone) ?? filtered[0] ?? null;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [active?.phone, active?.messages?.length]);

  const send = useMutation({
    mutationFn: () => sendFn({ data: { to: active!.phone, body: reply, contactName: active!.name ?? undefined } }),
    onSuccess: () => {
      setReply("");
      qc.invalidateQueries({ queryKey: ["wa-threads"] });
      toast.success("Message sent");
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading) {
    return (
      <div className="flex h-[600px] items-center justify-center text-muted-foreground text-sm">
        Loading conversations…
      </div>
    );
  }

  if (threads.length === 0) {
    return (
      <div className="flex h-[600px] flex-col items-center justify-center gap-3 text-muted-foreground">
        <MessageCircle className="h-10 w-10 opacity-30" />
        <p className="text-sm font-medium">No conversations yet</p>
        <p className="text-xs">Inbound WhatsApp messages will appear here automatically.</p>
      </div>
    );
  }

  const msgs = active ? [...(active.messages ?? [])].sort(
    (a: any, b: any) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime(),
  ) : [];

  return (
    <div className="grid h-[640px] grid-cols-[300px_1fr] gap-0 overflow-hidden rounded-lg border border-border">
      {/* Sidebar */}
      <div className="flex flex-col border-r border-border bg-muted/20">
        <div className="p-3 border-b border-border">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search conversations…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-xs"
            />
          </div>
        </div>
        <ul className="flex-1 overflow-y-auto divide-y divide-border/60">
          {filtered.map((t: any) => (
            <li key={t.phone}>
              <button
                onClick={() => setActivePhone(t.phone)}
                className={cn(
                  "w-full px-3 py-3 text-left transition-colors hover:bg-accent/50",
                  active?.phone === t.phone && "bg-primary/8 border-r-2 border-primary",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold">{t.name ?? t.phone}</p>
                    {t.name && (
                      <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <Phone className="h-2.5 w-2.5" />{t.phone}
                      </p>
                    )}
                    <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{t.lastMessage ?? "—"}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className="text-[9px] text-muted-foreground flex items-center gap-0.5">
                      <Clock className="h-2 w-2" /><RelativeTime date={t.lastAt} short />
                    </span>
                    {t.unread > 0 && (
                      <Badge variant="default" className="h-4 min-w-4 px-1 text-[9px]">
                        {t.unread}
                      </Badge>
                    )}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* Chat pane */}
      {active ? (
        <div className="flex flex-col">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-background">
            <div className="h-8 w-8 rounded-full bg-primary/15 flex items-center justify-center">
              <span className="text-xs font-bold text-primary">
                {(active.name ?? active.phone).charAt(0).toUpperCase()}
              </span>
            </div>
            <div>
              <p className="text-sm font-semibold">{active.name ?? active.phone}</p>
              <p className="text-[10px] text-muted-foreground">{active.phone}</p>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-muted/10">
            {msgs.map((m: any) => (
              <div
                key={m.id}
                className={cn(
                  "max-w-[72%] rounded-2xl px-3 py-2 text-xs shadow-sm",
                  m.direction === "outbound"
                    ? "ml-auto bg-primary text-primary-foreground"
                    : "bg-background border border-border text-foreground",
                )}
              >
                <p>{m.body ?? "(media)"}</p>
                <p className={cn("mt-0.5 text-[9px]", m.direction === "outbound" ? "text-primary-foreground/70" : "text-muted-foreground")}>
                  {new Date(m.sent_at).toLocaleString()} · {m.status ?? ""}
                </p>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          <div className="flex items-end gap-2 px-4 py-3 border-t border-border bg-background">
            <Textarea
              placeholder="Type a message…"
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              className="min-h-[60px] max-h-32 resize-none text-sm flex-1"
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
      ) : (
        <div className="flex items-center justify-center text-sm text-muted-foreground">
          Select a conversation
        </div>
      )}
    </div>
  );
}
