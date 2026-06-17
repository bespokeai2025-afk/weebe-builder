import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  Newspaper, Loader2, RefreshCw, CheckCircle2, ChevronDown, ChevronRight,
  Calendar, Zap, ArrowRight, TrendingUp, TrendingDown, Minus,
  Clock, BarChart3, Brain, AlertTriangle, Lightbulb,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { HiveMindShell } from "@/components/hivemind/HiveMindShell";
import {
  listBriefingsFn, getBriefingFn, generateBriefingFn,
} from "@/lib/hivemind/business-dna.functions";
import { Button } from "@/components/ui/button";
import { RelativeTime } from "@/components/ui/relative-time";

export const Route = createFileRoute("/_authenticated/hivemind/briefings")({
  head: () => ({ meta: [{ title: "Executive Briefings — HiveMind" }] }),
  component: HiveMindBriefingsPage,
});

// ── Type helpers ───────────────────────────────────────────────────────────────
type BriefingType = "daily" | "weekly" | "monthly";
type BriefingRow  = { id: string; type: BriefingType; title: string; summary: string; meta: any; is_read: boolean; created_at: string };
type FullBriefing = BriefingRow & { sections: any };

const TYPE_STYLE: Record<BriefingType, { color: string; bg: string; label: string }> = {
  daily:   { color: "text-violet-400",  bg: "bg-violet-500/10 border-violet-500/20",  label: "Daily"   },
  weekly:  { color: "text-blue-400",    bg: "bg-blue-500/10 border-blue-500/20",      label: "Weekly"  },
  monthly: { color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20",label: "Monthly" },
};

// ── Section card ───────────────────────────────────────────────────────────────
function SectionCard({
  title, icon: Icon, color, content,
}: {
  title: string; icon: React.ElementType; color: string; content: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] overflow-hidden">
      <button
        className="w-full flex items-center gap-2.5 px-4 py-3 hover:bg-white/[0.02]"
        onClick={() => setOpen(o => !o)}
      >
        <Icon className={cn("h-3.5 w-3.5 shrink-0", color)} />
        <p className="text-xs font-semibold flex-1 text-left">{title}</p>
        {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
      </button>
      {open && <div className="px-4 pb-4">{content}</div>}
    </div>
  );
}

function TextBlock({ text }: { text: string }) {
  return <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">{text || "—"}</p>;
}

function ActionsList({ items }: { items: string[] }) {
  if (!items?.length) return <p className="text-sm text-muted-foreground">No actions recommended.</p>;
  return (
    <ul className="space-y-1.5">
      {items.map((a: string, i: number) => (
        <li key={i} className="flex items-start gap-2 text-sm">
          <ArrowRight className="h-3.5 w-3.5 text-violet-400 shrink-0 mt-0.5" />
          <span className="text-foreground/80">{a}</span>
        </li>
      ))}
    </ul>
  );
}

function CampaignsList({ items }: { items: Array<{ title: string; rationale: string; channel: string; urgency: string }> }) {
  if (!items?.length) return <p className="text-sm text-muted-foreground">No campaigns recommended.</p>;
  const urgencyColor: Record<string, string> = {
    high: "text-red-400 bg-red-500/10 border-red-500/20",
    medium: "text-amber-400 bg-amber-500/10 border-amber-500/20",
    low: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  };
  return (
    <div className="space-y-2">
      {items.map((c: any, i: number) => (
        <div key={i} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-xs font-semibold flex-1">{c.title}</p>
            <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded border", urgencyColor[c.urgency] ?? "text-muted-foreground")}>
              {c.urgency}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground">{c.rationale}</p>
          <p className="text-[10px] text-muted-foreground/50 mt-1">Channel: {c.channel}</p>
        </div>
      ))}
    </div>
  );
}

function MetricsRow({ metrics }: { metrics: Record<string, number> }) {
  if (!metrics) return null;
  const items = [
    { label: "New Leads",      val: metrics.new_leads ?? 0 },
    { label: "Calls Made",     val: metrics.calls_made ?? 0 },
    { label: "Success Rate",   val: `${metrics.success_rate_pct ?? 0}%` },
    { label: "Conversion",     val: `${metrics.conversion_rate_pct ?? 0}%` },
    { label: "Pipeline Total", val: metrics.pipeline_total ?? 0 },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-1">
      {items.map(({ label, val }) => (
        <div key={label} className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-2.5 text-center">
          <p className="text-base font-bold">{val}</p>
          <p className="text-[9px] text-muted-foreground mt-0.5 uppercase tracking-wide">{label}</p>
        </div>
      ))}
    </div>
  );
}

// ── Full briefing detail view ──────────────────────────────────────────────────
function BriefingDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const getFn = useServerFn(getBriefingFn);
  const { data, isLoading } = useQuery({
    queryKey: ["briefing", id],
    queryFn:  () => getFn({ data: { id } }),
    staleTime: 600_000,
  });
  const briefing: FullBriefing | undefined = data?.briefing;
  const secs = briefing?.sections ?? {};
  const ts   = briefing ? TYPE_STYLE[briefing.type] : TYPE_STYLE.daily;

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!briefing) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-[11px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
          <ChevronRight className="h-3 w-3 rotate-180" /> All briefings
        </button>
        <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded border", ts.bg, ts.color)}>
          {ts.label}
        </span>
        <span className="text-[11px] text-muted-foreground"><RelativeTime date={briefing.created_at} /></span>
      </div>

      <h2 className="text-lg font-bold leading-tight">{briefing.title}</h2>
      <p className="text-sm text-muted-foreground leading-relaxed">{briefing.summary}</p>

      <div className="space-y-3">
        {secs.key_metrics && (
          <SectionCard title="Key Metrics" icon={BarChart3} color="text-violet-400">
            <MetricsRow metrics={secs.key_metrics} />
          </SectionCard>
        )}
        {secs.executive_summary && (
          <SectionCard title="Executive Summary" icon={Brain} color="text-blue-400">
            <TextBlock text={secs.executive_summary} />
          </SectionCard>
        )}
        {secs.what_happened && (
          <SectionCard title="What Happened" icon={Calendar} color="text-slate-400">
            <TextBlock text={secs.what_happened} />
          </SectionCard>
        )}
        {secs.what_changed && (
          <SectionCard title="What Changed" icon={TrendingUp} color="text-amber-400">
            <TextBlock text={secs.what_changed} />
          </SectionCard>
        )}
        {secs.what_worked && (
          <SectionCard title="What Worked" icon={CheckCircle2} color="text-emerald-400">
            <TextBlock text={secs.what_worked} />
          </SectionCard>
        )}
        {secs.what_failed && (
          <SectionCard title="What Failed" icon={AlertTriangle} color="text-red-400">
            <TextBlock text={secs.what_failed} />
          </SectionCard>
        )}
        {secs.next_actions && (
          <SectionCard title="Next Actions" icon={Zap} color="text-violet-400">
            <ActionsList items={secs.next_actions} />
          </SectionCard>
        )}
        {secs.recommended_campaigns && (
          <SectionCard title="Recommended Campaigns" icon={Lightbulb} color="text-amber-400">
            <CampaignsList items={secs.recommended_campaigns} />
          </SectionCard>
        )}
      </div>
    </div>
  );
}

