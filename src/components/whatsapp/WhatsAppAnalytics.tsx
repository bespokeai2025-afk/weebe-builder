import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BarChart3, Send, CheckCheck, Eye, MessageCircle, TrendingUp, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getWAAnalytics } from "@/lib/dashboard/whatsapp.functions";
import { getWatiConnection, listWatiCampaigns, syncWatiCampaigns } from "@/lib/whatsapp/wati.functions";

function KpiCard({
  label, value, sub, icon: Icon, color,
}: {
  label: string; value: string | number; sub?: string;
  icon: any; color: string;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground font-medium">{label}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </div>
          <div className={`rounded-lg p-2 ${color}`}>
            <Icon className="h-4 w-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SimpleBar({ data }: { data: { date: string; sent: number; received: number }[] }) {
  const max = Math.max(...data.flatMap((d) => [d.sent, d.received]), 1);
  return (
    <div className="flex items-end justify-between gap-1 h-32">
      {data.map((d) => (
        <div key={d.date} className="flex-1 flex flex-col items-center gap-1">
          <div className="w-full flex items-end gap-0.5" style={{ height: "90px" }}>
            <div
              className="flex-1 bg-primary/70 rounded-sm transition-all"
              style={{ height: `${Math.max((d.sent / max) * 90, 2)}px` }}
              title={`Sent: ${d.sent}`}
            />
            <div
              className="flex-1 bg-green-500/60 rounded-sm transition-all"
              style={{ height: `${Math.max((d.received / max) * 90, 2)}px` }}
              title={`Received: ${d.received}`}
            />
          </div>
          <p className="text-[9px] text-muted-foreground text-center leading-tight">{d.date}</p>
        </div>
      ))}
    </div>
  );
}

export function WhatsAppAnalytics() {
  const qc = useQueryClient();
  const analyticsFn   = useServerFn(getWAAnalytics);
  const watiConnFn    = useServerFn(getWatiConnection);
  const watiCampFn    = useServerFn(listWatiCampaigns);
  const watiSyncFn    = useServerFn(syncWatiCampaigns);

  const { data, isLoading } = useQuery({
    queryKey: ["wa-analytics"],
    queryFn: () => analyticsFn(),
    refetchInterval: 60_000,
    throwOnError: false,
  });

  const { data: watiConn } = useQuery({
    queryKey: ["wati-connection"],
    queryFn: () => watiConnFn(),
    throwOnError: false,
  });
  const watiConnected = !!watiConn && watiConn.status === "connected";

  const { data: watiCampaigns = [] } = useQuery({
    queryKey: ["wati-campaigns"],
    queryFn: () => watiCampFn(),
    enabled: watiConnected,
    throwOnError: false,
  });

  const watiTotalSent      = (watiCampaigns as any[]).reduce((a, c) => a + (c.sent ?? 0), 0);
  const watiTotalDelivered = (watiCampaigns as any[]).reduce((a, c) => a + (c.delivered ?? 0), 0);
  const watiTotalRead      = (watiCampaigns as any[]).reduce((a, c) => a + (c.read_count ?? 0), 0);

  const syncWati = useMutation({
    mutationFn: () => watiSyncFn(),
    onSuccess: (res: { count?: number; statusUpdated?: number }) => {
      qc.invalidateQueries({ queryKey: ["wati-campaigns"] });
      qc.invalidateQueries({ queryKey: ["wa-analytics"] });
      const n = res.count ?? 0;
      const st = res.statusUpdated ?? 0;
      toast.success(
        st > 0
          ? `Refreshed analytics — ${st} message${st === 1 ? "" : "s"} updated to delivered/read`
          : n > 0
            ? `Refreshed ${n} campaign${n === 1 ? "" : "s"}`
            : "Analytics refreshed",
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) {
    return <div className="py-16 text-center text-sm text-muted-foreground">Loading analytics…</div>;
  }

  if (!data || !data.hasData) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
        <BarChart3 className="h-10 w-10 opacity-30" />
        <p className="text-sm font-medium">No data yet</p>
        <p className="text-xs">Analytics will appear once messages start flowing.</p>
      </div>
    );
  }

  const msgStats = data.providers?.messages;
  const watiStats = data.providers?.wati;
  const watiBreakdownSent = watiTotalSent || watiStats?.sent || 0;
  const watiBreakdownDelivered = watiTotalDelivered || watiStats?.delivered || 0;
  const watiBreakdownRead = watiTotalRead || watiStats?.read || 0;
  const deliveryPending =
    data.sent > 0 &&
    data.delivered === 0 &&
    (msgStats?.sent ?? 0) > 0 &&
    (msgStats?.delivered ?? 0) === 0;

  const deliveryRate = data.sent > 0 ? Math.round((data.delivered / data.sent) * 100) : 0;
  const readRate     = data.sent > 0 ? Math.round((data.read / data.sent) * 100) : 0;

  return (
    <div className="space-y-6">
      {watiConnected && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {deliveryPending && (
            <div className="text-[11px] text-amber-600 dark:text-amber-400 max-w-xl space-y-1">
              <p>
                Delivered/read are not updating yet. In WATI → Connectors → Webhooks, enable these events on
                your Webee URL:
              </p>
              <ul className="list-disc pl-4 text-[10px] space-y-0.5">
                <li>Template Message Sent</li>
                <li>Sent Message is Delivered</li>
                <li>Sent Message is Read</li>
              </ul>
              <p className="text-[10px]">
                Click Refresh — Webee also polls WATI for status on recent sends. New campaigns track read
                reliably; older sends may stay at “sent”.
              </p>
            </div>
          )}
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 ml-auto"
            onClick={() => syncWati.mutate()}
            disabled={syncWati.isPending}
          >
            {syncWati.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Refresh WATI stats
          </Button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <KpiCard
          label="Messages Sent"
          value={data.sent.toLocaleString()}
          icon={Send}
          color="bg-primary/10 text-primary"
        />
        <KpiCard
          label="Delivered"
          value={data.delivered.toLocaleString()}
          sub={`${deliveryRate}% rate`}
          icon={CheckCheck}
          color="bg-blue-500/10 text-blue-600"
        />
        <KpiCard
          label="Read"
          value={data.read.toLocaleString()}
          sub={`${readRate}% rate`}
          icon={Eye}
          color="bg-violet-500/10 text-violet-600"
        />
        <KpiCard
          label="Responses"
          value={data.responses.toLocaleString()}
          icon={MessageCircle}
          color="bg-green-500/10 text-green-600"
        />
        <KpiCard
          label="Conversion Rate"
          value={`${data.convRate}%`}
          sub="responses / sent"
          icon={TrendingUp}
          color="bg-orange-500/10 text-orange-600"
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Messages — Last 7 Days</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <SimpleBar data={data.days} />
          <div className="flex items-center gap-4 mt-3">
            <div className="flex items-center gap-1.5">
              <div className="h-2.5 w-2.5 rounded-sm bg-primary/70" />
              <span className="text-xs text-muted-foreground">Sent</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-2.5 w-2.5 rounded-sm bg-green-500/60" />
              <span className="text-xs text-muted-foreground">Received</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-5">
            <p className="text-xs text-muted-foreground font-medium">Total Messages</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{data.total.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-0.5">All time, all directions</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs text-muted-foreground font-medium">Delivery Rate</p>
            <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${deliveryRate}%` }} />
            </div>
            <p className="mt-1 text-lg font-bold tabular-nums">{deliveryRate}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs text-muted-foreground font-medium">Read Rate</p>
            <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-violet-500 rounded-full transition-all" style={{ width: `${readRate}%` }} />
            </div>
            <p className="mt-1 text-lg font-bold tabular-nums">{readRate}%</p>
          </CardContent>
        </Card>
      </div>

      {/* ── Provider Breakdown ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Provider Breakdown</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="divide-y divide-border/40">
            {[
              {
                provider: "Twilio",
                color: "text-blue-400 border-blue-500/30",
                dot: "bg-blue-500",
                sent: data.providers?.twilio?.sent ?? 0,
                delivered: data.providers?.twilio?.delivered ?? 0,
                read: data.providers?.twilio?.read ?? 0,
                always: true,
              },
              {
                provider: "Meta Cloud API",
                color: "text-green-400 border-green-500/30",
                dot: "bg-green-500",
                sent: 0,
                delivered: 0,
                read: 0,
                always: true,
              },
              ...(watiConnected
                ? [
                    {
                      provider: "WATI",
                      color: "text-purple-400 border-purple-500/30",
                      dot: "bg-purple-500",
                      sent: watiBreakdownSent,
                      delivered: watiBreakdownDelivered,
                      read: watiBreakdownRead,
                      always: false,
                    },
                  ]
                : []),
            ].map(({ provider, color, dot, sent, delivered, read }) => (
              <div key={provider} className="flex items-center justify-between py-3">
                <div className="flex items-center gap-2">
                  <div className={`h-2 w-2 rounded-full ${dot}`} />
                  <span className="text-sm font-medium">{provider}</span>
                  <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${color}`}>
                    {provider === "WATI" ? "Connected" : "Active"}
                  </Badge>
                </div>
                <div className="flex items-center gap-6 text-xs tabular-nums">
                  <div className="text-right">
                    <p className="text-muted-foreground">Sent</p>
                    <p className="font-semibold">{sent.toLocaleString()}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-muted-foreground">Delivered</p>
                    <p className="font-semibold">{delivered.toLocaleString()}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-muted-foreground">Read</p>
                    <p className="font-semibold">{read.toLocaleString()}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {!watiConnected && (
            <p className="text-[11px] text-muted-foreground mt-2 border-t border-border/40 pt-2">
              Connect WATI in Settings → Optional Integrations to see WATI campaign analytics here.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
