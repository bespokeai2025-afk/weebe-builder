import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { TrendingUp, AlertTriangle, XCircle, CheckCircle, Info, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { getSenderDomains, getReputationEvents } from "@/lib/hexmail/deliverability.server";

const SEVERITY_STYLES: Record<string, { icon: React.ElementType; class: string }> = {
  critical: { icon: XCircle,       class: "text-red-400 border-red-500/20 bg-red-500/5" },
  warning:  { icon: AlertTriangle, class: "text-amber-400 border-amber-500/20 bg-amber-500/5" },
  info:     { icon: Info,          class: "text-blue-400/70 border-blue-500/20 bg-blue-500/5" },
};

const EVENT_LABELS: Record<string, string> = {
  bounce:           "Bounce",
  complaint:        "Spam Complaint",
  unsubscribe:      "Unsubscribe",
  delivery_failure: "Delivery Failure",
  provider_error:   "Provider Error",
  dns_failure:      "DNS Failure",
  spam_trap:        "Spam Trap Hit",
};

function HealthBar({ label, score, max = 30 }: { label: string; score: number; max?: number }) {
  const pct  = Math.round((score / max) * 100);
  const color = pct >= 80 ? "bg-emerald-400" : pct >= 50 ? "bg-amber-400" : "bg-red-400";
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-muted-foreground/60 w-14">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-white/[0.06]">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground/50">{score}/{max}</span>
    </div>
  );
}

