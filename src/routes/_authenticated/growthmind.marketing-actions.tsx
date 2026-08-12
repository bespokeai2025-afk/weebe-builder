import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { History, Undo2, Loader2, ChevronDown, ChevronUp, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { GrowthMindShell } from "@/components/growthmind/GrowthMindShell";
import { listMarketingActions, requestMarketingUndo } from "@/lib/marketing/marketing-actions.functions";
import {
  MARKETING_STATUS_META,
  UNDOABLE_MARKETING_STATUSES,
  type MarketingActionRecord,
} from "@/lib/marketing/action-engine.shared";

export const Route = createFileRoute("/_authenticated/growthmind/marketing-actions")({
  head: () => ({ meta: [{ title: "Marketing Actions — GrowthMind" }] }),
  component: MarketingActionsPage,
});

const TONE_CLASSES: Record<string, string> = {
  muted:  "bg-slate-500/15 text-slate-300",
  info:   "bg-blue-500/15 text-blue-300",
  warn:   "bg-amber-500/15 text-amber-300",
  active: "bg-violet-500/15 text-violet-300",
  good:   "bg-emerald-500/15 text-emerald-300",
  bad:    "bg-red-500/15 text-red-300",
};

function StatusBadge({ status }: { status: MarketingActionRecord["status"] }) {
  const meta = MARKETING_STATUS_META[status] ?? { label: status, tone: "muted" as const };
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium", TONE_CLASSES[meta.tone])}>
      {meta.label}
    </span>
  );
}

function JsonBlock({ label, value }: { label: string; value: any }) {
  if (value == null) return null;
  return (
    <div>
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <pre className="mt-1 max-h-40 overflow-auto rounded-md bg-black/30 p-2 text-[11px] leading-relaxed">
        {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function ActionRow({ action, onUndo, undoing }: {
  action: MarketingActionRecord;
  onUndo: (id: string) => void;
  undoing: string | null;
}) {
  const [open, setOpen] = useState(false);
  const undoable = UNDOABLE_MARKETING_STATUSES.includes(action.status) && !action.rollback_of;
  return (
    <div className="rounded-lg border border-white/[0.07] bg-[hsl(var(--card))]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{action.action_type}</span>
            <span className="text-xs text-muted-foreground">· {action.platform}</span>
            <StatusBadge status={action.status} />
            {action.risk_level === "high" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] text-red-300">
                <ShieldAlert className="h-3 w-3" /> High risk
              </span>
            )}
            {action.rollback_of && (
              <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] text-muted-foreground">Undo action</span>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {action.expected_impact || action.objective || "—"} · {new Date(action.created_at).toLocaleString()}
          </p>
        </div>
        {open ? <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />}
      </button>
      {open && (
        <div className="space-y-3 border-t border-white/[0.06] px-4 py-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <JsonBlock label="Target" value={action.target} />
            <JsonBlock label="Evidence" value={action.evidence} />
            <JsonBlock label="Existing value" value={action.existing_value} />
            <JsonBlock label="Proposed value" value={action.proposed_value} />
            <JsonBlock label="Verification evidence" value={action.verification_evidence} />
            <JsonBlock label="Error" value={action.error_message} />
          </div>
          <JsonBlock label="Status history" value={action.status_history} />
          {undoable && (
            <button
              type="button"
              disabled={undoing === action.id}
              onClick={() => onUndo(action.id)}
              className="inline-flex items-center gap-2 rounded-md border border-white/10 px-3 py-1.5 text-xs font-medium transition hover:bg-white/[0.05] disabled:opacity-50"
            >
              {undoing === action.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
              Undo this change
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function MarketingActionsPage() {
  const listFn = useServerFn(listMarketingActions);
  const undoFn = useServerFn(requestMarketingUndo);
  const qc = useQueryClient();
  const [undoing, setUndoing] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["marketing-actions"],
    queryFn: () => listFn(),
    staleTime: 15_000,
    throwOnError: false,
  });
  const actions = data?.actions ?? [];

  async function handleUndo(id: string) {
    setUndoing(id); setNotice(null);
    try {
      const res = await undoFn({ data: { actionId: id } });
      setNotice(res.detail);
      qc.invalidateQueries({ queryKey: ["marketing-actions"] });
    } catch (e: any) {
      setNotice(e?.message || "Undo failed.");
    } finally {
      setUndoing(null);
    }
  }

  return (
    <GrowthMindShell>
      <div className="mx-auto max-w-4xl space-y-4 p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-500/15 ring-1 ring-violet-500/20">
            <History className="h-4.5 w-4.5 text-violet-400" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Marketing Actions</h1>
            <p className="text-xs text-muted-foreground">
              Every change the marketing engine has recommended, executed and verified. Undo creates a
              compensating change that follows the same approval rules.
            </p>
          </div>
        </div>

        {notice && (
          <div className="rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-xs">{notice}</div>
        )}

        {isLoading ? (
          <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading actions…
          </div>
        ) : actions.length === 0 ? (
          <div className="rounded-lg border border-dashed border-white/10 p-10 text-center text-sm text-muted-foreground">
            No marketing actions yet. When the engine discovers opportunities or executes changes, they appear here.
          </div>
        ) : (
          <div className="space-y-2">
            {actions.map((a) => (
              <ActionRow key={a.id} action={a} onUndo={handleUndo} undoing={undoing} />
            ))}
          </div>
        )}
      </div>
    </GrowthMindShell>
  );
}