// ── Briefing list card ─────────────────────────────────────────────────────────
function BriefingCard({ briefing, onSelect }: { briefing: BriefingRow; onSelect: () => void }) {
  const ts = TYPE_STYLE[briefing.type] ?? TYPE_STYLE.daily;
  return (
    <button
      onClick={onSelect}
      className={cn(
        "w-full text-left rounded-xl border p-4 transition-all hover:bg-white/[0.03] group",
        briefing.is_read ? "border-white/[0.07] bg-white/[0.01]" : "border-violet-500/20 bg-violet-500/[0.04]",
      )}
    >
      <div className="flex items-center gap-2.5 mb-2">
        {!briefing.is_read && (
          <span className="h-1.5 w-1.5 rounded-full bg-violet-400 shrink-0 animate-pulse" />
        )}
        <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded border shrink-0", ts.bg, ts.color)}>
          {ts.label}
        </span>
        <span className="text-[10px] text-muted-foreground/60 flex items-center gap-1">
          <Clock className="h-2.5 w-2.5" />
          <RelativeTime date={briefing.created_at} />
        </span>
        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-muted-foreground ml-auto transition-colors" />
      </div>
      <p className="text-sm font-semibold text-foreground leading-tight mb-1.5 line-clamp-2">{briefing.title}</p>
      <p className="text-xs text-muted-foreground/70 leading-relaxed line-clamp-2">{briefing.summary}</p>
    </button>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
function HiveMindBriefingsPage() {
  const qc               = useQueryClient();
  const [filter, setFilter] = useState<"all" | BriefingType>("all");
  const [selected, setSelected] = useState<string | null>(null);

  const listFn     = useServerFn(listBriefingsFn);
  const generateFn = useServerFn(generateBriefingFn);

  const { data, isLoading } = useQuery({
    queryKey: ["briefings", filter],
    queryFn:  () => listFn({ data: { type: filter } }),
    staleTime: 30_000,
  });
  const briefings: BriefingRow[] = data?.briefings ?? [];

  const genMut = useMutation({
    mutationFn: (type: BriefingType) => generateFn({ data: { type } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["briefings"] });
      setFilter("all");
    },
  });

  const unread = briefings.filter(b => !b.is_read).length;

  return (
    <HiveMindShell>
      <div className="p-5 md:p-7 max-w-3xl mx-auto space-y-5">
        {selected ? (
          <BriefingDetail id={selected} onBack={() => setSelected(null)} />
        ) : (
          <>
            {/* Header */}
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-500/15 ring-1 ring-violet-500/25">
                  <Newspaper className="h-4.5 w-4.5 text-violet-400" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h1 className="text-lg font-bold">Executive Briefings</h1>
                    {unread > 0 && (
                      <span className="rounded-full bg-violet-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-violet-400">
                        {unread} new
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Daily, weekly, and monthly AI-generated business briefings
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                {(["daily", "weekly", "monthly"] as BriefingType[]).map(t => (
                  <Button
                    key={t}
                    size="sm"
                    variant="outline"
                    onClick={() => genMut.mutate(t)}
                    disabled={genMut.isPending}
                    className="h-7 text-[11px] px-2.5 gap-1 border-white/[0.08] hover:bg-white/[0.05]"
                  >
                    {genMut.isPending && genMut.variables === t
                      ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
                      : <RefreshCw className="h-2.5 w-2.5" />}
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </Button>
                ))}
              </div>
            </div>

            {/* Filter tabs */}
            <div className="flex gap-1 border border-white/[0.07] rounded-xl p-1 w-fit bg-white/[0.02]">
              {(["all", "daily", "weekly", "monthly"] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-[11px] font-medium capitalize transition-all",
                    filter === f
                      ? "bg-violet-500/20 text-violet-300"
                      : "text-muted-foreground hover:text-foreground hover:bg-white/[0.04]",
                  )}
                >
                  {f}
                </button>
              ))}
            </div>

            {/* Generation in progress */}
            {genMut.isPending && (
              <div className="flex items-center gap-3 rounded-xl border border-violet-500/20 bg-violet-500/10 px-4 py-3">
                <Loader2 className="h-4 w-4 text-violet-400 animate-spin shrink-0" />
                <p className="text-sm text-violet-300">
                  Generating {genMut.variables} briefing — analysing your platform data…
                </p>
              </div>
            )}

            {/* List */}
            {isLoading ? (
              <div className="flex h-48 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : briefings.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] py-16 text-center">
                <Newspaper className="h-9 w-9 text-muted-foreground/30" />
                <div>
                  <p className="text-sm font-medium">No briefings yet</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Click "Daily", "Weekly", or "Monthly" above to generate your first briefing
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {briefings.map(b => (
                  <BriefingCard
                    key={b.id}
                    briefing={b}
                    onSelect={() => setSelected(b.id)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </HiveMindShell>
  );
}
