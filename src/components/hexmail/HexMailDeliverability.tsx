import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import {
  ShieldCheck, Globe, Inbox, Flame, AlertTriangle,
  CheckCircle, XCircle, TrendingUp, Mail, ArrowRight, RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getDeliverabilityDashboard } from "@/lib/hexmail/deliverability.server";

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 80 ? "text-emerald-400" : score >= 60 ? "text-amber-400" : "text-red-400";
  const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 55 ? "C" : score >= 35 ? "D" : "F";
  return (
    <div className="flex items-end gap-1">
      <span className={cn("text-4xl font-bold tabular-nums", color)}>{score}</span>
      <span className={cn("text-xl font-semibold mb-1", color)}>{grade}</span>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, sub, color = "text-muted-foreground" }: {
  icon: React.ElementType; label: string; value: string | number; sub?: string; color?: string;
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 flex flex-col gap-2">
      <div className="flex items-center gap-2 text-muted-foreground/60 text-xs">
        <Icon className="h-3.5 w-3.5" />
        <span>{label}</span>
      </div>
      <div className={cn("text-2xl font-bold", color)}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground/40">{sub}</div>}
    </div>
  );
}

const QUICK_LINKS = [
  { label: "Sender Domains", sub: "Verify DNS & manage domains", icon: Globe,      to: "/hexmail/sender-domains" },
  { label: "Mailboxes",      sub: "Manage send limits",          icon: Inbox,      to: "/hexmail/mailboxes" },
  { label: "Domain Warming", sub: "Build warmup schedules",      icon: Flame,      to: "/hexmail/domain-warming" },
  { label: "Reputation",     sub: "Bounce & complaint tracking", icon: TrendingUp, to: "/hexmail/reputation" },
];

