import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Wrench, RefreshCw, Loader2, Plus, ChevronDown, ChevronRight,
  CheckSquare, Square, CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SystemMindShell } from "./SystemMindShell";
import {
  listSystemMindFixPlans,
  generateSystemMindFixPlan,
  updateFixPlanStep,
} from "@/lib/systemmind/systemmind-cto.functions";

const STATUS_BADGE: Record<string, string> = {
  open:        "bg-slate-500/15 text-slate-400",
  in_progress: "bg-sky-500/15 text-sky-400",
  done:        "bg-emerald-500/15 text-emerald-400",
};

function FixPlanCard({ plan, onStepToggle }: { plan: any; onStepToggle: (planId: string, idx: number, done: boolean) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [toggling, setToggling] = useState<number | null>(null);
  const steps: any[] = plan.steps ?? [];
  const doneCount = steps.filter((s) => s.done).length;

  async function toggle(idx: number, done: boolean) {
    setToggling(idx);
    try { await onStepToggle(plan.id, idx, done); } finally { setToggling(null); }
  }

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.02] transition-colors"
      >
        <Wrench className="h-4 w-4 text-sky-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold truncate">{plan.title}</span>
            <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium capitalize", STATUS_BADGE[plan.status] ?? STATUS_BADGE.open)}>
              {plan.status.replace("_", " ")}
            </span>
          </div>
          {steps.length > 0 && (
            <div className="flex items-center gap-2 mt-1">
              <div className="flex-1 h-1 rounded-full bg-white/[0.08] overflow-hidden">
                <div
                  className="h-full bg-sky-500 rounded-full transition-all"
                  style={{ width: `${steps.length > 0 ? Math.round((doneCount / steps.length) * 100) : 0}%` }}
                />
              </div>
              <span className="text-[10px] text-muted-foreground shrink-0">{doneCount}/{steps.length}</span>
            </div>
          )}
        </div>
        {steps.length > 0 && (
          open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        )}
      </button>

      {open && (
        <div className="border-t border-white/[0.06] divide-y divide-white/[0.04]">
          {plan.detail && (
            <div className="px-4 py-2.5">
              <p className="text-xs text-muted-foreground leading-relaxed">{plan.detail}</p>
            </div>
          )}
          {steps.map((step: any) => (
            <div key={step.idx} className="px-4 py-2.5 flex items-start gap-3">
              <button
                onClick={() => toggle(step.idx, !step.done)}
                disabled={toggling === step.idx}
                className="mt-0.5 shrink-0 text-muted-foreground hover:text-sky-400 transition-colors"
              >
                {toggling === step.idx
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : step.done
                  ? <CheckSquare className="h-3.5 w-3.5 text-emerald-400" />
                  : <Square className="h-3.5 w-3.5" />
                }
              </button>
              <div className="min-w-0">
                <p className={cn("text-xs font-medium", step.done && "line-through text-muted-foreground")}>{step.title}</p>
                {step.detail && <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{step.detail}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function SystemMindFixPlansPage({ embedded = false }: { embedded?: boolean } = {}) {
  const listFn = useServerFn(listSystemMindFixPlans);
  const createFn = useServerFn(generateSystemMindFixPlan);
  const stepFn = useServerFn(updateFixPlanStep);
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [creating, setCreating] = useState(false);

  const { data: plans, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["systemmind-fix-plans"],
    queryFn: () => listFn(),
    throwOnError: false,
  });

  async function create() {
    if (!title.trim()) return;
    setCreating(true);
    try {
      await createFn({ data: { title: title.trim(), detail: detail.trim(), sourceType: "manual" } });
      setTitle(""); setDetail(""); setShowForm(false);
      qc.invalidateQueries({ queryKey: ["systemmind-fix-plans"] });
    } finally {
      setCreating(false);
    }
  }

  async function toggleStep(planId: string, stepIdx: number, done: boolean) {
    await stepFn({ data: { planId, stepIdx, done } });
    qc.invalidateQueries({ queryKey: ["systemmind-fix-plans"] });
  }

  const openPlans = (plans as any[] ?? []).filter((p) => p.status !== "done");
  const donePlans = (plans as any[] ?? []).filter((p) => p.status === "done");

  const Wrapper = embedded ? FixPlansEmbedded : SystemMindShell;
  return (
    <Wrapper>
      <div className="mx-auto max-w-4xl px-4 py-6 md:px-8">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-500/15 ring-1 ring-sky-500/25">
              <Wrench className="h-5 w-5 text-sky-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Fix Plans</h1>
              <p className="text-xs text-muted-foreground">AI-generated step-by-step repair guides for platform issues</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching}>
              <RefreshCw className={cn("h-3.5 w-3.5", isRefetching && "animate-spin")} />
            </Button>
            <Button size="sm" onClick={() => setShowForm((v) => !v)} className="bg-sky-600 hover:bg-sky-500 text-white">
              <Plus className="h-3.5 w-3.5" /> New Plan
            </Button>
          </div>
        </div>

        {showForm && (
          <div className="rounded-xl border border-sky-500/25 bg-sky-500/[0.04] p-4 mb-5 space-y-3">
            <p className="text-xs font-semibold text-sky-300">New Fix Plan</p>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Problem title (e.g. 'OpenAI API key missing')"
              className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-sky-500/50"
            />
            <textarea
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              placeholder="Describe the problem in detail so the AI can generate specific steps…"
              rows={3}
              className="w-full resize-none rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-sky-500/50"
            />
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button size="sm" onClick={create} disabled={creating || !title.trim()} className="bg-sky-600 hover:bg-sky-500 text-white">
                {creating ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Generating…</> : "Generate Plan"}
              </Button>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-24 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : !(plans as any[])?.length ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
            <Wrench className="h-10 w-10 text-muted-foreground/30" />
            <div>
              <p className="text-sm font-medium text-muted-foreground">No fix plans yet</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Create a fix plan from an issue, or click "New Plan" to describe a problem and let AI generate steps.</p>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {openPlans.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 mb-2">Active ({openPlans.length})</p>
                <div className="space-y-2">
                  {openPlans.map((plan: any) => (
                    <FixPlanCard key={plan.id} plan={plan} onStepToggle={toggleStep} />
                  ))}
                </div>
              </div>
            )}
            {donePlans.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 mb-2">Completed ({donePlans.length})</p>
                <div className="space-y-2 opacity-60">
                  {donePlans.map((plan: any) => (
                    <FixPlanCard key={plan.id} plan={plan} onStepToggle={toggleStep} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Wrapper>
  );
}

function FixPlansEmbedded({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
