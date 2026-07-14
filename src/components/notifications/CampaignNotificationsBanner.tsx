import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  listCriticalNotifications,
  markNotificationsRead,
} from "@/lib/notifications/notifications.functions";

/**
 * Critical campaign notifications banner (unread, last 48h) — shown on the
 * Campaigns page. Dismissing marks the notifications read.
 */
export function CampaignNotificationsBanner() {
  const qc = useQueryClient();
  const listFn = useServerFn(listCriticalNotifications);
  const markFn = useServerFn(markNotificationsRead);

  const q = useQuery({
    queryKey: ["critical-notifications"],
    queryFn: () => listFn(),
    refetchInterval: 60_000,
    throwOnError: false,
  });

  const dismissM = useMutation({
    mutationFn: (ids: string[]) => markFn({ data: { ids } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["critical-notifications"] }),
  });

  const rows = q.data ?? [];
  if (rows.length === 0) return null;

  return (
    <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-destructive">
          <AlertTriangle className="h-4 w-4" />
          Campaign alerts
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          disabled={dismissM.isPending}
          onClick={() => dismissM.mutate(rows.map((r: any) => r.id))}
        >
          <X className="mr-1 h-3.5 w-3.5" /> Dismiss all
        </Button>
      </div>
      <div className="space-y-1.5">
        {rows.map((n: any) => (
          <div key={n.id} className="flex items-start gap-2 text-sm">
            <span className="flex-1">
              <span className="font-medium">{n.title}</span>
              {n.message ? (
                <span className="text-muted-foreground"> — {String(n.message).split("\n")[0]}</span>
              ) : null}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {new Date(n.created_at).toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
