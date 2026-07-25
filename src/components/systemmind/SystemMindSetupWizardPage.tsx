import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Loader2, CheckCircle2, XCircle, AlertTriangle, Circle, PlayCircle,
  PauseCircle, RotateCcw, FlaskConical, Activity, Zap, ListOrdered,
  RefreshCw, ShieldAlert, ChevronDown, ChevronRight, PhoneCall,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SystemMindShell } from "./SystemMindShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  getWizardStatusFn, listWizardAgentsFn, getOrCreateDraftActivationFn,
  listActivationVersionsFn, runWorkflowTestsFn, activateWorkflowFn,
  setWorkflowStateFn, getWorkflowHealthFn, saveCallTriggerFn,
  setTriggerEnabledFn, listCallTriggersFn, listCallQueueFn,
  controlQueueEntryFn, listWorkflowExecutionsFn, getExecutionTimelineFn,
  listIntegrationErrorsFn, retryIntegrationErrorFn,
} from "@/lib/systemmind/call-runtime/setup-wizard.functions";
import { getMyPermissions } from "@/lib/permissions/team-access.functions";
import { WizardFieldMappingPanel } from "./WizardFieldMappingPanel";
import { WizardWorkflowPath } from "./WizardWorkflowPath";

// ── status decoration ────────────────────────────────────────────────────────

