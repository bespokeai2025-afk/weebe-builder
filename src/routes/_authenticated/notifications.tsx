/**
 * Notification Centre — full-page inbox for workspace in-app notifications.
 * The header bell popover shows a quick preview; this page is the complete
 * list with unread/severity filters and mark-read controls.
 */
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Bell,
  Check,
  CheckCheck,
  AlertTriangle,
  AlertCircle,
  Info,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  listWorkspaceNotifications,
  markNotificationsRead,
} from "@/lib/notifications/notifications.functions";

export const Route = createFileRoute("/_authenticated/notifications")({
  head: () => ({ meta: [{ title: "Notification Centre — Webee" }] }),
  component: NotificationCentre,
});

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

const SEVERITY_FILTERS = [
  { key: "all", label: "All" },
  { key: "critical", label: "Critical" },
  { key: "warning", label: "Warning" },
  { key: "info", label: "Info" },
] as const;

function severityIcon(severity: string | null) {
  if (severity === "critical")
    return <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />;
  if (severity === "warning")
    return <AlertCircle className="h-4 w-4 shrink-0 text-amber-500" />;
  return <Info className="h-4 w-4 shrink-0 text-muted-foreground" />;
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

function NotificationCentre() {
  const qc = useQueryClient();
  const listFn = useServerFn(listWorkspaceNotifications);
  const markFn = useServerFn(markNotificationsRead);
  const [severity, setSeverity] = useState<string>("all");
  const [unreadOnly, setUnreadOnly] = useState(false);

  const q = useQuery({
    queryKey: ["notifications-centre", severity, unreadOnly],
    queryFn: () =>
      listFn({
        data: {
          limit: 200,
          unreadOnly: unreadOnly || undefined,
          severity: severity === "all" ? undefined : severity,
        },
      }),
    refetchInterval: 60_000,
    throwOnError: false,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["notifications-centre"] });
    qc.invalidateQueries({ queryKey: ["notifications-inbox"] });
    qc.invalidateQueries({ queryKey: ["critical-notifications"] });
  };

  const markM = useMutation({
    mutationFn: (input: { ids?: string[]; all?: boolean }) =>
      markFn({ data: input }),
    onSuccess: invalidate,
  });

  const rows: NotificationRow[] = (q.data as NotificationRow[]) ?? [];
  const unread = rows.filter(
    (r) => r.read_at === null && r.recipient_user_id !== null,
  );

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6 max-w-4xl w-full mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2">
            <Bell className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold leading-tight">
              Notification Centre
            </h1>
            <p className="text-sm text-muted-foreground">
              All in-app notifications for your workspace
              {unread.length > 0 ? ` · ${unread.length} unread` : ""}
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={markM.isPending || unread.length === 0}
          onClick={() => markM.mutate({ all: true })}
        >
          <CheckCheck className="mr-1.5 h-4 w-4" /> Mark all read
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {SEVERITY_FILTERS.map((f) => (
          <Button
            key={f.key}
            variant={severity === f.key ? "default" : "outline"}
            size="sm"
            className="h-7 text-xs"
            onClick={() => setSeverity(f.key)}
          >
            {f.label}
          </Button>
        ))}
        <div className="mx-1 h-5 w-px bg-border" />
        <Button
          variant={unreadOnly ? "default" : "outline"}
          size="sm"
          className="h-7 text-xs"
          onClick={() => setUnreadOnly((v) => !v)}
        >
          Unread only
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {q.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading notifications…
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <Bell className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                {unreadOnly || severity !== "all"
                  ? "No notifications match your filters"
                  : "No notifications yet"}
              </p>
            </div>
          ) : (
            <div className="divide-y">
              {rows.map((n) => {
                const isUnread =
                  n.read_at === null && n.recipient_user_id !== null;
                return (
                  <div
                    key={n.id}
                    className={cn(
                      "flex items-start gap-3 px-4 py-3",
                      isUnread && "bg-primary/5",
                    )}
                  >
                    <span className="mt-0.5">{severityIcon(n.severity)}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span
                          className={cn(
                            "text-sm",
                            isUnread ? "font-semibold" : "font-medium",
                          )}
                        >
                          {n.title || n.event_key || "Notification"}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {timeAgo(n.created_at)}
                        </span>
                      </div>
                      {n.message ? (
                        <p className="mt-0.5 whitespace-pre-line text-xs text-muted-foreground">
                          {n.message}
                        </p>
                      ) : null}
                      <div className="mt-1 flex items-center gap-2">
                        {n.event_key ? (
                          <Badge
                            variant="outline"
                            className="h-5 px-1.5 text-[10px] font-normal text-muted-foreground"
                          >
                            {n.event_key.replaceAll("_", " ")}
                          </Badge>
                        ) : null}
                        {n.recipient_user_id === null ? (
                          <Badge
                            variant="outline"
                            className="h-5 px-1.5 text-[10px] font-normal text-muted-foreground"
                          >
                            broadcast
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                    {isUnread && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        title="Mark read"
                        disabled={markM.isPending}
                        onClick={() => markM.mutate({ ids: [n.id] })}
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
