import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Flame, Plus, Pause, Play, X, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getSenderDomains, getMailboxes, getWarmupPlans, createWarmupPlan,
  updateWarmupPlan, getWarmupProgress,
} from "@/lib/hexmail/deliverability.server";

const STATUS_COLORS: Record<string, string> = {
  active:    "text-emerald-400 border-emerald-500/20",
  paused:    "text-amber-400 border-amber-500/20",
  completed: "text-muted-foreground/50 border-white/10",
  cancelled: "text-red-400/60 border-red-500/20",
};

function PlanCard({ plan, onStatusChange }: { plan: any; onStatusChange: (planId: string, status: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const getProgressFn = useServerFn(getWarmupProgress);
  const { data: days = [], refetch } = useQuery({
    queryKey:  ["warmup-progress", plan.id],
    queryFn:   () => getProgressFn({ data: { planId: plan.id } }),
    enabled:   expanded,
    throwOnError: false,
  });

  const mailboxEmail = plan.email_mailboxes?.email_address ?? "—";
  const domain       = plan.email_sender_domains?.domain ?? "—";
  const completedDays = days.filter((d: any) => d.status === "completed").length;
  const progressPct  = days.length > 0 ? Math.round((completedDays / days.length) * 100) : 0;
  const todayTarget  = days[plan.current_day]?.target_send_count ?? plan.starting_daily_volume;

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
      <div className="flex items-center gap-4 px-4 py-3">
        <Flame className="h-4 w-4 text-amber-400/60 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{plan.name}</span>
            <span className={cn("text-[10px] border rounded-full px-2 py-0.5 capitalize", STATUS_COLORS[plan.status] ?? STATUS_COLORS.active)}>
              {plan.status}
            </span>
          </div>
          <div className="text-[11px] text-muted-foreground/40 truncate">{mailboxEmail} · {domain}</div>
        </div>
        <div className="hidden sm:flex flex-col items-end gap-0.5 text-right">
          <span className="text-xs font-medium tabular-nums">{todayTarget} <span className="text-muted-foreground/40 text-[10px]">today's target</span></span>
          <span className="text-[10px] text-muted-foreground/40">Day {plan.current_day}/{days.length || "?"} · target {plan.target_daily_volume}/day</span>
        </div>
        <div className="flex items-center gap-1">
          {plan.status === "active" && (
            <button onClick={() => onStatusChange(plan.id, "paused")}
              className="rounded-md p-1.5 hover:bg-white/[0.06] text-muted-foreground/50 hover:text-amber-400 transition-colors" title="Pause">
              <Pause className="h-3.5 w-3.5" />
            </button>
          )}
          {plan.status === "paused" && (
            <button onClick={() => onStatusChange(plan.id, "active")}
              className="rounded-md p-1.5 hover:bg-white/[0.06] text-muted-foreground/50 hover:text-emerald-400 transition-colors" title="Resume">
              <Play className="h-3.5 w-3.5" />
            </button>
          )}
          {plan.status !== "cancelled" && plan.status !== "completed" && (
            <button onClick={() => { if (confirm("Cancel this warmup plan?")) onStatusChange(plan.id, "cancelled"); }}
              className="rounded-md p-1.5 hover:bg-white/[0.06] text-muted-foreground/50 hover:text-red-400 transition-colors" title="Cancel">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <button onClick={() => { setExpanded(v => !v); if (!expanded) refetch(); }}
            className="rounded-md p-1.5 hover:bg-white/[0.06] text-muted-foreground/50 transition-colors">
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-white/[0.04]">
        <div className="h-full bg-amber-400/60 transition-all duration-500" style={{ width: `${progressPct}%` }} />
      </div>

      {expanded && days.length > 0 && (
        <div className="border-t border-white/[0.06] px-4 py-4">
          <p className="text-xs text-muted-foreground/50 mb-3">Send schedule — {days.length} days</p>
          <div className="overflow-x-auto">
            <table className="w-full text-[10px] text-muted-foreground/60">
              <thead>
                <tr className="border-b border-white/[0.04]">
                  {["Day", "Target", "Actual", "Bounces", "Complaints", "Status"].map((h) => (
                    <th key={h} className="py-1.5 px-2 text-left font-medium text-muted-foreground/40">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {days.slice(0, 56).map((d: any) => (
                  <tr key={d.day_number} className={cn(
                    "border-b border-white/[0.02] transition-colors",
                    d.day_number === plan.current_day + 1 ? "bg-amber-500/5" : ""
                  )}>
                    <td className="py-1.5 px-2 tabular-nums">{d.day_number}</td>
                    <td className="py-1.5 px-2 tabular-nums">{d.target_send_count}</td>
                    <td className="py-1.5 px-2 tabular-nums">{d.actual_send_count}</td>
                    <td className={cn("py-1.5 px-2 tabular-nums", d.bounce_count > 0 ? "text-red-400/70" : "")}>{d.bounce_count}</td>
                    <td className={cn("py-1.5 px-2 tabular-nums", d.complaint_count > 0 ? "text-red-400/70" : "")}>{d.complaint_count}</td>
                    <td className={cn("py-1.5 px-2 capitalize",
                      d.status === "completed" ? "text-emerald-400/70" :
                      d.status === "in_progress" ? "text-amber-400/70" : "text-muted-foreground/30"
                    )}>{d.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export function HexMailDomainWarming() {
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    name:                "New Warmup Plan",
    domainId:            "",
    mailboxId:           "",
    startDate:           new Date().toISOString().split("T")[0],
    startingDailyVolume: 5,
    targetDailyVolume:   200,
    incrementType:       "weekly_double" as "weekly_double" | "weekly_fixed" | "daily_fixed",
    incrementValue:      0,
  });
  const qc = useQueryClient();

  const getDomainsFn = useServerFn(getSenderDomains);
  const getMailFn    = useServerFn(getMailboxes);
  const getPlansFn   = useServerFn(getWarmupPlans);
  const createFn     = useServerFn(createWarmupPlan);
  const updateFn     = useServerFn(updateWarmupPlan);

  const { data: domains  = [] } = useQuery({ queryKey: ["sender-domains"],  queryFn: () => getDomainsFn() ,
    throwOnError: false,
  });
  const { data: mailboxes = [] } = useQuery({ queryKey: ["mailboxes"],      queryFn: () => getMailFn() ,
    throwOnError: false,
  });
  const { data: plans = [], isLoading } = useQuery({ queryKey: ["warmup-plans"], queryFn: () => getPlansFn() ,
    throwOnError: false,
  });

  const createMut = useMutation({
    mutationFn: () => createFn({ data: form }),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ["warmup-plans"] }); qc.invalidateQueries({ queryKey: ["mailboxes"] }); setShowCreate(false); },
  });

  async function changeStatus(planId: string, status: "active" | "paused" | "cancelled") {
    await updateFn({ data: { planId, status } });
    qc.invalidateQueries({ queryKey: ["warmup-plans"] });
  }

  const filteredMailboxes = mailboxes.filter((m: any) => !form.domainId || m.domain_id === form.domainId);

  const exampleSchedule = [
    { week: 1, range: `${form.startingDailyVolume}–${form.startingDailyVolume} emails/day` },
    { week: 2, range: form.incrementType === "weekly_double"
      ? `${form.startingDailyVolume * 2}–${Math.min(form.startingDailyVolume * 4, form.targetDailyVolume)} emails/day`
      : `${form.startingDailyVolume + form.incrementValue}–${form.startingDailyVolume + form.incrementValue * 2} emails/day` },
    { week: 4, range: `Up to ${Math.min(form.targetDailyVolume, 100)} emails/day` },
    { week: 8, range: `${form.targetDailyVolume} emails/day (target)` },
  ];

  return (
    <div className="flex flex-col gap-6 p-6 max-w-4xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Domain Warming</h1>
          <p className="text-sm text-muted-foreground mt-1">Build gradual send schedules to establish domain reputation safely.</p>
        </div>
        <Button onClick={() => setShowCreate(v => !v)} size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" /> Create Plan
        </Button>
      </div>

      {showCreate && (
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5 flex flex-col gap-4">
          <h2 className="text-sm font-semibold">New Warmup Plan</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <Label className="text-xs text-muted-foreground/60 mb-1 block">Plan Name</Label>
              <Input value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                className="bg-white/[0.03] border-white/[0.08]" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground/60 mb-1 block">Sender Domain *</Label>
              <select value={form.domainId} onChange={(e) => setForm(f => ({ ...f, domainId: e.target.value, mailboxId: "" }))}
                className="w-full h-10 rounded-md border border-white/[0.08] bg-white/[0.03] px-3 text-sm text-foreground">
                <option value="">Select domain…</option>
                {domains.map((d: any) => <option key={d.id} value={d.id}>{d.domain}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground/60 mb-1 block">Mailbox *</Label>
              <select value={form.mailboxId} onChange={(e) => setForm(f => ({ ...f, mailboxId: e.target.value }))}
                className="w-full h-10 rounded-md border border-white/[0.08] bg-white/[0.03] px-3 text-sm text-foreground">
                <option value="">Select mailbox…</option>
                {filteredMailboxes.map((m: any) => <option key={m.id} value={m.id}>{m.email_address}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground/60 mb-1 block">Start Date</Label>
              <Input type="date" value={form.startDate} onChange={(e) => setForm(f => ({ ...f, startDate: e.target.value }))}
                className="bg-white/[0.03] border-white/[0.08]" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground/60 mb-1 block">Increment Strategy</Label>
              <select value={form.incrementType} onChange={(e) => setForm(f => ({ ...f, incrementType: e.target.value as any }))}
                className="w-full h-10 rounded-md border border-white/[0.08] bg-white/[0.03] px-3 text-sm text-foreground">
                <option value="weekly_double">Double each week</option>
                <option value="weekly_fixed">Fixed weekly increase</option>
                <option value="daily_fixed">Fixed daily increase</option>
              </select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground/60 mb-1 block">Starting Volume (emails/day)</Label>
              <Input type="number" min={1} max={50} value={form.startingDailyVolume}
                onChange={(e) => setForm(f => ({ ...f, startingDailyVolume: Number(e.target.value) }))}
                className="bg-white/[0.03] border-white/[0.08]" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground/60 mb-1 block">Target Volume (emails/day)</Label>
              <Input type="number" min={10} max={10000} value={form.targetDailyVolume}
                onChange={(e) => setForm(f => ({ ...f, targetDailyVolume: Number(e.target.value) }))}
                className="bg-white/[0.03] border-white/[0.08]" />
            </div>
            {(form.incrementType === "weekly_fixed" || form.incrementType === "daily_fixed") && (
              <div>
                <Label className="text-xs text-muted-foreground/60 mb-1 block">Increase Amount</Label>
                <Input type="number" min={1} value={form.incrementValue}
                  onChange={(e) => setForm(f => ({ ...f, incrementValue: Number(e.target.value) }))}
                  className="bg-white/[0.03] border-white/[0.08]" />
              </div>
            )}
          </div>

          {/* Preview schedule */}
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.01] p-3">
            <p className="text-[10px] text-muted-foreground/50 mb-2 uppercase tracking-widest">Schedule Preview</p>
            <div className="flex flex-col gap-1">
              {exampleSchedule.map(({ week, range }) => (
                <div key={week} className="flex items-center gap-3 text-xs">
                  <span className="text-muted-foreground/40 w-16 shrink-0">Week {week}:</span>
                  <span className="text-muted-foreground/70">{range}</span>
                </div>
              ))}
            </div>
          </div>

          {createMut.error && <p className="text-xs text-red-400">{(createMut.error as any).message}</p>}
          <div className="flex gap-2">
            <Button onClick={() => createMut.mutate()} disabled={!form.domainId || !form.mailboxId || createMut.isPending} size="sm">
              {createMut.isPending ? "Creating…" : "Create Plan"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShowCreate(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex flex-col gap-3">
          {[...Array(2)].map((_, i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-white/[0.03]" />)}
        </div>
      ) : plans.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/[0.10] p-10 text-center flex flex-col items-center gap-2">
          <Flame className="h-8 w-8 text-muted-foreground/30" />
          <p className="text-sm font-medium">No warmup plans yet</p>
          <p className="text-xs text-muted-foreground/50">Create a plan to safely warm up new domains and mailboxes.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {plans.map((p: any) => (
            <PlanCard key={p.id} plan={p} onStatusChange={changeStatus} />
          ))}
        </div>
      )}
    </div>
  );
}