const STATUS_META: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
  not_started:          { label: "Not started",          cls: "bg-slate-500/15 text-slate-300 border-slate-500/30",     icon: <Circle className="h-3.5 w-3.5" /> },
  information_required: { label: "Information required", cls: "bg-sky-500/15 text-sky-300 border-sky-500/30",           icon: <AlertTriangle className="h-3.5 w-3.5" /> },
  in_progress:          { label: "In progress",          cls: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",  icon: <Loader2 className="h-3.5 w-3.5" /> },
  connected:            { label: "Connected",            cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30", icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
  configured:           { label: "Configured",           cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30", icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
  test_passed:          { label: "Test passed",          cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30", icon: <FlaskConical className="h-3.5 w-3.5" /> },
  warning:              { label: "Warning",              cls: "bg-amber-500/15 text-amber-300 border-amber-500/30",     icon: <AlertTriangle className="h-3.5 w-3.5" /> },
  failed:               { label: "Failed",               cls: "bg-red-500/15 text-red-300 border-red-500/30",           icon: <XCircle className="h-3.5 w-3.5" /> },
  active:               { label: "Active",               cls: "bg-emerald-500/20 text-emerald-200 border-emerald-400/40", icon: <Zap className="h-3.5 w-3.5" /> },
};

function StepBadge({ status }: { status: string }) {
  const m = STATUS_META[status] ?? STATUS_META.not_started;
  return (
    <Badge variant="outline" className={cn("flex items-center gap-1 text-[10px]", m.cls)}>
      {m.icon}{m.label}
    </Badge>
  );
}

const HEALTH_CLS: Record<string, string> = {
  healthy: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  warning: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  degraded: "bg-orange-500/15 text-orange-300 border-orange-500/30",
  failed: "bg-red-500/15 text-red-300 border-red-500/30",
  paused: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  unknown: "bg-slate-500/15 text-slate-300 border-slate-500/30",
};

const TRIGGER_TYPES = [
  { value: "webee_lead_created", label: "New WEBEE lead created" },
  { value: "webee_lead_status", label: "WEBEE lead status changes" },
  { value: "crm_lead_created", label: "New CRM lead (via sync)" },
  { value: "crm_lead_changed", label: "CRM lead changed (via sync)" },
  { value: "webform", label: "Webform submission" },
  { value: "csv_upload", label: "CSV upload" },
  { value: "scheduled", label: "Scheduled batch" },
  { value: "delay_after_creation", label: "Delay after lead creation" },
  { value: "callback", label: "Requested callback" },
  { value: "manual", label: "Manual only" },
] as const;

export function SystemMindSetupWizardPage() {
  const qc = useQueryClient();
  const [agentId, setAgentId] = useState<string>("");
  const [expandedStep, setExpandedStep] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [showOverride, setShowOverride] = useState(false);
  const [selectedExecId, setSelectedExecId] = useState<string | null>(null);

  const listAgents   = useServerFn(listWizardAgentsFn);
  const getStatus    = useServerFn(getWizardStatusFn);
  const getDraft     = useServerFn(getOrCreateDraftActivationFn);
  const listVersions = useServerFn(listActivationVersionsFn);
  const runTests     = useServerFn(runWorkflowTestsFn);
  const activate     = useServerFn(activateWorkflowFn);
  const setState     = useServerFn(setWorkflowStateFn);
  const getHealth    = useServerFn(getWorkflowHealthFn);
  const saveTrigger  = useServerFn(saveCallTriggerFn);
  const setTrig      = useServerFn(setTriggerEnabledFn);
  const listTrigs    = useServerFn(listCallTriggersFn);
  const listQueue    = useServerFn(listCallQueueFn);
  const controlQ     = useServerFn(controlQueueEntryFn);
  const listExecs    = useServerFn(listWorkflowExecutionsFn);
  const getTimeline  = useServerFn(getExecutionTimelineFn);
  const listIntErrs  = useServerFn(listIntegrationErrorsFn);
  const retryIntErr  = useServerFn(retryIntegrationErrorFn);

  const myPermsFn = useServerFn(getMyPermissions);
  const permsQ = useQuery({
    queryKey: ["my-permissions"],
    queryFn: () => myPermsFn(),
    throwOnError: false,
    staleTime: 30_000,
  });
  // Fail open while loading (server still enforces); once loaded, gate on the
  // systemmind_approval action, which the server requires for live-impact actions.
  const canApprove = permsQ.data
    ? (permsQ.data as any).actionAccess?.systemmind_approval === true
    : true;
  const approvalHint = "You don't have approval permission — ask a workspace admin to activate or change live workflows.";
  const friendlyError = (e: any, fallback: string) => {
    const msg = String(e?.message ?? "");
    if (/permission denied|not include|approval/i.test(msg)) return approvalHint;
    return msg || fallback;
  };

  const agentsQ = useQuery({
    queryKey: ["sm-wizard-agents"],
    queryFn: () => listAgents(),
    throwOnError: false,
  });

  const statusQ = useQuery({
    queryKey: ["sm-wizard-status", agentId],
    queryFn: () => getStatus({ data: { agentId } }),
    enabled: Boolean(agentId),
    throwOnError: false,
    refetchInterval: 30_000,
  });
  const steps = statusQ.data?.steps ?? [];
  const activation = statusQ.data?.activation ?? null;

  const versionsQ = useQuery({
    queryKey: ["sm-wizard-versions", agentId],
    queryFn: () => listVersions({ data: { agentId } }),
    enabled: Boolean(agentId),
    throwOnError: false,
  });

  const healthQ = useQuery({
    queryKey: ["sm-wizard-health", activation?.id],
    queryFn: () => getHealth({ data: { activationId: activation.id } }),
    enabled: Boolean(activation?.id && activation?.status === "active"),
    throwOnError: false,
    refetchInterval: 60_000,
  });

  const triggersQ = useQuery({
    queryKey: ["sm-wizard-triggers", agentId],
    queryFn: () => listTrigs({ data: { agentId } }),
    enabled: Boolean(agentId),
    throwOnError: false,
  });

  const queueQ = useQuery({
    queryKey: ["sm-wizard-queue", agentId],
    queryFn: () => listQueue({ data: { agentId } }),
    enabled: Boolean(agentId) && expandedStep === "call_queue",
    throwOnError: false,
  });

  const execsQ = useQuery({
    queryKey: ["sm-wizard-execs", agentId],
    queryFn: () => listExecs({ data: { agentId, limit: 30 } }),
    enabled: Boolean(agentId),
    throwOnError: false,
  });

  const timelineQ = useQuery({
    queryKey: ["sm-wizard-timeline", selectedExecId],
    queryFn: () => getTimeline({ data: { executionId: selectedExecId! } }),
    enabled: Boolean(selectedExecId),
    throwOnError: false,
  });

  const intErrsQ = useQuery({
    queryKey: ["sm-wizard-int-errors", agentId],
    queryFn: () => listIntErrs({ data: { agentId } }),
    enabled: Boolean(agentId),
    throwOnError: false,
  });

  // Bind the workflow path visualisation to the latest execution's timeline.
  const latestExecId = (execsQ.data ?? [])[0]?.id ?? null;
  const latestTimelineQ = useQuery({
    queryKey: ["sm-wizard-latest-timeline", latestExecId],
    queryFn: () => getTimeline({ data: { executionId: latestExecId! } }),
    enabled: Boolean(latestExecId),
    throwOnError: false,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["sm-wizard-status", agentId] });
    qc.invalidateQueries({ queryKey: ["sm-wizard-versions", agentId] });
  };

  const draftMut = useMutation({
    mutationFn: () => getDraft({ data: { agentId } }),
    onSuccess: () => { toast.success("Draft workflow version created"); invalidate(); },
    onError: (e: any) => toast.error(e?.message ?? "Failed to create draft"),
  });

  const testMut = useMutation({
    mutationFn: (activationId: string) => runTests({ data: { activationId } }),
    onSuccess: (res: any) => {
      res.passed ? toast.success("All critical checks passed") : toast.error("Some critical checks failed — see results");
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Test run failed"),
  });

  const activateMut = useMutation({
    mutationFn: (input: { activationId: string; overrideReason?: string }) => activate({ data: input }),
    onSuccess: (res: any) => {
      if (res.ok) { toast.success("Workflow activated"); setShowOverride(false); setOverrideReason(""); }
      else if (res.error === "tests_not_passed") { setShowOverride(true); toast.error("Tests not passed — an admin override (with reason) is required"); }
      else if (res.error === "override_requires_admin") toast.error("Only a workspace owner/admin can override the test gate");
      else toast.error(res.error ?? "Activation failed");
      invalidate();
    },
    onError: (e: any) => toast.error(friendlyError(e, "Activation failed")),
  });

  const stateMut = useMutation({
    mutationFn: (input: { activationId: string; action: "pause" | "resume" | "rollback" }) => setState({ data: input }),
    onSuccess: (res: any) => { res.ok ? toast.success("Done") : toast.error(res.error ?? "Failed"); invalidate(); },
    onError: (e: any) => toast.error(friendlyError(e, "Failed")),
  });

  const trigMut = useMutation({
    mutationFn: (input: any) => saveTrigger({ data: input }),
    onSuccess: () => { toast.success("Trigger saved"); qc.invalidateQueries({ queryKey: ["sm-wizard-triggers", agentId] }); invalidate(); },
    onError: (e: any) => toast.error(friendlyError(e, "Failed to save trigger")),
  });
  const trigToggleMut = useMutation({
    mutationFn: (input: { id: string; enabled: boolean }) => setTrig({ data: input }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sm-wizard-triggers", agentId] }); invalidate(); },
    onError: (e: any) => toast.error(friendlyError(e, "Failed")),
  });
  const queueMut = useMutation({
    mutationFn: (input: { id: string; action: "pause" | "resume" | "cancel" | "retry_now" }) => controlQ({ data: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sm-wizard-queue", agentId] }),
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });
  const intRetryMut = useMutation({
    mutationFn: (id: string) => retryIntErr({ data: { id } }),
    onSuccess: () => { toast.success("Retry scheduled"); qc.invalidateQueries({ queryKey: ["sm-wizard-int-errors"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  const [newTrigType, setNewTrigType] = useState("webee_lead_created");

  const checks = (activation?.test_results?.checks ?? []) as Array<{
    key: string; label: string; ok: boolean; critical: boolean; skipped?: boolean; detail: string;
  }>;

  const doneCount = useMemo(
    () => steps.filter((s: any) => ["connected", "configured", "test_passed", "active"].includes(s.status)).length,
    [steps],
  );

  return (
    <SystemMindShell>
      <div className="space-y-6 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-white">Workflow Setup Wizard</h1>
            <p className="text-sm text-slate-400">
              Evidence-based setup, testing and activation for an agent's call workflow.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={agentId} onValueChange={(v) => { setAgentId(v); setExpandedStep(null); }}>
              <SelectTrigger className="w-72"><SelectValue placeholder="Select an agent build…" /></SelectTrigger>
              <SelectContent>
                {(agentsQ.data ?? []).map((a: any) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name} {a.deployed ? "· deployed" : "· not deployed"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => statusQ.refetch()} disabled={!agentId}>
              <RefreshCw className={cn("h-4 w-4", statusQ.isFetching && "animate-spin")} />
            </Button>
          </div>
        </div>

        {!agentId && (
          <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-10 text-center text-slate-400">
            Select an agent build to see its setup status.
          </div>
        )}

        {agentId && statusQ.isLoading && (
          <div className="flex items-center gap-2 text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Computing live status…</div>
        )}

        {agentId && steps.length > 0 && (
          <WizardWorkflowPath
            steps={(latestTimelineQ.data?.steps ?? []) as any[]}
            executionStatus={(execsQ.data ?? [])[0]?.status ?? null}
            triggerSummary={(triggersQ.data ?? [])
              .filter((t: any) => t.enabled)
              .map((t: any) => t.summary || t.name)
              .join("; ")}
            queueSummary={(queueQ.data ?? []).length ? `${(queueQ.data ?? []).length} queue entries` : ""}
            onRetryCrm={canApprove ? () => {
              const dead = (intErrsQ.data ?? []).find((e: any) => e.status === "dead_letter");
              if (dead) intRetryMut.mutate(dead.id);
            } : undefined}
          />
        )}

        {agentId && steps.length > 0 && (
          <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
            {/* ── Step list ── */}
            <div className="space-y-2">
              <div className="mb-1 text-xs text-slate-400">{doneCount}/{steps.length} steps complete</div>
              {steps.map((s: any, idx: number) => (
                <div key={s.key} className="rounded-lg border border-slate-800 bg-slate-900/50">
                  <button
                    className="flex w-full items-center gap-3 px-4 py-3 text-left"
                    onClick={() => setExpandedStep(expandedStep === s.key ? null : s.key)}
                  >
                    <span className="w-6 text-xs text-slate-500">{idx + 1}</span>
                    <span className="flex-1 text-sm font-medium text-slate-200">{s.label}</span>
                    <StepBadge status={s.status} />
                    {expandedStep === s.key ? <ChevronDown className="h-4 w-4 text-slate-500" /> : <ChevronRight className="h-4 w-4 text-slate-500" />}
                  </button>
                  {expandedStep === s.key && (
                    <div className="border-t border-slate-800 px-4 py-3 text-sm">
                      {s.evidence?.length > 0 && (
                        <ul className="mb-2 space-y-1">
                          {s.evidence.map((e: string, i: number) => (
                            <li key={i} className="flex items-start gap-2 text-slate-300">
                              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400/70" />{e}
                            </li>
                          ))}
                        </ul>
                      )}
                      {s.action && (
                        <div className="flex items-start gap-2 text-amber-300">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{s.action}
                        </div>
                      )}

                      {/* Field mapping (Source | Transformation | Destination) inline */}
                      {(s.key === "dynamic_variables" || s.key === "precall_data") && (
                        <WizardFieldMappingPanel agentId={agentId} />
                      )}

                      {/* Trigger editor inline (step 10) */}
                      {s.key === "call_trigger" && (
                        <div className="mt-3 space-y-2">
                          {!canApprove && (
                            <div className="flex items-start gap-2 rounded border border-sky-500/30 bg-sky-500/5 px-3 py-2 text-xs text-sky-300">
                              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />{approvalHint}
                            </div>
                          )}
                          {(triggersQ.data ?? []).map((t: any) => (
                            <div key={t.id} className="flex items-center justify-between rounded border border-slate-800 bg-slate-950/50 px-3 py-2">
                              <div className="text-xs text-slate-300">
                                <span className={cn("mr-2 font-medium", t.enabled ? "text-emerald-300" : "text-slate-500")}>
                                  {t.enabled ? "ENABLED" : "disabled"}
                                </span>
                                {t.summary || t.name}
                              </div>
                              <Button
                                size="sm" variant="outline"
                                onClick={() => trigToggleMut.mutate({ id: t.id, enabled: !t.enabled })}
                                disabled={trigToggleMut.isPending || !canApprove}
                                title={!canApprove ? approvalHint : undefined}
                              >
                                {t.enabled ? "Disable" : "Enable"}
                              </Button>
                            </div>
                          ))}
                          <div className="flex items-center gap-2">
                            <Select value={newTrigType} onValueChange={setNewTrigType}>
                              <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {TRIGGER_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                              </SelectContent>
                            </Select>
                            <Button
                              size="sm"
                              onClick={() => trigMut.mutate({
                                agentId, triggerType: newTrigType, enabled: true,
                                activationId: activation?.id ?? null,
                              })}
                              disabled={trigMut.isPending || !canApprove}
                              title={!canApprove ? approvalHint : undefined}
                            >
                              {trigMut.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Add trigger
                            </Button>
                          </div>
                        </div>
                      )}

                      {/* Queue drill-down (step 11) */}
                      {s.key === "call_queue" && (
                        <div className="mt-3 space-y-1">
                          {queueQ.isLoading && <Loader2 className="h-4 w-4 animate-spin text-slate-500" />}
                          {(queueQ.data ?? []).slice(0, 20).map((q: any) => (
                            <div key={q.id} className="flex items-center justify-between rounded border border-slate-800 bg-slate-950/50 px-3 py-1.5 text-xs">
                              <span className="text-slate-300">{q.lead_name || q.phone || q.lead_id}</span>
                              <span className="text-slate-500">{q.status}{q.status_reason ? ` — ${q.status_reason}` : ""}</span>
                              <div className="flex gap-1">
                                {["failed", "retry_scheduled"].includes(q.status) && (
                                  <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]"
                                    disabled={queueMut.isPending || !canApprove}
                                    title={!canApprove ? approvalHint : undefined}
                                    onClick={() => queueMut.mutate({ id: q.id, action: "retry_now" })}>Retry now</Button>
                                )}
                                {q.status === "paused"
                                  ? <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" disabled={queueMut.isPending || !canApprove} title={!canApprove ? approvalHint : undefined} onClick={() => queueMut.mutate({ id: q.id, action: "resume" })}>Resume</Button>
                                  : ["pending", "ready", "waiting_for_data"].includes(q.status) && (
                                    <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" disabled={queueMut.isPending || !canApprove} title={!canApprove ? approvalHint : undefined} onClick={() => queueMut.mutate({ id: q.id, action: "pause" })}>Pause</Button>
                                  )}
                              </div>
                            </div>
                          ))}
                          {queueQ.data?.length === 0 && <div className="text-xs text-slate-500">Queue is empty.</div>}
                        </div>
                      )}

                      {/* Test panel (step 13) */}
                      {s.key === "test_workflow" && (
                        <div className="mt-3 space-y-2">
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              onClick={async () => {
                                let id = activation?.id;
                                if (!id) {
                                  const draft = await draftMut.mutateAsync();
                                  id = draft?.id;
                                }
                                if (id) testMut.mutate(id);
                              }}
                              disabled={testMut.isPending || draftMut.isPending}
                            >
                              {(testMut.isPending || draftMut.isPending) && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                              <FlaskConical className="mr-1 h-3.5 w-3.5" />Run 12-check workflow test
                            </Button>
                          </div>
                          {checks.length > 0 && (
                            <div className="space-y-1">
                              {checks.map((c) => (
                                <div key={c.key} className="flex items-start gap-2 rounded border border-slate-800 bg-slate-950/50 px-3 py-1.5 text-xs">
                                  {c.skipped
                                    ? <Circle className="mt-0.5 h-3.5 w-3.5 text-slate-500" />
                                    : c.ok
                                      ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 text-emerald-400" />
                                      : <XCircle className={cn("mt-0.5 h-3.5 w-3.5", c.critical ? "text-red-400" : "text-amber-400")} />}
                                  <div>
                                    <span className="font-medium text-slate-200">{c.label}</span>
                                    {c.critical && !c.ok && !c.skipped && <span className="ml-1 text-[10px] text-red-400">(critical)</span>}
                                    <div className="text-slate-400">{c.detail}</div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Activate (step 14) */}
                      {s.key === "activate" && activation && activation.status !== "active" && (
                        <div className="mt-3 space-y-2">
                          {!canApprove && (
                            <div className="flex items-start gap-2 rounded border border-sky-500/30 bg-sky-500/5 px-3 py-2 text-xs text-sky-300">
                              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />{approvalHint}
                            </div>
                          )}
                          <Button
                            size="sm"
                            onClick={() => activateMut.mutate({ activationId: activation.id })}
                            disabled={activateMut.isPending || !canApprove}
                            title={!canApprove ? approvalHint : undefined}
                          >
                            {activateMut.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                            <PlayCircle className="mr-1 h-3.5 w-3.5" />Activate version {activation.version_number}
                          </Button>
                          {showOverride && (
                            <div className="rounded border border-amber-500/30 bg-amber-500/5 p-3">
                              <div className="mb-2 flex items-center gap-2 text-xs font-medium text-amber-300">
                                <ShieldAlert className="h-4 w-4" />Admin override — activation without passing tests is logged.
                              </div>
                              <Textarea
                                value={overrideReason}
                                onChange={(e) => setOverrideReason(e.target.value)}
                                placeholder="Reason for overriding the test gate (required, logged)…"
                                className="mb-2 text-xs"
                              />
                              <Button
                                size="sm" variant="destructive"
                                disabled={!overrideReason.trim() || activateMut.isPending || !canApprove}
                                onClick={() => activateMut.mutate({ activationId: activation.id, overrideReason: overrideReason.trim() })}
                              >
                                Override & activate
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* ── Right column: health, versions, executions ── */}
            <div className="space-y-4">
              {/* Health */}
              {activation?.status === "active" && (
                <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-medium text-slate-200">
                      <Activity className="h-4 w-4" />Health
                    </div>
                    <Badge variant="outline" className={cn("text-[10px]", HEALTH_CLS[healthQ.data?.status ?? activation.health_status ?? "unknown"])}>
                      {(healthQ.data?.status ?? activation.health_status ?? "unknown").toUpperCase()}
                    </Badge>
                  </div>
                  <ul className="space-y-1 text-xs">
                    {(healthQ.data?.checks ?? []).map((c: any, i: number) => (
                      <li key={i} className="flex items-start gap-2">
                        {c.ok ? <CheckCircle2 className="mt-0.5 h-3 w-3 text-emerald-400" /> : <AlertTriangle className="mt-0.5 h-3 w-3 text-amber-400" />}
                        <span className="text-slate-300">{c.label}: <span className="text-slate-400">{c.detail}</span></span>
                        {!c.ok && c.recommendedAction && <span className="text-amber-300"> → {c.recommendedAction}</span>}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => stateMut.mutate({ activationId: activation.id, action: "pause" })} disabled={stateMut.isPending || !canApprove} title={!canApprove ? approvalHint : undefined}>
                      <PauseCircle className="mr-1 h-3.5 w-3.5" />Pause
                    </Button>
                    {activation.parent_activation_id && (
                      <Button size="sm" variant="outline" onClick={() => stateMut.mutate({ activationId: activation.id, action: "rollback" })} disabled={stateMut.isPending || !canApprove} title={!canApprove ? approvalHint : undefined}>
                        <RotateCcw className="mr-1 h-3.5 w-3.5" />Roll back
                      </Button>
                    )}
                  </div>
                  {!canApprove && (
                    <div className="mt-2 flex items-start gap-2 text-[11px] text-sky-300">
                      <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />{approvalHint}
                    </div>
                  )}
                </div>
              )}
              {activation?.status === "paused" && (
                <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
                  <div className="mb-2 text-sm font-medium text-slate-200">Workflow paused</div>
                  <Button size="sm" onClick={() => stateMut.mutate({ activationId: activation.id, action: "resume" })} disabled={stateMut.isPending || !canApprove} title={!canApprove ? approvalHint : undefined}>
                    <PlayCircle className="mr-1 h-3.5 w-3.5" />Resume
                  </Button>
                  {!canApprove && (
                    <div className="mt-2 flex items-start gap-2 text-[11px] text-sky-300">
                      <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />{approvalHint}
                    </div>
                  )}
                </div>
              )}

              {/* Versions */}
              <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium text-slate-200">
                    <ListOrdered className="h-4 w-4" />Versions
                  </div>
                  <Button size="sm" variant="outline" onClick={() => draftMut.mutate()} disabled={draftMut.isPending}>
                    {draftMut.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}New draft
                  </Button>
                </div>
                <div className="space-y-1">
                  {(versionsQ.data ?? []).map((v: any) => (
                    <div key={v.id} className="flex items-center justify-between rounded border border-slate-800 bg-slate-950/50 px-3 py-1.5 text-xs">
                      <span className="text-slate-300">v{v.version_number} · {v.status}{v.admin_override ? " · OVERRIDE" : ""}</span>
                      <span className="text-slate-500">
                        {v.test_passed === true ? "tests passed" : v.test_passed === false ? "tests failed" : "untested"}
                      </span>
                    </div>
                  ))}
                  {versionsQ.data?.length === 0 && <div className="text-xs text-slate-500">No versions yet — run a test to create the first draft.</div>}
                </div>
              </div>

              {/* Integration errors */}
              {(intErrsQ.data?.length ?? 0) > 0 && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4">
                  <div className="mb-2 text-sm font-medium text-red-300">Integration errors</div>
                  <div className="space-y-1">
                    {(intErrsQ.data ?? []).slice(0, 10).map((e: any) => (
                      <div key={e.id} className="flex items-center justify-between rounded border border-slate-800 bg-slate-950/50 px-3 py-1.5 text-xs">
                        <span className="text-slate-300">{e.kind}: <span className="text-slate-400">{String(e.error).slice(0, 60)}</span> ({e.status})</span>
                        <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" disabled={intRetryMut.isPending || !canApprove} title={!canApprove ? approvalHint : undefined} onClick={() => intRetryMut.mutate(e.id)}>Retry</Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Execution timeline */}
              <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-200">
                  <PhoneCall className="h-4 w-4" />Recent executions
                </div>
                <div className="space-y-1">
                  {(execsQ.data ?? []).map((ex: any) => (
                    <div key={ex.id}>
                      <button
                        className="flex w-full items-center justify-between rounded border border-slate-800 bg-slate-950/50 px-3 py-1.5 text-left text-xs hover:bg-slate-900"
                        onClick={() => setSelectedExecId(selectedExecId === ex.id ? null : ex.id)}
                      >
                        <span className="text-slate-300">{ex.kind} · {ex.status}</span>
                        <span className="text-slate-500">{new Date(ex.started_at).toLocaleString("en-GB")}</span>
                      </button>
                      {selectedExecId === ex.id && (
                        <div className="mt-1 space-y-1 pl-2">
                          {timelineQ.isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-500" />}
                          {(timelineQ.data?.steps ?? []).map((st: any) => (
                            <div key={st.id} className="rounded border border-slate-800 bg-slate-950/70 px-3 py-1.5 text-[11px]">
                              <div className="flex items-center gap-2">
                                {st.status === "completed" ? <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                                  : st.status === "failed" ? <XCircle className="h-3 w-3 text-red-400" />
                                  : <Circle className="h-3 w-3 text-slate-500" />}
                                <span className="font-medium text-slate-200">{st.step_label || st.step_key}</span>
                                <span className="text-slate-500">{st.status}</span>
                              </div>
                              {st.error && <div className="mt-0.5 text-red-300">{st.error}{st.resolution_hint ? ` — ${st.resolution_hint}` : ""}</div>}
                            </div>
                          ))}
                          {ex.error && <div className="text-[11px] text-red-300">{ex.error}</div>}
                        </div>
                      )}
                    </div>
                  ))}
                  {execsQ.data?.length === 0 && <div className="text-xs text-slate-500">No executions yet.</div>}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </SystemMindShell>
  );
}
