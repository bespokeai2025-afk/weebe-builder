import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Bell, Check, CheckCheck, AlertTriangle, Info, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  listWorkspaceNotifications,
  markNotificationsRead,
} from "@/lib/notifications/notifications.functions";

type NotificationRow = {
  id: string;
  event_key: string | null;
  title: string | null;
  message: string | null;
  severity: string | null;
  recipient_user_id: string | null;
  read_at: string | null;
  created_at: string;
};

function severityIcon(severity: string | null) {
  if (severity === "critical")
    return <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" />;
  if (severity === "warning")
    return <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-500" />;
  return <Info className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * Header bell icon with unread count + notifications inbox panel.
 * Lists workspace_notifications for the current user; supports
 * mark-read (per item) and mark-all-read.
 */
export function NotificationsBell() {
  const qc = useQueryClient();
  const listFn = useServerFn(listWorkspaceNotifications);
  const markFn = useServerFn(markNotificationsRead);

  const q = useQuery({
    queryKey: ["notifications-inbox"],
    queryFn: () => listFn({ data: { limit: 100 } }),
    refetchInterval: 60_000,
    throwOnError: false,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["notifications-inbox"] });
    qc.invalidateQueries({ queryKey: ["critical-notifications"] });
  };

  const markM = useMutation({
    mutationFn: (input: { ids?: string[]; all?: boolean }) => markFn({ data: input }),
    onSuccess: invalidate,
  });

  const rows: NotificationRow[] = (q.data as NotificationRow[]) ?? [];
  // Only user-addressed rows can be marked read; broadcast (null recipient)
  // rows are informational and never count toward the badge.
  const unread = rows.filter((r) => r.read_at === null && r.recipient_user_id !== null);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-8 w-8"
          aria-label={
            unread.length > 0 ? `Notifications (${unread.length} unread)` : "Notifications"
          }
        >
          <Bell className="h-4 w-4" />
          {unread.length > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground">
              {unread.length > 99 ? "99+" : unread.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-semibold">Notifications</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            disabled={markM.isPending || unread.length === 0}
            onClick={() => markM.mutate({ all: true })}
          >
            <CheckCheck className="mr-1 h-3.5 w-3.5" /> Mark all read
          </Button>
        </div>
        <ScrollArea className="max-h-96">
          {q.isLoading ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              No notifications yet
            </div>
          ) : (
            <div className="divide-y">
              {rows.map((n) => {
                const isUnread = n.read_at === null && n.recipient_user_id !== null;
                return (
                  <div
                    key={n.id}
                    className={`flex items-start gap-2 px-3 py-2.5 text-sm ${
                      isUnread ? "bg-primary/5" : ""
                    }`}
                  >
                    <span className="mt-0.5">{severityIcon(n.severity)}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className={`truncate ${isUnread ? "font-semibold" : "font-medium"}`}>
                          {n.title || n.event_key || "Notification"}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {timeAgo(n.created_at)}
                        </span>
                      </div>
                      {n.message ? (
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                          {String(n.message).split("\n")[0]}
                        </p>
                      ) : null}
                    </div>
                    {isUnread && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0"
                        title="Mark read"
                        disabled={markM.isPending}
                        onClick={() => markM.mutate({ ids: [n.id] })}
                      >
                        <Check className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
        <div className="border-t px-3 py-2">
          <Link
            to="/notifications"
            className="block text-center text-xs font-medium text-primary hover:underline"
          >
            View all in Notification Centre
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
