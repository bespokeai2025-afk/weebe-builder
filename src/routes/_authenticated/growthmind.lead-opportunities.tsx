import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  Loader2, RefreshCw, Target, Phone, Mail, Clock,
  TrendingUp, AlertTriangle, CheckCircle2, Filter,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { GrowthMindShell } from "@/components/growthmind/GrowthMindShell";
import { getGrowthMindData } from "@/lib/growthmind/growthmind.functions";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";

export const Route = createFileRoute("/_authenticated/growthmind/lead-opportunities")({
  head: () => ({ meta: [{ title: "Lead Opportunities — GrowthMind" }] }),
  component: GrowthMindLeadOpportunities,
});

type OpportunityType = "stale" | "need_call" | "high_potential" | "at_risk";

type LeadOpportunity = {
  id:          string;
  name:        string;
  type:        OpportunityType;
  label:       string;
  urgency:     "critical" | "high" | "medium" | "low";
  reason:      string;
  action:      string;
  daysSince?:  number;
  phone?:      string;
  email?:      string;
};

function detectOpportunities(data: any): LeadOpportunity[] {
  if (!data) return [];
  const opps: LeadOpportunity[] = [];

  // Stale leads (haven't been updated in 14+ days but still active)
  for (const l of (data.leads?.staleDetail ?? [])) {
    opps.push({
      id:        `stale-${l.id}`,
      name:      l.name,
      type:      "stale",
      label:     "Stale Lead",
      urgency:   l.daysSinceUpdate > 30 ? "critical" : l.daysSinceUpdate > 21 ? "high" : "medium",
      reason:    `No activity for ${l.daysSinceUpdate} days — at risk of going cold`,
      action:    "Re-engage with a call or WhatsApp message",
      daysSince: l.daysSinceUpdate,
      phone:     l.phone,
      email:     l.email,
    });
  }

  return opps.sort((a, b) => {
    const order = { critical: 0, high: 1, medium: 2, low: 3 };
    return order[a.urgency] - order[b.urgency];
  });
}