export function HexMailDeliverability() {
  const getDashFn = useServerFn(getDeliverabilityDashboard);
  const { data, isLoading, refetch } = useQuery({
    queryKey:  ["deliverability-dashboard"],
    queryFn:   () => getDashFn(),
    staleTime: 30_000,
  });

  const stats = data?.stats;

  return (
    <div className="flex flex-col gap-6 p-6 max-w-6xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Deliverability Centre</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Domain reputation, DNS health, warmup plans, and send controls.
          </p>
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-xs text-muted-foreground hover:bg-white/[0.06] transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      {/* Health Score */}
      <div className="rounded-xl border border-white/[0.08] bg-gradient-to-br from-white/[0.03] to-transparent p-6 flex flex-col sm:flex-row items-start sm:items-center gap-6">
        <div className="flex flex-col gap-1 min-w-[120px]">
          <span className="text-xs text-muted-foreground/60 uppercase tracking-widest">Domain Health Score</span>
          {isLoading
            ? <div className="h-10 w-20 animate-pulse rounded-lg bg-white/[0.06]" />
            : <ScoreBadge score={stats?.avgHealthScore ?? 0} />}
        </div>
        <div className="flex-1 flex flex-wrap gap-3">
          {stats?.warnings?.slice(0, 4).map((w: string, i: number) => (
            <div key={i} className="flex items-center gap-1.5 rounded-lg border border-amber-500/20 bg-amber-500/5 px-2.5 py-1.5 text-xs text-amber-400">
              <AlertTriangle className="h-3 w-3 shrink-0" /> {w}
            </div>
          ))}
          {!isLoading && (stats?.warnings?.length ?? 0) === 0 && (
            <div className="flex items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-1.5 text-xs text-emerald-400">
              <CheckCircle className="h-3 w-3" /> All DNS checks passing
            </div>
          )}
        </div>
      </div>

      {/* Stats grid */}
      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-white/[0.03]" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard icon={Globe}     label="Sender Domains"   value={stats?.totalDomains ?? 0}   sub={`${stats?.activeDomains ?? 0} active`} />
          <StatCard icon={Inbox}     label="Mailboxes"        value={stats?.totalMailboxes ?? 0}  sub="registered" />
          <StatCard icon={Flame}     label="Warmup Plans"     value={stats?.activePlans ?? 0}     sub="active" />
          <StatCard icon={Mail}      label="Sends Today"      value={stats?.sendsToday ?? 0}      sub={`of ${stats?.sendAllowance ?? 0} allowed`}
            color={(stats?.sendsToday ?? 0) >= (stats?.sendAllowance ?? 1) * 0.9 ? "text-amber-400" : "text-foreground"} />
          <StatCard icon={TrendingUp}  label="Bounce Rate"    value={`${stats?.bounceRate ?? 0}%`}
            color={(stats?.bounceRate ?? 0) > 5 ? "text-red-400" : (stats?.bounceRate ?? 0) > 2 ? "text-amber-400" : "text-emerald-400"}
            sub="last 30 days" />
          <StatCard icon={XCircle}   label="Complaints"       value={`${stats?.complaintRate ?? 0}%`}
            color={(stats?.complaintRate ?? 0) > 0.1 ? "text-red-400" : "text-emerald-400"}
            sub="last 30 days" />
          <StatCard icon={CheckCircle} label="Bounces"        value={stats?.bounceCount ?? 0}    sub="last 30 days" />
          <StatCard icon={AlertTriangle} label="Complaints (count)" value={stats?.complaintCount ?? 0} sub="last 30 days" />
        </div>
      )}

      {/* Quick links */}
      <div>
        <h2 className="text-sm font-medium text-muted-foreground mb-3">Quick Access</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {QUICK_LINKS.map((link) => (
            <Link key={link.to} to={link.to}
              className="group flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 hover:border-white/[0.12] hover:bg-white/[0.04] transition-all"
            >
              <div className="flex items-center gap-3">
                <link.icon className="h-4 w-4 text-muted-foreground/60 group-hover:text-foreground transition-colors" />
                <div>
                  <div className="text-sm font-medium">{link.label}</div>
                  <div className="text-[11px] text-muted-foreground/50">{link.sub}</div>
                </div>
              </div>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/30 group-hover:text-muted-foreground transition-colors" />
            </Link>
          ))}
        </div>
      </div>

      {/* Recent events */}
      {(stats?.recentEvents?.length ?? 0) > 0 && (
        <div>
          <h2 className="text-sm font-medium text-muted-foreground mb-3">Recent Reputation Events</h2>
          <div className="rounded-xl border border-white/[0.06] divide-y divide-white/[0.04] overflow-hidden">
            {stats!.recentEvents.map((ev: any, i: number) => (
              <div key={i} className="flex items-center justify-between px-4 py-2.5 text-xs">
                <div className="flex items-center gap-2">
                  <span className={cn("capitalize font-medium",
                    ev.severity === "critical" ? "text-red-400" : ev.severity === "warning" ? "text-amber-400" : "text-muted-foreground/70"
                  )}>{ev.event_type.replace("_", " ")}</span>
                  <span className="text-muted-foreground/40">{ev.description}</span>
                </div>
                <span className="text-muted-foreground/30 ml-4 shrink-0">{new Date(ev.created_at).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-end">
            <Link to="/hexmail/reputation" className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors flex items-center gap-1">
              View all events <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && (stats?.totalDomains ?? 0) === 0 && (
        <div className="rounded-xl border border-dashed border-white/[0.10] p-10 text-center flex flex-col items-center gap-3">
          <ShieldCheck className="h-8 w-8 text-muted-foreground/30" />
          <div>
            <p className="text-sm font-medium">No sender domains yet</p>
            <p className="text-xs text-muted-foreground/50 mt-1">Add a sender domain to start verifying DNS and warming up your mailboxes.</p>
          </div>
          <Link to="/hexmail/sender-domains"
            className="mt-2 rounded-lg bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 transition-opacity"
          >
            Add Sender Domain
          </Link>
        </div>
      )}
    </div>
  );
}
