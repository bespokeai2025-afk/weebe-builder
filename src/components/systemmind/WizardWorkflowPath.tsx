import { useState } from "react";
import {
  CheckCircle2, XCircle, Circle, Loader2, ChevronRight, RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// The real executable path — each node maps onto the concrete step keys the
// runtime writes into systemmind_execution_steps, so this renders live truth.
const PATH_NODES: Array<{ key: string; label: string; stepKeys: string[]; config: (ctx: Ctx) => string }> = [
  { key: "trigger",   label: "Trigger",            stepKeys: [],                  config: (c) => c.triggerSummary || "No enabled trigger" },
  { key: "retrieve",  label: "Retrieve data",      stepKeys: ["assemble_data"],   config: () => "Lead + CRM data assembled via approved variable mappings" },
  { key: "validate",  label: "Validate required",  stepKeys: ["assemble_data"],   config: () => "Missing required fields park the call as waiting_for_data" },
  { key: "transform", label: "Transform",          stepKeys: ["assemble_data"],   config: () => "Transformation rules applied per field mapping" },
  { key: "queue",     label: "Queue",              stepKeys: [],                  config: (c) => c.queueSummary || "Queue entry claimed atomically by the scheduler" },
  { key: "call",      label: "Place call",         stepKeys: ["resolve_agent", "place_call"], config: () => "Retell outbound call using deployed agent + assigned number" },
  { key: "webhooks",  label: "Webhooks",           stepKeys: [],                  config: () => "call_ended / call_analyzed events drive the post-call pipeline" },
  { key: "outcome",   label: "Save outcome",       stepKeys: ["attempt_outcome"], config: () => "Attempt row updated with disposition, duration, sentiment" },
  { key: "webee",     label: "WEBEE update",       stepKeys: ["webee_writeback"], config: () => "Extracted fields + summary written to the WEBEE lead" },
  { key: "crm",       label: "CRM write-back",     stepKeys: ["crm_writeback"],   config: () => "Outcome dispatched to the connected CRM (failures land in Integration errors, retryable)" },
  { key: "followup",  label: "Follow-up",          stepKeys: [],                  config: () => "Retry/callback scheduling per trigger rules and attempt caps" },
];

type Ctx = { triggerSummary: string; queueSummary: string };

type TimelineStep = {
  step_key: string; step_label: string; status: string;
  input_masked?: unknown; output_masked?: unknown; error?: string | null;
  started_at?: string; completed_at?: string;
};

const hasData = (v: unknown) =>
  v != null && !(typeof v === "object" && v !== null && Object.keys(v as object).length === 0);

export function WizardWorkflowPath(props: {
  steps: TimelineStep[];
  executionStatus?: string | null;
  triggerSummary?: string;
  queueSummary?: string;
  onRetryCrm?: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const ctx: Ctx = { triggerSummary: props.triggerSummary ?? "", queueSummary: props.queueSummary ?? "" };

  const stepFor = (node: (typeof PATH_NODES)[number]): TimelineStep | null => {
    for (const k of node.stepKeys) {
      const s = props.steps.find((x) => x.step_key === k);
      if (s) return s;
    }
    return null;
  };

  const nodeState = (node: (typeof PATH_NODES)[number]): "ok" | "failed" | "running" | "idle" => {
    const s = stepFor(node);
    if (!s) return "idle";
    if (s.status === "failed") return "failed";
    if (s.status === "running") return "running";
    return "ok";
  };

  const sel = PATH_NODES.find((n) => n.key === selected) ?? null;
  const selStep = sel ? stepFor(sel) : null;

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
      <div className="mb-3 text-sm font-medium text-slate-200">Workflow path (bound to last execution)</div>
      <div className="flex flex-wrap items-center gap-1">
        {PATH_NODES.map((n, i) => {
          const st = nodeState(n);
          return (
            <div key={n.key} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3 w-3 text-slate-700" />}
              <button
                onClick={() => setSelected(selected === n.key ? null : n.key)}
                className={cn(
                  "flex items-center gap-1 rounded border px-2 py-1 text-[10px] transition-colors",
                  selected === n.key ? "border-indigo-500/60 bg-indigo-500/10" : "border-slate-800 bg-slate-950/60 hover:border-slate-600",
                  st === "failed" && "border-red-500/50",
                )}
              >
                {st === "ok" && <CheckCircle2 className="h-3 w-3 text-emerald-400" />}
                {st === "failed" && <XCircle className="h-3 w-3 text-red-400" />}
                {st === "running" && <Loader2 className="h-3 w-3 animate-spin text-indigo-400" />}
                {st === "idle" && <Circle className="h-3 w-3 text-slate-600" />}
                <span className={cn("text-slate-300", st === "failed" && "text-red-300")}>{n.label}</span>
              </button>
            </div>
          );
        })}
      </div>

      {sel && (
        <div className="mt-3 rounded border border-slate-800 bg-slate-950/60 p-3 text-xs">
          <div className="mb-1 font-medium text-slate-200">{sel.label}</div>
          <div className="mb-2 text-slate-400">{sel.config(ctx)}</div>
          {selStep ? (
            <div className="space-y-2">
              <div className="text-[10px] text-slate-500">
                Last run: {selStep.status}
                {selStep.started_at ? ` · started ${new Date(selStep.started_at).toLocaleString()}` : ""}
              </div>
              {selStep.error && <div className="rounded bg-red-500/10 p-2 text-[10px] text-red-300">{selStep.error}</div>}
              {hasData(selStep.input_masked) && (
                <details>
                  <summary className="cursor-pointer text-[10px] text-slate-500">Last input</summary>
                  <pre className="mt-1 max-h-32 overflow-auto rounded bg-slate-950 p-2 text-[10px] text-slate-400">{JSON.stringify(selStep.input_masked, null, 2)}</pre>
                </details>
              )}
              {hasData(selStep.output_masked) && (
                <details>
                  <summary className="cursor-pointer text-[10px] text-slate-500">Last output</summary>
                  <pre className="mt-1 max-h-32 overflow-auto rounded bg-slate-950 p-2 text-[10px] text-slate-400">{JSON.stringify(selStep.output_masked, null, 2)}</pre>
                </details>
              )}
              {sel.key === "crm" && selStep.status === "failed" && props.onRetryCrm && (
                <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={props.onRetryCrm}>
                  <RotateCcw className="mr-1 h-3 w-3" />Retry from Integration errors
                </Button>
              )}
            </div>
          ) : (
            <div className="text-[10px] text-slate-500">No execution has reached this step yet.</div>
          )}
        </div>
      )}
    </div>
  );
}
