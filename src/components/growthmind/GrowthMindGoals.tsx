import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Target, Plus, Trash2, Loader2, RefreshCw, AlertTriangle,
  CheckCircle2, TrendingUp, Clock, Sparkles, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { GrowthMindShell } from "./GrowthMindShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getGoalsWithProgress,
  createGoal,
  deleteGoal,
  goalCommentary,
  GOAL_METRICS,
  type GoalMetric,
  type GoalWithProgress,
} from "@/lib/growthmind/growthmind.goals";

// ── Migration notice ────────────────────────────────────────────────────────────

const MIGRATION_SQL = `-- Run this in your Supabase SQL Editor to enable Goals
create table if not exists growthmind_goals (
  id           uuid        primary key default gen_random_uuid(),
  workspace_id uuid        not null references workspaces(id) on delete cascade,
  metric       text        not null check (metric in ('leads','bookings','sales','call_success_rate','calls_made')),
  label        text        not null,
  target       numeric     not null check (target > 0),
  deadline     date        not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists gm_goals_workspace_idx
  on growthmind_goals (workspace_id, created_at desc);

alter table growthmind_goals enable row level security;

create policy "gm_goals_select" on growthmind_goals for select
  using (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));
create policy "gm_goals_insert" on growthmind_goals for insert
  with check (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));
create policy "gm_goals_update" on growthmind_goals for update
  using (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));
create policy "gm_goals_delete" on growthmind_goals for delete
  using (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));`;

function MigrationBanner({ sql }: { sql: string }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(sql);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-5">
      <div className="flex items-start gap-3 mb-3">
        <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-amber-300">One-time database setup required</p>
          <p className="text-xs text-muted-foreground mt-1">
            Copy the SQL below and run it in your{" "}
            <strong className="text-foreground">Supabase SQL Editor</strong> to create the Goals table, then refresh.
          </p>
        </div>
      </div>
      <pre className="rounded-lg bg-black/40 border border-white/[0.06] p-3 text-[10px] text-emerald-300 font-mono overflow-x-auto whitespace-pre-wrap leading-relaxed">
        {sql}
      </pre>
      <Button size="sm" variant="outline" className="mt-3" onClick={copy}>
        {copied ? <CheckCircle2 className="mr-1.5 h-3.5 w-3.5 text-emerald-400" /> : <Target className="mr-1.5 h-3.5 w-3.5" />}
        {copied ? "Copied!" : "Copy SQL"}
      </Button>
    </div>
  );
}

// ── Progress bar ────────────────────────────────────────────────────────────────

function ProgressBar({ pct, atRisk, achieved }: { pct: number; atRisk: boolean; achieved: boolean }) {
  const color = achieved
    ? "bg-emerald-500"
    : atRisk
      ? "bg-amber-500"
      : "bg-emerald-500";

  return (
    <div className="relative h-2 w-full rounded-full bg-white/[0.06] overflow-hidden">
      <div
        className={cn("h-full rounded-full transition-all duration-700", color)}
        style={{ width: `${Math.min(100, pct)}%` }}
      />
    </div>
  );
}

// ── Goal card ───────────────────────────────────────────────────────────────────

