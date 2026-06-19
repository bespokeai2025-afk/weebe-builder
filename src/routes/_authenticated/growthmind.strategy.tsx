import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  Target, Loader2, RefreshCw, Send, Trash2, ChevronDown, ChevronUp,
  CalendarDays, Users, Megaphone, BarChart3, CheckCircle2, ListTodo,
} from "lucide-react";
import { GrowthMindShell } from "@/components/growthmind/GrowthMindShell";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  getStrategies, generateStrategy, deleteStrategy, sendStrategyToHiveMind,
  type Strategy, type StrategyPeriod,
} from "@/lib/growthmind/growthmind.strategies";

export const Route = createFileRoute("/_authenticated/growthmind/strategy")({
  head: () => ({ meta: [{ title: "Strategy — GrowthMind" }] }),
  component: StrategyPage,
});

const PERIODS: { id: StrategyPeriod; label: string; days: string }[] = [
  { id: "30_day", label: "30-Day Plan",  days: "4 weeks"  },
  { id: "60_day", label: "60-Day Plan",  days: "8 weeks"  },
  { id: "90_day", label: "90-Day Plan",  days: "12 weeks" },
];

function StrategySection({ title, icon: Icon, content }: { title: string; icon: React.ElementType; content: string }) {
  const [open, setOpen] = useState(true);
  if (!content?.trim()) return null;
  return (
    <div className="border-b border-white/[0.04] last:border-0">
      <button
        type="button" onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between py-3 text-left"
      >
        <span className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-[0.08em]">
          <Icon className="h-3.5 w-3.5" />{title}
        </span>
        {open ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
      </button>
      {open && <p className="text-sm text-muted-foreground pb-3 leading-relaxed whitespace-pre-wrap">{content}</p>}
    </div>
  );
}

function StrategyCard({ strategy, onDelete, onSend }: {
  strategy: Strategy;
  onDelete: () => void;
  onSend: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [sending,  setSending]  = useState(false);
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="rounded-xl border border-white/[0.06] bg-card/60 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-white/[0.04] flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{strategy.primaryAngle || "Strategy"}</p>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{strategy.targetAudience}</p>
          <div className="flex items-center gap-2 mt-2">
            <span className="text-[10px] bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded-full font-medium">
              {Math.round(strategy.confidenceScore * 100)}% confidence
            </span>
            {strategy.channels.slice(0, 3).map(ch => (
              <span key={ch} className="text-[10px] bg-white/[0.04] text-muted-foreground px-1.5 py-0.5 rounded">{ch}</span>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Button
            variant="ghost" size="sm"
            onClick={() => {
              setSending(true);
              onSend();
              setTimeout(() => setSending(false), 2000);
            }}
            disabled={sending || strategy.status === "sent_for_approval"}
            className="text-xs gap-1.5 text-emerald-400 hover:text-emerald-300"
          >
            {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            {strategy.status === "sent_for_approval" ? "Sent" : "Send to HiveMind"}
          </Button>
          <button
            type="button" onClick={() => setExpanded(o => !o)}
            className="p-1.5 text-muted-foreground hover:text-foreground rounded"
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={async () => { setDeleting(true); try { onDelete(); } finally { setDeleting(false); } }}
            disabled={deleting}
            className="p-1.5 text-muted-foreground hover:text-red-400 rounded"
          >
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="px-5 py-2">
          <StrategySection title="Primary Angle" icon={Target} content={strategy.primaryAngle} />
          <StrategySection title="Core Offer" icon={Megaphone} content={strategy.coreOffer} />
          <StrategySection title="Content Plan" icon={CalendarDays} content={strategy.contentPlan} />
          <StrategySection title="SEO Plan" icon={BarChart3} content={strategy.seoPlan} />
          <StrategySection title="Paid Ads Plan" icon={BarChart3} content={strategy.paidAdsPlan} />
          <StrategySection title="WhatsApp Plan" icon={Megaphone} content={strategy.whatsappPlan} />
          <StrategySection title="Email Plan" icon={Megaphone} content={strategy.emailPlan} />
          <StrategySection title="AI Calling Plan" icon={Megaphone} content={strategy.aiCallingPlan} />
          <StrategySection title="Follow-Up Plan" icon={Users} content={strategy.followUpPlan} />
          <StrategySection title="Expected Outcomes" icon={CheckCircle2} content={strategy.expectedOutcomes} />
          <StrategySection title="Evidence" icon={Target} content={strategy.evidence} />

          {/* KPIs */}
          {strategy.kpis.length > 0 && (
            <div className="border-b border-white/[0.04] last:border-0 pb-3">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground mb-2 pt-3 flex items-center gap-2">
                <BarChart3 className="h-3.5 w-3.5" /> KPIs
              </p>
              <div className="grid grid-cols-2 gap-2">
                {strategy.kpis.map((kpi, i) => (
                  <div key={i} className="rounded-lg bg-white/[0.03] px-3 py-2">
                    <p className="text-xs font-medium">{kpi.metric}</p>
                    <p className="text-[11px] text-emerald-400">{kpi.target}</p>
                    <p className="text-[10px] text-muted-foreground">{kpi.period}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tasks */}
          {strategy.tasks.length > 0 && (
            <div className="pb-3">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground mb-2 pt-3 flex items-center gap-2">
                <ListTodo className="h-3.5 w-3.5" /> Weekly Tasks
              </p>
              <div className="space-y-1.5">
                {strategy.tasks.map((task, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    <span className="text-[10px] bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded font-medium shrink-0">
                      Wk {task.week}
                    </span>
                    <span className="text-muted-foreground flex-1">{task.task}</span>
                    <span className="text-[10px] bg-white/[0.04] text-muted-foreground px-1.5 py-0.5 rounded shrink-0">
                      {task.channel}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Campaigns */}
          {strategy.campaigns.length > 0 && (
            <div className="border-t border-white/[0.04] pb-3">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground mb-2 pt-3 flex items-center gap-2">
                <Megaphone className="h-3.5 w-3.5" /> Recommended Campaigns
              </p>
              <div className="space-y-2">
                {strategy.campaigns.map((c, i) => (
                  <div key={i} className="rounded-lg bg-white/[0.03] px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-medium">{c.name}</p>
                      <span className="text-[10px] bg-white/[0.04] text-muted-foreground px-1.5 py-0.5 rounded">{c.timeline}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{c.goal}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StrategyPage() {
  const getStrategiesFn  = useServerFn(getStrategies);
  const generateFn       = useServerFn(generateStrategy);
  const deleteFn         = useServerFn(deleteStrategy);
  const sendFn           = useServerFn(sendStrategyToHiveMind);
  const qc               = useQueryClient();
  const [activeTab, setActiveTab]       = useState<StrategyPeriod>("30_day");
  const [generating, setGenerating]     = useState<Record<string, boolean>>({});

  const { data, isLoading } = useQuery({
    queryKey: ["growthmind-strategies"],
    queryFn:  () => getStrategiesFn(),
    staleTime: 60_000,
    throwOnError: false,
  });

  const strategies   = data?.strategies ?? [];
  const current      = strategies.find(s => s.planPeriod === activeTab) ?? null;

  async function handleGenerate(period: StrategyPeriod) {
    setGenerating(prev => ({ ...prev, [period]: true }));
    try {
      await generateFn({ data: { period } });
      await qc.invalidateQueries({ queryKey: ["growthmind-strategies"] });
      toast.success("Strategy generated");
    } catch (err: any) {
      toast.error(err.message ?? "Generation failed");
    } finally {
      setGenerating(prev => ({ ...prev, [period]: false }));
    }
  }

  async function handleDelete(period: StrategyPeriod) {
    try {
      await deleteFn({ data: { period } });
      await qc.invalidateQueries({ queryKey: ["growthmind-strategies"] });
      toast.success("Strategy deleted");
    } catch (err: any) {
      toast.error(err.message ?? "Delete failed");
    }
  }

  async function handleSend(strategyId: string) {
    try {
      const { actionId } = await sendFn({ data: { strategyId } });
      await qc.invalidateQueries({ queryKey: ["growthmind-strategies"] });
      toast.success("Sent to HiveMind for approval");
    } catch (err: any) {
      toast.error(err.message ?? "Failed to send");
    }
  }

  return (
    <GrowthMindShell>
      <div className="px-6 py-5 max-w-3xl space-y-5">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/15 ring-1 ring-emerald-500/25">
              <Target className="h-4 w-4 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-base font-semibold">Strategy Builder</h1>
              <p className="text-xs text-muted-foreground">AI-generated growth strategies grounded in your Business DNA</p>
            </div>
          </div>
        </div>

        {/* Period tabs */}
        <div className="flex items-center gap-1 bg-white/[0.03] rounded-lg p-1 w-fit">
          {PERIODS.map(p => (
            <button
              key={p.id} type="button"
              onClick={() => setActiveTab(p.id)}
              className={cn(
                "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                activeTab === p.id
                  ? "bg-emerald-500/20 text-emerald-300"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {p.label}
              {strategies.find(s => s.planPeriod === p.id) && (
                <span className="ml-1.5 h-1.5 w-1.5 inline-block rounded-full bg-emerald-400 align-middle" />
              )}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : current ? (
          <>
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Generated {new Date(current.lastCalculatedAt).toLocaleDateString()} · {PERIODS.find(p => p.id === activeTab)?.days}
              </p>
              <Button
                variant="ghost" size="sm"
                onClick={() => handleGenerate(activeTab)}
                disabled={generating[activeTab]}
                className="text-xs gap-1.5"
              >
                {generating[activeTab] ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Regenerate
              </Button>
            </div>
            <StrategyCard
              strategy={current}
              onDelete={() => handleDelete(activeTab)}
              onSend={() => handleSend(current.id)}
            />
          </>
        ) : (
          <div className="rounded-xl border border-dashed border-white/[0.12] bg-card/40 flex flex-col items-center justify-center py-16 gap-4">
            <Target className="h-10 w-10 text-muted-foreground/30" />
            <div className="text-center">
              <p className="text-sm font-medium">No {PERIODS.find(p => p.id === activeTab)?.label} yet</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                Generate a tailored strategy grounded in your Business DNA, current value point, and live performance data.
              </p>
            </div>
            <Button
              onClick={() => handleGenerate(activeTab)}
              disabled={generating[activeTab]}
              className="gap-2 bg-emerald-600 hover:bg-emerald-500"
            >
              {generating[activeTab] ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Generate {PERIODS.find(p => p.id === activeTab)?.label}
            </Button>
          </div>
        )}
      </div>
    </GrowthMindShell>
  );
}
