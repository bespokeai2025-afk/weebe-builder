/**
 * WBAH post-call workflow builder — guided Q&A + visual step editor (n8n-like self-service).
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FlaskConical,
  GitBranch,
  Loader2,
  Play,
  Sparkles,
  Workflow,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { WorkflowFlowDiagram } from "@/components/systemmind/BuildSessionView";
import {
  WBAH_N8N_BRANCHES,
  WBAH_WEBEE_RETELL_WEBHOOK_URL,
} from "@/lib/systemmind/wbah-n8n-integration.shared";
import {
  activateWbahWorkflowFn,
  getWbahWorkflowCatalogFn,
  listWbahWorkflowsFn,
  saveWbahWorkflowConfigFn,
  startWbahWorkflowWizardFn,
} from "@/lib/systemmind/wbah-workflow-wizard.functions";
import type { WbahPostCallWorkflowConfig } from "@/lib/wbah/workflow/wbah-workflow-steps.shared";
import {
  wbahPipelineToWizardAnswers,
  WBAH_POST_CALL_STEP_CATALOG,
} from "@/lib/wbah/workflow/wbah-workflow-steps.shared";

type WizardQuestion = {
  id: string;
  prompt: string;
  help?: string;
  type: "text" | "boolean" | "multi_select";
  options?: Array<{ value: string; label: string }>;
  default?: string | boolean | string[];
  required?: boolean;
};

type WizardAnswers = Record<string, string | boolean | string[]>;

function stepEnabledFromAnswers(answers: WizardAnswers, stepId: string): boolean {
  const map: Record<string, boolean | undefined> = {
    live_transcript: answers.enable_live_transcript as boolean | undefined,
    dashboard_raw: answers.enable_dashboard as boolean | undefined,
    dashboard_analyzed: answers.enable_dashboard as boolean | undefined,
    calendly_link: answers.enable_calendly as boolean | undefined,
    dynamics_allens: answers.enable_dynamics_status as boolean | undefined,
    dynamics_agentic: answers.enable_dynamics_property as boolean | undefined,
    wbah_calls_upsert: answers.enable_calls_tab as boolean | undefined,
  };
  return map[stepId] ?? true;
}

function QuestionField({
  q,
  value,
  onChange,
}: {
  q: WizardQuestion;
  value: unknown;
  onChange: (v: string | boolean | string[]) => void;
}) {
  if (q.type === "boolean") {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-800 bg-gray-950/80 px-3 py-2.5">
        <p className="text-xs text-gray-300">{q.prompt}</p>
        <Switch checked={Boolean(value)} onCheckedChange={(c) => onChange(c)} />
      </div>
    );
  }
  if (q.type === "multi_select") {
    const selected = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div className="space-y-2">
        <p className="text-xs text-gray-300">{q.prompt}</p>
        {q.help && <p className="text-[10px] text-gray-500">{q.help}</p>}
        <div className="space-y-1.5 max-h-40 overflow-y-auto rounded-lg border border-gray-800 bg-gray-950/60 p-2">
          {(q.options ?? []).map((opt) => {
            const checked = selected.includes(opt.value);
            return (
              <label
                key={opt.value}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] text-gray-400 hover:bg-gray-900 cursor-pointer"
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={(c) => {
                    const next = c
                      ? [...selected, opt.value]
                      : selected.filter((v) => v !== opt.value);
                    onChange(next);
                  }}
                />
                <Bot className="h-3 w-3 text-gray-600 shrink-0" />
                <span className="truncate">{opt.label}</span>
                <span className="text-gray-600 font-mono text-[9px] truncate ml-auto">{opt.value}</span>
              </label>
            );
          })}
        </div>
      </div>
    );
  }
  if (q.id === "purpose") {
    return (
      <div className="space-y-1.5">
        <p className="text-xs text-gray-300">{q.prompt}</p>
        <Textarea
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          className="min-h-[72px] text-xs bg-gray-950 border-gray-800"
          placeholder="Optional team notes…"
        />
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-gray-300">{q.prompt}</p>
      {q.help && <p className="text-[10px] text-gray-500">{q.help}</p>}
      <Input
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
        className="text-xs bg-gray-950 border-gray-800"
      />
    </div>
  );
}

function VisualStepEditor({
  answers,
  onToggleStep,
}: {
  answers: WizardAnswers;
  onToggleStep: (stepId: string, enabled: boolean) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">
        Post-call branches (toggle like n8n nodes)
      </p>
      {WBAH_POST_CALL_STEP_CATALOG.map((step) => {
        const enabled = stepEnabledFromAnswers(answers, step.id);
        const branch = WBAH_N8N_BRANCHES.find((b) => b.id === step.n8nBranchId);
        return (
          <div
            key={step.id}
            className={cn(
              "rounded-lg border px-3 py-2 transition-colors",
              enabled
                ? "border-violet-500/30 bg-violet-500/[0.06]"
                : "border-gray-800 bg-gray-950/40 opacity-60",
            )}
          >
            <div className="flex items-start gap-2">
              <Switch
                checked={enabled}
                onCheckedChange={(c) => onToggleStep(step.id, c)}
                className="mt-0.5"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-[11px] font-medium text-gray-200">{step.title}</p>
                  <Badge variant="outline" className="text-[9px] border-gray-700 font-mono">
                    {step.events.join(", ")}
                  </Badge>
                  {step.n8nBranchId && (
                    <Badge variant="outline" className="text-[9px] border-violet-500/30 text-violet-300">
                      n8n: {step.n8nBranchId}
                    </Badge>
                  )}
                </div>
                <p className="text-[10px] text-gray-500 mt-0.5">{step.summary}</p>
                {branch && (
                  <p className="text-[10px] text-gray-600 mt-1 flex items-center gap-1">
                    <GitBranch className="h-2.5 w-2.5" />
                    {branch.label}
                  </p>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Guided wizard + workflow list — Admin → Webuyanyhouse panel. */
