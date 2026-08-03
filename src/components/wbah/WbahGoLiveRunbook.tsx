/**
 * Go-live checklist — Save → Validate → Test → Activate → Monitor.
 */
import { CheckCircle2, Circle, ExternalLink, History, Loader2, Rocket, Save } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  getWbahPostCallEngineStatusFn,
  listWbahWorkflowsFn,
} from "@/lib/systemmind/wbah-workflow-wizard.functions";
import type { WbahPostCallWorkflowConfig } from "@/lib/wbah/workflow/wbah-workflow-steps.shared";

type StepState = "done" | "current" | "pending" | "warn";

function StepRow({
  state,
  title,
  detail,
  action,
}: {
  state: StepState;
  title: string;
  detail: string;
  action?: React.ReactNode;
}) {
  const Icon = state === "done" ? CheckCircle2 : Circle;
  return (
    <li className="flex items-start gap-2.5 py-1.5">
      <Icon
        className={cn(
          "h-4 w-4 shrink-0 mt-0.5",
          state === "done" && "text-emerald-400",
          state === "current" && "text-violet-400",
          state === "warn" && "text-amber-400",
          state === "pending" && "text-gray-600",
        )}
      />
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "text-[11px] font-medium",
            state === "pending" ? "text-gray-500" : "text-gray-200",
          )}
        >
          {title}
        </p>
        <p className="text-[10px] text-gray-500 leading-snug">{detail}</p>
        {action ? <div className="mt-1.5">{action}</div> : null}
      </div>
    </li>
  );
}

export function WbahGoLiveRunbook({
  sessionId,
  versionNumber,
  pipeline,
  onSave,
  savePending,
  onOpenExecutions,
  className,
}: {
  sessionId: string | null;
  versionNumber: number | null;
  pipeline: WbahPostCallWorkflowConfig;
  onSave: () => void;
  savePending: boolean;
  onOpenExecutions?: () => void;
  className?: string;
}) {
  const engineFn = useServerFn(getWbahPostCallEngineStatusFn);
  const listFn = useServerFn(listWbahWorkflowsFn);

  const { data: engine } = useQuery({
    queryKey: ["wbah-post-call-engine-status"],
    queryFn: () => engineFn(),
    staleTime: 60_000,
    throwOnError: false,
  });

  const { data: workflows } = useQuery({
    queryKey: ["wbah-workflows"],
    queryFn: () => listFn(),
    throwOnError: false,
  });

  const saved = versionNumber != null && versionNumber > 0;
  const validation = pipeline.automation_validation;
  const valid = validation?.valid !== false;
  const nodeCount = pipeline.n8n_graph?.nodes?.length ?? 0;
  const published = (workflows ?? []).find(
    (w) => w.sourceBuildSessionId === sessionId || w.name === pipeline.name,
  );
  const isActive = published?.status === "active";
  const engineReady = engine?.executionEnabled === true;

  const saveState: StepState = saved ? "done" : "current";
  const validateState: StepState = !saved
    ? "pending"
    : valid
      ? "done"
      : "warn";
  const testState: StepState = !saved || !valid ? "pending" : "current";
  const activateState: StepState = isActive ? "done" : published ? "current" : "pending";
  const monitorState: StepState = isActive && engineReady ? "current" : "pending";

  return (
    <div
      className={cn(
        "rounded-lg border border-gray-800/80 bg-gray-950/50 px-3 py-2.5",
        className,
      )}
    >
      <div className="flex items-center gap-2 mb-2">
        <Rocket className="h-3.5 w-3.5 text-violet-400" />
        <p className="text-[11px] font-semibold text-gray-200">Go live</p>
        {isActive && (
          <Badge className="ml-auto h-5 text-[9px] bg-emerald-500/15 text-emerald-300 border-emerald-500/30">
            Active
          </Badge>
        )}
      </div>
      <ol className="space-y-0.5">
        <StepRow
          state={saveState}
          title="Save workflow"
          detail={
            saved
              ? `Draft saved (v${versionNumber}, ${nodeCount} nodes).`
              : "Persist canvas and sync automation JSON."
          }
          action={
            sessionId ? (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[10px] border-gray-700"
                disabled={savePending}
                onClick={onSave}
              >
                {savePending ? (
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                ) : (
                  <Save className="h-3 w-3 mr-1" />
                )}
                Save now
              </Button>
            ) : null
          }
        />
        <StepRow
          state={validateState}
          title="Validate automation graph"
          detail={
            !saved
              ? "Save first — validation runs on sync."
              : valid
                ? "Automation document parsed successfully."
                : `Validation errors: ${(validation?.errors ?? []).slice(0, 2).join("; ") || "unknown"}`
          }
        />
        <StepRow
          state={testState}
          title="Test in SystemMind Build"
          detail="Run a test call from Build → Test tab (required before activate)."
          action={
            sessionId && saved ? (
              <Button size="sm" variant="outline" className="h-7 text-[10px] border-gray-700" asChild>
                <a href={`/systemmind/build?session=${sessionId}`} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-3 w-3 mr-1" />
                  Open Build test
                </a>
              </Button>
            ) : null
          }
        />
        <StepRow
          state={activateState}
          title="Activate workflow"
          detail={
            isActive
              ? `"${published?.name ?? pipeline.name}" is the active post-call workflow.`
              : published
                ? "Apply from Build, then activate from Published workflows."
                : "Apply saved version in Build to create a published workflow."
          }
        />
        <StepRow
          state={monitorState}
          title="Monitor executions"
          detail={
            engineReady
              ? "POST_CALL engine is on — watch queue and step I/O in Executions."
              : "Set WBAH_POST_CALL_ENABLED=true for production writes."
          }
          action={
            onOpenExecutions ? (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[10px] border-gray-700"
                onClick={onOpenExecutions}
              >
                <History className="h-3 w-3 mr-1" />
                View executions
              </Button>
            ) : null
          }
        />
      </ol>
    </div>
  );
}