const TYPE_COLORS: Record<OpportunityType, { bg: string; text: string; border: string }> = {
  stale:          { bg: "bg-amber-500/10",  text: "text-amber-400",  border: "border-amber-500/20" },
  need_call:      { bg: "bg-orange-500/10", text: "text-orange-400", border: "border-orange-500/20" },
  high_potential: { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/20" },
  at_risk:        { bg: "bg-red-500/10",    text: "text-red-400",    border: "border-red-500/20" },
};

const URGENCY_COLORS: Record<string, string> = {
  critical: "bg-red-500/15 text-red-400",
  high:     "bg-orange-500/15 text-orange-400",
  medium:   "bg-amber-500/15 text-amber-400",
  low:      "bg-slate-500/15 text-slate-400",
};

function GrowthMindLeadOpportunities() {
  const fn = useServerFn(getGrowthMindData);
  const qc = useQueryClient();
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["growthmind-data"],
    queryFn:  () => fn(),
    staleTime: 60_000,
  });

  const [urgencyFilter, setUrgencyFilter] = useState<"all" | "critical" | "high" | "medium" | "low">("all");

  const opps = detectOpportunities(data);
  const filtered = urgencyFilter === "all" ? opps : opps.filter(o => o.urgency === urgencyFilter);

  const counts = {
    critical: opps.filter(o => o.urgency === "critical").length,
    high:     opps.filter(o => o.urgency === "high").length,
    medium:   opps.filter(o => o.urgency === "medium").length,
    low:      opps.filter(o => o.urgency === "low").length,
  };

  return (
    <GrowthMindShell>
      <div className="px-6 py-5 max-w-4xl">

        {/* Header */}
        <div className="mb-6 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold flex items-center gap-2">
              <Target className="h-5 w-5 text-emerald-400" />
              Lead Opportunities
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Revenue opportunities hidden in your existing pipeline
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ["growthmind-data"] })}>
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", isFetching && "animate-spin")} />
            Refresh
          </Button>
        </div>

        {/* Summary stats */}
        {!isLoading && data && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            {[
              { label: "Total Active",   value: data.leads.active,        color: "text-foreground" },
              { label: "Need Call",      value: data.leads.needCall,      color: "text-orange-400" },
              { label: "Stale (14d+)",   value: data.leads.staleCount,    color: "text-amber-400" },
              { label: "Opportunities",  value: opps.length,              color: "text-emerald-400" },
            ].map(s => (
              <div key={s.label} className="rounded-xl border border-white/[0.06] bg-card/60 p-3 text-center">
                <p className={cn("text-2xl font-bold tabular-nums", s.color)}>{s.value}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
        )}

        {/* Urgency filter */}
        {!isLoading && (
          <div className="flex flex-wrap gap-2 mb-5">
            {(["all", "critical", "high", "medium", "low"] as const).map(u => {
              const cnt = u === "all" ? opps.length : counts[u];
              return (
                <button
                  key={u}
                  onClick={() => setUrgencyFilter(u)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-medium border transition-all capitalize",
                    u === "all"      ? "bg-white/[0.04] text-muted-foreground border-white/[0.08]" :
                    u === "critical" ? "bg-red-500/10 text-red-400 border-red-500/20" :
                    u === "high"     ? "bg-orange-500/10 text-orange-400 border-orange-500/20" :
                    u === "medium"   ? "bg-amber-500/10 text-amber-400 border-amber-500/20" :
                                       "bg-slate-500/10 text-slate-400 border-slate-500/20",
                    urgencyFilter === u && "ring-1 ring-white/20",
                  )}
                >
                  {u === "all" ? "All" : u} ({cnt})
                </button>
              );
            })}
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-24 gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-emerald-400" />
            <span className="text-sm">Scanning pipeline for opportunities…</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
            <CheckCircle2 className="h-10 w-10 text-emerald-400/60" />
            <p className="text-base font-semibold">
              {opps.length === 0 ? "No lead opportunities detected" : "No items match this filter"}
            </p>
            <p className="text-sm text-muted-foreground max-w-sm">
              {opps.length === 0
                ? "Your pipeline looks healthy. Add more leads to unlock opportunity detection."
                : "Try changing the urgency filter."}
            </p>
            {opps.length === 0 && (
              <Link to="/leads">
                <Button variant="outline" size="sm" className="mt-2">View Leads</Button>
              </Link>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(opp => {
              const tc = TYPE_COLORS[opp.type];
              return (
                <div key={opp.id} className={cn("rounded-xl border bg-card/60 p-4", tc.border)}>
                  <div className="flex items-start gap-3">
                    <div className={cn("flex h-8 w-8 items-center justify-center rounded-lg shrink-0", tc.bg)}>
                      {opp.type === "stale"
                        ? <Clock className={cn("h-4 w-4", tc.text)} />
                        : opp.type === "at_risk"
                          ? <AlertTriangle className={cn("h-4 w-4", tc.text)} />
                          : <Target className={cn("h-4 w-4", tc.text)} />
                      }
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-sm font-semibold">{opp.name}</span>
                        <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide", URGENCY_COLORS[opp.urgency])}>
                          {opp.urgency}
                        </span>
                        <span className={cn("rounded-md px-1.5 py-0.5 text-[10px]", tc.bg, tc.text)}>{opp.label}</span>
                        {opp.daysSince && (
                          <span className="text-[10px] text-muted-foreground">{opp.daysSince}d ago</span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mb-2">{opp.reason}</p>
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-[11px] text-emerald-400 font-medium">{opp.action}</p>
                        {opp.phone && (
                          <a
                            href={`tel:${opp.phone}`}
                            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <Phone className="h-3 w-3" />
                            {opp.phone}
                          </a>
                        )}
                        {opp.email && (
                          <a
                            href={`mailto:${opp.email}`}
                            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <Mail className="h-3 w-3" />
                            {opp.email}
                          </a>
                        )}
                      </div>
                    </div>

                    <Link to="/leads">
                      <Button size="sm" variant="outline" className="h-7 text-xs shrink-0">
                        View Lead
                      </Button>
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Footer note */}
        {!isLoading && data && (
          <div className="mt-6 rounded-xl border border-emerald-500/15 bg-emerald-500/[0.04] p-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
              <span className="text-emerald-400 font-medium">Tip:</span> These opportunities are detected from your live pipeline data.
              For full CRM actions — updating status, adding notes, sending messages — visit{" "}
              <Link to="/leads" className="text-emerald-400 hover:underline">Leads</Link> or{" "}
              <Link to="/pipeline" className="text-emerald-400 hover:underline">Pipeline</Link>.
            </p>
          </div>
        )}
      </div>
    </GrowthMindShell>
  );
}