function GoalCard({
  goal,
  onDelete,
  deleting,
}: {
  goal:     GoalWithProgress;
  onDelete: (id: string) => void;
  deleting: boolean;
}) {
  const metricInfo   = GOAL_METRICS.find(m => m.key === goal.metric);
  const unit         = metricInfo?.unit ?? "";
  const commentary   = goalCommentary(goal);
  const deadlineDate = new Date(goal.deadline).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });
  const daysLeft = Math.round(
    (new Date(goal.deadline).getTime() - Date.now()) / 86_400_000
  );
  const isExpired = daysLeft < 0;

  return (
    <div
      className={cn(
        "rounded-xl border bg-card/60 p-4 transition-all",
        goal.achieved
          ? "border-emerald-500/25 bg-emerald-500/[0.04]"
          : goal.atRisk
            ? "border-amber-500/25 bg-amber-500/[0.04]"
            : "border-white/[0.06]",
      )}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          {goal.achieved ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
          ) : goal.atRisk ? (
            <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
          ) : (
            <Target className="h-4 w-4 text-emerald-400 shrink-0" />
          )}
          <p className="text-sm font-semibold truncate">{goal.label}</p>
          {goal.achieved && (
            <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
              Achieved ✓
            </span>
          )}
          {goal.atRisk && !goal.achieved && (
            <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
              At Risk
            </span>
          )}
        </div>
        <button
          onClick={() => onDelete(goal.id)}
          disabled={deleting}
          className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40"
          title="Delete goal"
        >
          {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
        </button>
      </div>

      {/* Progress */}
      <div className="mb-3">
        <div className="flex items-end justify-between mb-1.5">
          <span className="text-2xl font-bold tabular-nums">
            {goal.metric === "call_success_rate" ? `${goal.current}%` : goal.current.toLocaleString()}
          </span>
          <span className="text-xs text-muted-foreground">
            of {goal.metric === "call_success_rate" ? `${goal.target}%` : `${goal.target.toLocaleString()} ${unit}`}
          </span>
        </div>
        <ProgressBar pct={goal.pct} atRisk={goal.atRisk} achieved={goal.achieved} />
        <div className="flex items-center justify-between mt-1.5">
          <span className="text-[11px] font-semibold text-muted-foreground">
            {goal.pct}% complete
          </span>
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Clock className="h-3 w-3" />
            {isExpired
              ? "Deadline passed"
              : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left · ${deadlineDate}`}
          </span>
        </div>
      </div>

      {/* AI commentary */}
      <div className="flex items-start gap-2 rounded-lg bg-white/[0.03] border border-white/[0.05] px-3 py-2.5">
        <Sparkles className="h-3 w-3 text-emerald-400 shrink-0 mt-0.5" />
        <p className="text-[11px] text-muted-foreground leading-relaxed">{commentary}</p>
      </div>

      {/* Metric tag */}
      <div className="mt-2.5">
        <span className="rounded-full bg-white/[0.04] border border-white/[0.06] px-2 py-0.5 text-[10px] text-muted-foreground">
          {metricInfo?.label ?? goal.metric} · last 30 days
        </span>
      </div>
    </div>
  );
}

// ── Create goal form ────────────────────────────────────────────────────────────

function CreateGoalForm({
  onCreated,
  onCancel,
}: {
  onCreated: () => void;
  onCancel:  () => void;
}) {
  const [metric,   setMetric]   = useState<GoalMetric>("leads");
  const [label,    setLabel]    = useState("");
  const [target,   setTarget]   = useState("");
  const [deadline, setDeadline] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().split("T")[0];
  });
  const [saving,   setSaving]   = useState(false);
  const [err,      setErr]      = useState<string | null>(null);

  const createFn = useServerFn(createGoal);

  const selectedMeta = GOAL_METRICS.find(m => m.key === metric)!;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const t = parseFloat(target);
    if (!t || t <= 0) { setErr("Target must be a positive number"); return; }
    const dl = new Date(deadline);
    if (isNaN(dl.getTime()) || dl <= new Date()) { setErr("Deadline must be in the future"); return; }

    setSaving(true);
    try {
      await createFn({ data: {
        metric,
        label: label.trim() || selectedMeta.label,
        target: t,
        deadline,
      } });
      onCreated();
    } catch (e: any) {
      setErr(e.message ?? "Failed to create goal");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-5">
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm font-semibold flex items-center gap-2">
          <Plus className="h-4 w-4 text-emerald-400" />
          New Goal
        </p>
        <button onClick={onCancel} className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-white/[0.05] transition-colors">
          <X className="h-4 w-4" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Metric picker */}
        <div className="space-y-1.5">
          <Label className="text-xs">Metric to track</Label>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {GOAL_METRICS.map(m => (
              <button
                key={m.key}
                type="button"
                onClick={() => {
                  setMetric(m.key);
                  setLabel("");
                }}
                className={cn(
                  "rounded-lg border px-3 py-2.5 text-left text-xs transition-all",
                  metric === m.key
                    ? "border-emerald-500/40 bg-emerald-500/10 text-foreground"
                    : "border-white/[0.06] bg-white/[0.02] text-muted-foreground hover:text-foreground hover:bg-white/[0.04]",
                )}
              >
                <p className="font-semibold">{m.label}</p>
                <p className="text-[10px] mt-0.5 opacity-70">{m.description}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Custom label */}
          <div className="space-y-1.5">
            <Label className="text-xs">Goal name (optional)</Label>
            <Input
              placeholder={selectedMeta.label}
              value={label}
              onChange={e => setLabel(e.target.value)}
              className="h-8 text-xs"
              maxLength={120}
            />
          </div>

          {/* Target */}
          <div className="space-y-1.5">
            <Label className="text-xs">
              Target ({selectedMeta.unit})
            </Label>
            <Input
              type="number"
              min={1}
              step={metric === "call_success_rate" ? 1 : 1}
              max={metric === "call_success_rate" ? 100 : undefined}
              placeholder={metric === "call_success_rate" ? "e.g. 70" : "e.g. 100"}
              value={target}
              onChange={e => setTarget(e.target.value)}
              className="h-8 text-xs"
              required
            />
          </div>

          {/* Deadline */}
          <div className="space-y-1.5">
            <Label className="text-xs">Deadline</Label>
            <Input
              type="date"
              value={deadline}
              onChange={e => setDeadline(e.target.value)}
              className="h-8 text-xs"
              required
            />
          </div>
        </div>

        {err && (
          <p className="text-xs text-red-400 flex items-center gap-1.5">
            <AlertTriangle className="h-3 w-3" />
            {err}
          </p>
        )}

        <div className="flex items-center gap-2 pt-1">
          <Button type="submit" size="sm" disabled={saving}>
            {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Save Goal
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}

// ── Summary strip ───────────────────────────────────────────────────────────────

function SummaryStrip({ goals }: { goals: GoalWithProgress[] }) {
  const total    = goals.length;
  const achieved = goals.filter(g => g.achieved).length;
  const atRisk   = goals.filter(g => g.atRisk).length;
  const onTrack  = total - achieved - atRisk;

  return (
    <div className="grid grid-cols-3 gap-3 mb-6">
      {[
        { label: "On Track",  value: onTrack,  icon: TrendingUp,    color: "text-emerald-400", bg: "bg-emerald-500/10" },
        { label: "At Risk",   value: atRisk,   icon: AlertTriangle, color: "text-amber-400",   bg: "bg-amber-500/10" },
        { label: "Achieved",  value: achieved, icon: CheckCircle2,  color: "text-emerald-400", bg: "bg-emerald-500/10" },
      ].map(({ label, value, icon: Icon, color, bg }) => (
        <div key={label} className="rounded-xl border border-white/[0.06] bg-card/60 px-4 py-3 flex items-center gap-3">
          <div className={cn("flex h-8 w-8 items-center justify-center rounded-lg shrink-0", bg)}>
            <Icon className={cn("h-4 w-4", color)} />
          </div>
          <div>
            <p className="text-xl font-bold tabular-nums">{value}</p>
            <p className="text-[11px] text-muted-foreground">{label}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────────

export function GrowthMindGoals() {
  const [showForm,  setShowForm]  = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const qc          = useQueryClient();
  const getGoalsFn  = useServerFn(getGoalsWithProgress);
  const deleteGoalFn = useServerFn(deleteGoal);

  const { data, isLoading, error } = useQuery({
    queryKey:  ["growthmind-goals"],
    queryFn:   () => getGoalsFn(),
    staleTime: 60_000,
    throwOnError: false,
  });

  const goals         = (data?.goals ?? []) as GoalWithProgress[];
  const tableExists   = data?.tableExists !== false;
  const needsMigration = !tableExists;

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await deleteGoalFn({ data: { id } });
      qc.invalidateQueries({ queryKey: ["growthmind-goals"] });
    } catch (e: any) {
      console.error("Delete goal error:", e);
    } finally {
      setDeletingId(null);
    }
  }

  function handleCreated() {
    setShowForm(false);
    qc.invalidateQueries({ queryKey: ["growthmind-goals"] });
  }

  return (
    <GrowthMindShell>
      <div className="px-6 py-5 max-w-5xl">

        {/* Header */}
        <div className="mb-6 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-lg font-semibold flex items-center gap-2">
              <Target className="h-5 w-5 text-emerald-400" />
              Goals &amp; Tracking
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Set marketing targets and track progress in real time · last 30 days
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline" size="sm"
              onClick={() => qc.invalidateQueries({ queryKey: ["growthmind-goals"] })}
            >
              <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", isLoading && "animate-spin")} />
              Refresh
            </Button>
            {!needsMigration && (
              <Button size="sm" onClick={() => setShowForm(v => !v)}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                New Goal
              </Button>
            )}
          </div>
        </div>

        {/* Migration banner */}
        {needsMigration && !isLoading && (
          <MigrationBanner sql={MIGRATION_SQL} />
        )}

        {/* Create form */}
        {showForm && !needsMigration && (
          <div className="mb-5">
            <CreateGoalForm onCreated={handleCreated} onCancel={() => setShowForm(false)} />
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <div className="flex items-center justify-center py-24 gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-emerald-400" />
            <span className="text-sm">Loading goals…</span>
          </div>
        )}

        {/* Error */}
        {error && !isLoading && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/[0.06] p-4 text-sm text-red-400">
            Failed to load goals: {String(error)}
          </div>
        )}

        {/* Goals list */}
        {!isLoading && !error && !needsMigration && goals.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10 ring-1 ring-emerald-500/20">
              <Target className="h-6 w-6 text-emerald-400" />
            </div>
            <p className="text-sm font-semibold">No goals yet</p>
            <p className="text-xs text-muted-foreground max-w-xs">
              Set your first marketing goal — a target metric, a number to hit, and a deadline.
              GrowthMind will monitor your progress and flag anything at risk.
            </p>
            <Button size="sm" className="mt-1" onClick={() => setShowForm(true)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Create your first goal
            </Button>
          </div>
        )}

        {!isLoading && !error && goals.length > 0 && (
          <>
            <SummaryStrip goals={goals} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {goals.map(goal => (
                <GoalCard
                  key={goal.id}
                  goal={goal}
                  onDelete={handleDelete}
                  deleting={deletingId === goal.id}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </GrowthMindShell>
  );
}
