import { useQuery } from "@tanstack/react-query";
import {
  Send,
  MailOpen,
  MousePointerClick,
  AlertCircle,
  TrendingUp,
  Users,
  Mail,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { listHexmailCampaigns } from "@/lib/hexmail/campaigns.functions";

interface StatCard {
  label: string;
  value: string;
  sub: string;
  icon: React.ElementType;
  color: string;
  bg: string;
}

const STATS: StatCard[] = [
  {
    label: "Total Sent",
    value: "2,847",
    sub: "+12% this month",
    icon: Send,
    color: "text-sky-400",
    bg: "bg-sky-500/10 border-sky-500/20",
  },
  {
    label: "Delivered",
    value: "2,801",
    sub: "98.4% delivery rate",
    icon: Mail,
    color: "text-emerald-400",
    bg: "bg-emerald-500/10 border-emerald-500/20",
  },
  {
    label: "Opened",
    value: "1,134",
    sub: "40.5% open rate",
    icon: MailOpen,
    color: "text-violet-400",
    bg: "bg-violet-500/10 border-violet-500/20",
  },
  {
    label: "Clicked",
    value: "387",
    sub: "13.8% click rate",
    icon: MousePointerClick,
    color: "text-amber-400",
    bg: "bg-amber-500/10 border-amber-500/20",
  },
  {
    label: "Bounced",
    value: "46",
    sub: "1.6% bounce rate",
    icon: AlertCircle,
    color: "text-rose-400",
    bg: "bg-rose-500/10 border-rose-500/20",
  },
  {
    label: "Unsubscribed",
    value: "23",
    sub: "0.8% unsub rate",
    icon: Users,
    color: "text-slate-400",
    bg: "bg-slate-500/10 border-slate-500/20",
  },
];

const CAMPAIGN_STATS = [
  { name: "30-Day Warm Nurture",   sent: 842, opened: 381, clicked: 94,  openRate: 45.2, clickRate: 11.2 },
  { name: "Onboarding Series",     sent: 614, opened: 289, clicked: 112, openRate: 47.1, clickRate: 18.2 },
  { name: "Re-engagement",         sent: 501, opened: 178, clicked: 43,  openRate: 35.5, clickRate: 8.6 },
  { name: "Product Update",        sent: 423, opened: 201, clicked: 89,  openRate: 47.5, clickRate: 21.0 },
  { name: "Weekly Newsletter",     sent: 467, opened: 155, clicked: 49,  openRate: 33.2, clickRate: 10.5 },
];

function RateBar({ value, max = 100, color }: { value: number; max?: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all", color)}
          style={{ width: `${Math.min((value / max) * 100, 100)}%` }}
        />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground w-10 text-right">
        {value}%
      </span>
    </div>
  );
}

export function EmailAnalytics() {
  const campaignsQ = useQuery({
    queryKey: ["hexmail-campaigns"],
    queryFn: () => listHexmailCampaigns({ data: {} }),
  });

  const hasCampaigns = (campaignsQ.data ?? []).length > 0;

  return (
    <div className="space-y-6">
      {/* Overview stat cards */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          Overview — Last 30 Days
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {STATS.map((s) => (
            <div
              key={s.label}
              className={cn("rounded-lg border p-3 flex flex-col gap-2", s.bg)}
            >
              <div className={cn("flex items-center gap-1.5", s.color)}>
                <s.icon className="h-3.5 w-3.5" />
                <span className="text-[11px] font-medium">{s.label}</span>
              </div>
              <div>
                <p className="text-xl font-bold text-foreground">{s.value}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{s.sub}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Campaign performance table */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
          <TrendingUp className="h-4 w-4" />
          Campaign Performance
        </h2>
        <div className="rounded-lg border overflow-hidden">
          <div className="grid grid-cols-[1fr_auto_auto_1fr_1fr] items-center gap-4 border-b bg-muted/30 px-4 py-2.5">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Campaign</span>
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground w-12 text-right">Sent</span>
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground w-16 text-right">Opened</span>
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Open Rate</span>
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Click Rate</span>
          </div>

          {(hasCampaigns ? CAMPAIGN_STATS : CAMPAIGN_STATS).map((c, idx) => (
            <div
              key={c.name}
              className={cn(
                "grid grid-cols-[1fr_auto_auto_1fr_1fr] items-center gap-4 px-4 py-3 hover:bg-muted/20 transition-colors",
                idx < CAMPAIGN_STATS.length - 1 && "border-b border-border/60",
              )}
            >
              <span className="text-sm font-medium truncate">{c.name}</span>
              <span className="text-sm tabular-nums text-muted-foreground w-12 text-right">{c.sent.toLocaleString()}</span>
              <span className="text-sm tabular-nums text-muted-foreground w-16 text-right">{c.opened.toLocaleString()}</span>
              <RateBar value={c.openRate} color="bg-violet-400" />
              <RateBar value={c.clickRate} color="bg-amber-400" />
            </div>
          ))}
        </div>
      </div>

      {/* Best send times */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          Best Send Times
        </h2>
        <div className="grid grid-cols-7 gap-1.5">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day, di) => {
            const hours = [9, 10, 11, 14, 15, 16];
            return (
              <div key={day} className="space-y-1">
                <p className="text-center text-[11px] text-muted-foreground">{day}</p>
                {hours.map((h) => {
                  const intensity = Math.random();
                  const isHot = intensity > 0.7;
                  const isWarm = intensity > 0.4;
                  return (
                    <div
                      key={h}
                      title={`${day} ${h}:00 — ${Math.round(intensity * 60)}% open rate`}
                      className={cn(
                        "rounded h-5 text-[9px] flex items-center justify-center font-medium transition-colors cursor-default",
                        isHot
                          ? "bg-violet-500/70 text-violet-100"
                          : isWarm
                          ? "bg-violet-500/30 text-violet-300"
                          : "bg-muted text-muted-foreground/50",
                      )}
                    >
                      {h}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground mt-2 text-center">
          Showing sample analytics — connect your provider to see live data.
        </p>
      </div>
    </div>
  );
}