export function HexMailReputation() {
  const getDomainsFn = useServerFn(getSenderDomains);
  const getEventsFn  = useServerFn(getReputationEvents);

  const { data: domains = [], isLoading: loadingDomains } = useQuery({
    queryKey: ["sender-domains"],
    queryFn:  () => getDomainsFn(),
    throwOnError: false,
  });
  const { data: events = [], isLoading: loadingEvents } = useQuery({
    queryKey: ["reputation-events"],
    queryFn:  () => getEventsFn(),
    staleTime: 30_000,
    throwOnError: false,
  });

  const bounces       = events.filter((e: any) => e.event_type === "bounce").length;
  const complaints    = events.filter((e: any) => e.event_type === "complaint").length;
  const failures      = events.filter((e: any) => e.event_type === "delivery_failure").length;
  const total         = events.length;
  const bounceRate    = total > 0 ? +(bounces / total * 100).toFixed(1) : 0;
  const complaintRate = total > 0 ? +(complaints / total * 100).toFixed(1) : 0;

  const topDomain = domains[0];
  const breakdown = topDomain?.healthScore?.breakdown ?? {};

  return (
    <div className="flex flex-col gap-6 p-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Reputation Monitor</h1>
        <p className="text-sm text-muted-foreground mt-1">Track bounces, complaints, and domain health signals over time.</p>
      </div>

      {/* Health breakdown */}
      {!loadingDomains && topDomain && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium">DNS Health Breakdown — {topDomain.domain}</h2>
            <div className="flex items-center gap-1.5">
              <span className={cn("text-2xl font-bold", topDomain.healthScore.score >= 80 ? "text-emerald-400" : topDomain.healthScore.score >= 60 ? "text-amber-400" : "text-red-400")}>
                {topDomain.healthScore.score}
              </span>
              <span className="text-sm text-muted-foreground/50">/100</span>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <HealthBar label="SPF"   score={breakdown.spf   ?? 0} max={30} />
            <HealthBar label="DKIM"  score={breakdown.dkim  ?? 0} max={30} />
            <HealthBar label="DMARC" score={breakdown.dmarc ?? 0} max={25} />
            <HealthBar label="MX"    score={breakdown.mx    ?? 0} max={15} />
          </div>
        </div>
      )}

      {/* Rate metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Bounce Rate",    value: `${bounceRate}%`,    warn: bounceRate > 5,    good: bounceRate < 2,    sub: `${bounces} bounces` },
          { label: "Complaint Rate", value: `${complaintRate}%`, warn: complaintRate > 0.1, good: complaintRate === 0, sub: `${complaints} complaints` },
          { label: "Delivery Fails", value: failures,             warn: failures > 5,      good: failures === 0,    sub: "last 30 days" },
          { label: "Total Events",   value: total,                warn: false,             good: total === 0,       sub: "reputation events" },
        ].map((m) => (
          <div key={m.label} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 flex flex-col gap-1">
            <span className="text-[10px] text-muted-foreground/50 uppercase tracking-widest">{m.label}</span>
            <span className={cn("text-2xl font-bold", m.warn ? "text-red-400" : m.good ? "text-emerald-400" : "text-foreground")}>
              {m.value}
            </span>
            <span className="text-[11px] text-muted-foreground/40">{m.sub}</span>
          </div>
        ))}
      </div>

      {/* Thresholds guide */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 flex flex-col gap-2">
        <h2 className="text-xs font-medium text-muted-foreground/70 mb-1">Industry Safety Thresholds</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          {[
            { label: "Bounce rate",    good: "< 2%",  warn: "2–5%",   danger: "> 5%" },
            { label: "Complaint rate", good: "< 0.1%",warn: "0.1–0.3%",danger: "> 0.3%" },
          ].map((t) => (
            <div key={t.label} className="flex items-center gap-3">
              <span className="text-muted-foreground/50 w-28 shrink-0">{t.label}:</span>
              <span className="text-emerald-400">{t.good}</span>
              <span className="text-muted-foreground/30">·</span>
              <span className="text-amber-400">{t.warn}</span>
              <span className="text-muted-foreground/30">·</span>
              <span className="text-red-400">{t.danger}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Event log */}
      <div>
        <h2 className="text-sm font-medium text-muted-foreground mb-3">Event Log</h2>
        {loadingEvents ? (
          <div className="flex flex-col gap-2">
            {[...Array(4)].map((_, i) => <div key={i} className="h-10 animate-pulse rounded-lg bg-white/[0.03]" />)}
          </div>
        ) : events.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/[0.10] p-8 text-center flex flex-col items-center gap-2">
            <CheckCircle className="h-8 w-8 text-emerald-400/30" />
            <p className="text-sm font-medium">No reputation events recorded</p>
            <p className="text-xs text-muted-foreground/50">Events from Resend webhooks and manual checks will appear here.</p>
          </div>
        ) : (
          <div className="rounded-xl border border-white/[0.06] divide-y divide-white/[0.04] overflow-hidden">
            {events.map((ev: any) => {
              const sev = SEVERITY_STYLES[ev.severity] ?? SEVERITY_STYLES.info;
              const SevIcon = sev.icon;
              return (
                <div key={ev.id} className="flex items-center gap-3 px-4 py-2.5">
                  <SevIcon className={cn("h-3.5 w-3.5 shrink-0", sev.class.split(" ")[0])} />
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-medium">{EVENT_LABELS[ev.event_type] ?? ev.event_type}</span>
                    {ev.email_sender_domains?.domain && (
                      <span className="text-[11px] text-muted-foreground/40 ml-2">{ev.email_sender_domains.domain}</span>
                    )}
                    {ev.description && (
                      <p className="text-[11px] text-muted-foreground/40 truncate">{ev.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={cn("text-[10px] border rounded-full px-1.5 py-0.5 capitalize", sev.class)}>
                      {ev.severity}
                    </span>
                    <span className="text-[10px] text-muted-foreground/30">
                      {new Date(ev.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Webhook tip */}
      <div className="rounded-xl border border-white/[0.06] bg-blue-500/[0.03] p-4 flex items-start gap-3">
        <ShieldAlert className="h-4 w-4 text-blue-400/60 shrink-0 mt-0.5" />
        <div className="text-xs text-muted-foreground/60 leading-relaxed">
          <strong className="text-foreground/70">Connect Resend webhooks</strong> to automatically track bounces and complaints.
          Set your webhook URL in the Resend dashboard to:{" "}
          <code className="text-[10px] font-mono bg-white/[0.05] px-1.5 py-0.5 rounded">
            https://yourdomain.com/api/public/resend-webhook
          </code>
        </div>
      </div>
    </div>
  );
}