export function WbahWorkflowBuilderPanel() {
  const qc = useQueryClient();
  const catalogFn = useServerFn(getWbahWorkflowCatalogFn);
  const startFn = useServerFn(startWbahWorkflowWizardFn);
  const saveFn = useServerFn(saveWbahWorkflowConfigFn);
  const listFn = useServerFn(listWbahWorkflowsFn);
  const activateFn = useServerFn(activateWbahWorkflowFn);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<WizardAnswers>({});
  const [questionIdx, setQuestionIdx] = useState(0);
  const [phase, setPhase] = useState<"idle" | "wizard" | "review">("idle");

  const { data: catalog } = useQuery({
    queryKey: ["wbah-workflow-catalog"],
    queryFn: () => catalogFn(),
    throwOnError: false,
    staleTime: 60_000,
  });

  const { data: workflows, isLoading: workflowsLoading } = useQuery({
    queryKey: ["wbah-workflows"],
    queryFn: () => listFn(),
    throwOnError: false,
  });

  const questions = (catalog?.questions ?? []) as WizardQuestion[];
  const currentQ = questions[questionIdx];

  const previewConfig = useMemo(() => {
    const enabledSteps = WBAH_POST_CALL_STEP_CATALOG.filter((s) =>
      stepEnabledFromAnswers(answers, s.id),
    );
    const steps = [
      { id: "step-trigger", type: "trigger", title: "Retell webhook", next: enabledSteps[0]?.id ?? "step-stop" },
      ...enabledSteps.map((s, i) => ({
        id: s.id,
        type: s.type,
        title: s.title,
        enabled: true,
        next: enabledSteps[i + 1]?.id ?? "step-stop",
      })),
      { id: "step-stop", type: "stop_workflow", title: "Done" },
    ];
    return { workflow: { steps } };
  }, [answers]);

  const startWizard = useMutation({
    mutationFn: () => startFn() as Promise<{ sessionId: string; answers: WizardAnswers }>,
    onSuccess: (res) => {
      setSessionId(res.sessionId);
      setAnswers(res.answers);
      setQuestionIdx(0);
      setPhase("wizard");
      toast.success("Workflow wizard started");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const saveWorkflow = useMutation({
    mutationFn: async () => {
      if (!sessionId) throw new Error("No session — start the wizard first.");
      return saveFn({ data: { sessionId, answers } });
    },
    onSuccess: (res) => {
      toast.success("Workflow version saved", {
        description: "Open SystemMind Build → Test tab → run a test call → Apply → activate below.",
      });
      qc.invalidateQueries({ queryKey: ["wbah-workflows"] });
      if (sessionId) {
        window.location.href = `/systemmind/build?session=${sessionId}`;
      }
      return res;
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const activate = useMutation({
    mutationFn: (workflowId: string) => activateFn({ data: { workflowId } }),
    onSuccess: () => {
      toast.success("Workflow activated for post-call execution");
      qc.invalidateQueries({ queryKey: ["wbah-workflows"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  function setAnswer(id: string, value: string | boolean | string[]) {
    setAnswers((prev) => ({ ...prev, [id]: value }));
  }

  function toggleStep(stepId: string, enabled: boolean) {
    const keys: Record<string, string> = {
      live_transcript: "enable_live_transcript",
      dashboard_raw: "enable_dashboard",
      dashboard_analyzed: "enable_dashboard",
      calendly_link: "enable_calendly",
      dynamics_allens: "enable_dynamics_status",
      dynamics_agentic: "enable_dynamics_property",
      wbah_calls_upsert: "enable_calls_tab",
    };
    const key = keys[stepId];
    if (key) setAnswer(key, enabled);
  }

  function valueFor(q: WizardQuestion): unknown {
    if (answers[q.id] !== undefined) return answers[q.id];
    return q.default ?? (q.type === "boolean" ? false : q.type === "multi_select" ? [] : "");
  }

  const canNext =
    !currentQ?.required ||
    (currentQ.type === "multi_select"
      ? Array.isArray(valueFor(currentQ)) && (valueFor(currentQ) as string[]).length > 0
      : String(valueFor(currentQ) ?? "").trim().length > 0);

  return (
    <div className="bg-gray-900 border border-violet-500/20 rounded-xl p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-violet-400" />
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            Workflow Builder — n8n-style self-service
          </h3>
        </div>
        <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-300">
          WEBEE native
        </Badge>
      </div>

      <p className="text-[11px] text-gray-400 leading-relaxed">
        SystemMind asks what you need; you answer; we build the post-call pipeline visually.
        Only approved step types run at execution time. A passing test call is required before
        you can activate a workflow in production.
      </p>

      {phase === "idle" && (
        <Button
          size="sm"
          className="h-8 text-xs bg-violet-600 hover:bg-violet-500"
          disabled={startWizard.isPending}
          onClick={() => startWizard.mutate()}
        >
          {startWizard.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
          ) : (
            <Zap className="h-3.5 w-3.5 mr-1" />
          )}
          Start guided workflow setup
        </Button>
      )}

      {phase === "wizard" && currentQ && (
        <div className="space-y-3 rounded-lg border border-gray-800 bg-gray-950/60 p-3">
          <div className="flex items-center justify-between text-[10px] text-gray-500">
            <span>
              Question {questionIdx + 1} of {questions.length}
            </span>
            <span className="text-violet-400/80">SystemMind</span>
          </div>
          <QuestionField q={currentQ} value={valueFor(currentQ)} onChange={(v) => setAnswer(currentQ.id, v)} />
          {currentQ.help && currentQ.type !== "multi_select" && (
            <p className="text-[10px] text-gray-500">{currentQ.help}</p>
          )}
          <div className="flex gap-2 pt-1">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs border-gray-700"
              disabled={questionIdx === 0}
              onClick={() => setQuestionIdx((i) => Math.max(0, i - 1))}
            >
              <ChevronLeft className="h-3 w-3 mr-0.5" /> Back
            </Button>
            {questionIdx < questions.length - 1 ? (
              <Button
                size="sm"
                className="h-7 text-xs bg-violet-600 hover:bg-violet-500 ml-auto"
                disabled={!canNext}
                onClick={() => setQuestionIdx((i) => i + 1)}
              >
                Next <ChevronRight className="h-3 w-3 ml-0.5" />
              </Button>
            ) : (
              <Button
                size="sm"
                className="h-7 text-xs bg-violet-600 hover:bg-violet-500 ml-auto"
                onClick={() => setPhase("review")}
              >
                Review workflow <ArrowRight className="h-3 w-3 ml-0.5" />
              </Button>
            )}
          </div>
        </div>
      )}

      {phase === "review" && (
        <div className="space-y-4">
          <VisualStepEditor answers={answers} onToggleStep={toggleStep} />
          <div className="rounded-lg border border-gray-800 bg-black/30 p-3">
            <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wide mb-2">
              Flow preview
            </p>
            <WorkflowFlowDiagram config={previewConfig} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs border-gray-700"
              onClick={() => setPhase("wizard")}
            >
              Edit answers
            </Button>
            <Button
              size="sm"
              className="h-8 text-xs bg-emerald-600 hover:bg-emerald-500"
              disabled={saveWorkflow.isPending || !sessionId}
              onClick={() => saveWorkflow.mutate()}
            >
              {saveWorkflow.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
              )}
              Save version & open Build
            </Button>
            {sessionId && (
              <Button size="sm" variant="ghost" className="h-8 text-xs" asChild>
                <a href={`/systemmind/build?session=${sessionId}`}>Open session</a>
              </Button>
            )}
          </div>
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.04] px-3 py-2 flex items-start gap-2">
            <FlaskConical className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
            <p className="text-[10px] text-amber-200/90">
              After saving: SystemMind Build → <strong>Test</strong> tab → place a test call →{" "}
              <strong>Apply</strong> → return here to <strong>Activate</strong>. Retell webhook:{" "}
              <code className="text-emerald-400/90 break-all">{WBAH_WEBEE_RETELL_WEBHOOK_URL}</code>
            </p>
          </div>
        </div>
      )}

      <div className="border-t border-gray-800 pt-3 space-y-2">
        <div className="flex items-center gap-2">
          <Workflow className="h-3.5 w-3.5 text-gray-500" />
          <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">
            Saved workflows (call_completed)
          </p>
        </div>
        {workflowsLoading ? (
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
          </div>
        ) : (workflows ?? []).length === 0 ? (
          <p className="text-[10px] text-gray-600">No applied workflows yet — save and Apply from Build first.</p>
        ) : (
          <ul className="space-y-1.5">
            {(workflows ?? []).map((wf) => (
              <li
                key={wf.id}
                className="flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-950/50 px-2.5 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] text-gray-300 truncate">{wf.name}</p>
                  <p className="text-[10px] text-gray-600">
                    {wf.stepCount} step(s) · {wf.retellAgents.length} agent(s)
                    {wf.updatedAt ? ` · ${new Date(wf.updatedAt).toLocaleDateString()}` : ""}
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[9px] shrink-0",
                    wf.status === "active"
                      ? "border-emerald-500/40 text-emerald-300"
                      : "border-gray-700 text-gray-500",
                  )}
                >
                  {wf.status}
                </Badge>
                {wf.status !== "active" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-[10px] border-violet-500/40 shrink-0"
                    disabled={activate.isPending}
                    onClick={() => activate.mutate(wf.id)}
                  >
                    {activate.isPending ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <>
                        <Play className="h-3 w-3 mr-0.5" /> Activate
                      </>
                    )}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Inline editor for SystemMind Build session — Workflow tab. */
export function WbahWorkflowEditorPanel({
  sessionId,
  config,
  onSaved,
}: {
  sessionId: string;
  config: Record<string, unknown>;
  onSaved?: () => void;
}) {
  const qc = useQueryClient();
  const saveFn = useServerFn(saveWbahWorkflowConfigFn);

  const pipeline = useMemo(() => {
    const ch = (config.channel_setup as Record<string, unknown> | undefined)?.wbah_post_call;
    if (ch && typeof ch === "object") return ch as WbahPostCallWorkflowConfig;
    const tc = (config.workflow as Record<string, unknown> | undefined)?.trigger_config as
      | Record<string, unknown>
      | undefined;
    const embedded = tc?.wbah_post_call;
    if (embedded && typeof embedded === "object") return embedded as WbahPostCallWorkflowConfig;
    return null;
  }, [config]);

  const [answers, setAnswers] = useState<WizardAnswers>(() =>
    pipeline ? (wbahPipelineToWizardAnswers(pipeline) as WizardAnswers) : {},
  );

  const previewConfig = useMemo(() => {
    const enabledSteps = WBAH_POST_CALL_STEP_CATALOG.filter((s) =>
      stepEnabledFromAnswers(answers, s.id),
    );
    const steps = [
      { id: "step-trigger", type: "trigger", title: "Retell webhook", next: enabledSteps[0]?.id ?? "step-stop" },
      ...enabledSteps.map((s, i) => ({
        id: s.id,
        type: s.type,
        title: s.title,
        enabled: true,
        next: enabledSteps[i + 1]?.id ?? "step-stop",
      })),
      { id: "step-stop", type: "stop_workflow", title: "Done" },
    ];
    return { workflow: { steps } };
  }, [answers]);

  const save = useMutation({
    mutationFn: () => saveFn({ data: { sessionId, answers } }),
    onSuccess: () => {
      toast.success("Post-call workflow updated — new draft version saved");
      qc.invalidateQueries({ queryKey: ["smbw-session", sessionId] });
      onSaved?.();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  if (!pipeline) return null;

  function toggleStep(stepId: string, enabled: boolean) {
    const keys: Record<string, string> = {
      live_transcript: "enable_live_transcript",
      dashboard_raw: "enable_dashboard",
      dashboard_analyzed: "enable_dashboard",
      calendly_link: "enable_calendly",
      dynamics_allens: "enable_dynamics_status",
      dynamics_agentic: "enable_dynamics_property",
      wbah_calls_upsert: "enable_calls_tab",
    };
    const key = keys[stepId];
    if (key) setAnswers((prev) => ({ ...prev, [key]: enabled }));
  }

  const enabledCount = WBAH_POST_CALL_STEP_CATALOG.filter((s) =>
    stepEnabledFromAnswers(answers, s.id),
  ).length;

  return (
    <div className="space-y-3 rounded-lg border border-violet-500/25 bg-violet-500/[0.04] p-3">
      <div className="flex items-center gap-2">
        <Workflow className="h-4 w-4 text-violet-400" />
        <p className="text-xs font-semibold text-violet-200">WBAH post-call pipeline editor</p>
        <Badge variant="outline" className="text-[9px] border-violet-500/30 ml-auto">
          {enabledCount} / {WBAH_POST_CALL_STEP_CATALOG.length} steps on
        </Badge>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Toggle branches below — only approved step types are saved. Test call required before Apply.
      </p>
      <VisualStepEditor answers={answers} onToggleStep={toggleStep} />
      <div className="rounded-lg border border-white/[0.06] bg-black/20 p-2">
        <WorkflowFlowDiagram config={previewConfig} />
      </div>
      <Button
        size="sm"
        className="h-8 text-xs gap-1.5"
        disabled={save.isPending}
        onClick={() => save.mutate()}
      >
        {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
        Save workflow as new version
      </Button>
    </div>
  );
}

export function hasWbahPostCallConfig(config: Record<string, unknown> | null | undefined): boolean {
  if (!config) return false;
  const ch = (config.channel_setup as Record<string, unknown> | undefined)?.wbah_post_call;
  if (ch) return true;
  const tc = (config.workflow as Record<string, unknown> | undefined)?.trigger_config as
    | Record<string, unknown>
    | undefined;
  return !!tc?.wbah_post_call;
}
