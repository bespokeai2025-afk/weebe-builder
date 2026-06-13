import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Send, CheckCheck, Eye, MessageCircle, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getWAAnalytics } from "@/lib/dashboard/whatsapp.functions";

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
  const analyticsFn = useServerFn(getWAAnalytics);
  const { data, isLoading } = useQuery({
    queryKey: ["wa-analytics"],
    queryFn: () => analyticsFn(),
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return <div className="py-16 text-center text-sm text-muted-foreground">Loading analytics…</div>;
  }

  if (!data || data.total === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
        <BarChart3 className="h-10 w-10 opacity-30" />
        <p className="text-sm font-medium">No data yet</p>
        <p className="text-xs">Analytics will appear once messages start flowing.</p>
      </div>
    );
  }

  const deliveryRate = data.sent > 0 ? Math.round((data.delivered / data.sent) * 100) : 0;
  const readRate     = data.sent > 0 ? Math.round((data.read / data.sent) * 100) : 0;

  return (
    <div className="space-y-6">
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
    </div>
  );
}
