// ── SystemMind Build Session View ──────────────────────────────────────────────
// The full session workspace (chat + step tabs + apply safety flow), extracted
// from SystemMindBuildWorkspacePage so it can render BOTH on the full
// /systemmind/build page AND inside the Agent Builder right-side drawer.
// Step tabs: Brief → Requirements → Variables → CRM Mapping → Workflow → Test
// → Review → Apply, plus Versions / Usage / Conversion.

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Loader2, Send, Archive, ArchiveRestore, History,
  FlaskConical, FileCode2, Gauge, RotateCcw, CheckCircle2, AlertTriangle,
  ShieldAlert, Rocket, GitBranch, Variable, ListChecks, Bell, StickyNote,
  ArrowRight, Bot, Workflow as WorkflowIcon, ExternalLink, ShieldCheck,
  Undo2, GitCompareArrows, FilePlus2, Copy, SendToBack, Import, Info,
  ClipboardList, Lightbulb, Table2, Eye, Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DeploymentChecklistPanel } from "./DeploymentChecklistPanel";
import { TestCallPanel } from "./TestCallPanel";
import { RequirementsPanel } from "./RequirementsPanel";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  getBuildSession, promptBuildSession,
  simulateBuildVersion, applyBuildVersion, restoreBuildVersion, deleteBuildSession,
  setBuildVersionNotes, setBuildSessionArchived, markBuildVersionDeployed,
  getSystemMindUsageSummary, getBuildApplySafetyReport, rollbackBuildApply,
} from "@/lib/systemmind/build-workspace.functions";
import { listWebformSources } from "@/lib/lead-gen/webforms.functions";
import { getConversionForSession } from "@/lib/systemmind/legacy-conversion.functions";
import { goLiveAgent } from "@/lib/agents/agents.functions";

// ── Example prompts ────────────────────────────────────────────────────────────

const STARTER_PROMPTS = [
  "Build a receptionist agent that answers calls, books appointments into the Calendar and saves caller details to Leads.",
  "Build a lead qualification workflow that asks budget, timeline and location, then saves qualified leads to Qualified.",
  "Build a rebooking workflow that calls back missed appointments and reschedules them into the Calendar.",
  "Build a WhatsApp follow-up workflow that messages new leads within 5 minutes and books a discovery call.",
];

const ITERATION_PROMPTS = [
  "Add a WhatsApp follow-up step after the call ends",
  "Ask for the caller's budget and make it a required field",
  "Map the captured fields to Leads and Qualified",
  "Make the script shorter and the tone friendlier",
  "Add a voicemail branch that sends an SMS instead",
];

// ── Live build progress steps ──────────────────────────────────────────────────
// Shown while SystemMind is generating. The steps advance on a timer (the server
// call is a single request, so this narrates the phases the generator goes
// through); the final step stays "in progress" until the response lands.

const BUILD_PHASES_FIRST = [
  "Reading your request",
  "Detecting workflow type & trigger",
  "Designing the workflow steps",
  "Writing the agent script",
  "Defining variables & captured fields",
  "Mapping fields to the CRM",
  "Running safety & risk checks",
  "Creating version v1",
];

const BUILD_PHASES_REVISION = [
  "Reading your change request",
  "Comparing against the current version",
  "Updating the workflow steps",
  "Rewriting the affected script sections",
  "Refreshing variables & CRM mappings",
  "Running safety & risk checks",
  "Creating the new version",
];

function BuildProgress({ phases }: { phases: string[] }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    setStep(0);
    const t = setInterval(
      () => setStep((s) => Math.min(s + 1, phases.length - 1)),
      2200,
    );
    return () => clearInterval(t);
  }, [phases]);
  return (
    <div className="max-w-[85%] space-y-1.5 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5">
      <p className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
        SystemMind is building
      </p>
      {phases.map((p, i) => (
        <div key={p} className="flex items-center gap-2">
          {i < step ? (
            <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-400" />
          ) : i === step ? (
            <Loader2 className="h-3 w-3 shrink-0 animate-spin text-sky-300" />
          ) : (
            <span className="h-3 w-3 shrink-0 rounded-full border border-white/[0.12]" />
          )}
          <p className={cn(
            "text-[11px]",
            i < step && "text-muted-foreground",
            i === step && "text-foreground",
            i > step && "text-muted-foreground/50",
          )}>
            {p}
          </p>
        </div>
      ))}
    </div>
  );
}

// ── Small bits ─────────────────────────────────────────────────────────────────

export function RiskBadge({ risk }: { risk?: string | null }) {
  if (!risk) return null;
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-[10px] font-semibold",
        risk === "high"   && "border-red-500/40   text-red-400",
        risk === "medium" && "border-amber-500/40 text-amber-400",
        risk === "low"    && "border-green-500/40 text-green-400",
      )}
    >
      {risk} risk
    </Badge>
  );
}

const STATUS_STYLES: Record<string, string> = {
  draft:            "border-white/20 text-muted-foreground",
  testing:          "border-sky-500/40 text-sky-400",
  revised:          "border-white/15 text-muted-foreground/70",
  pending_approval: "border-amber-500/40 text-amber-400",
  applied:          "border-green-500/40 text-green-400",
  deployed:         "border-emerald-500/50 text-emerald-300",
  rejected:         "border-red-500/40 text-red-400",
  archived:         "border-white/15 text-muted-foreground/60",
};

export function StatusBadge({ status }: { status?: string | null }) {
  if (!status) return null;
  return (
    <Badge variant="outline" className={cn("text-[10px]", STATUS_STYLES[status] ?? "border-white/20")}>
      {status.replace(/_/g, " ")}
    </Badge>
  );
}

export function fmtTime(iso?: string | null) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleString(); } catch { return ""; }
}

export function fmtMs(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

// ── Config preview ──────────────────────────────────────────────────────────────

function Section({ icon: Icon, title, children }: { icon: React.ElementType; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 space-y-2">
      <div className="flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 text-sky-400" />
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      </div>
      {children}
    </div>
  );
}

function ConfigPreview({ config }: { config: Record<string, any> }) {
  const wf     = config.workflow ?? {};
  const steps  = (wf.steps ?? []) as any[];
  const vars   = (config.variables ?? []) as any[];
  const fields = (config.extraction_fields ?? []) as any[];
  const rules  = (config.follow_up_rules ?? []) as any[];
  const creds  = (config.required_credentials ?? []) as string[];
  const risks  = (config.risks ?? []) as string[];
  const tests  = (config.test_plan ?? []) as string[];
  const chan   = (config.channel_setup ?? {}) as Record<string, string>;

  return (
    <div className="space-y-3">
      <Section icon={WorkflowIcon} title={`Workflow — ${wf.name ?? "Unnamed"}`}>
        <p className="text-[11px] text-muted-foreground">{wf.purpose}</p>
        <p className="text-[10px] text-muted-foreground/70">Trigger: <span className="text-sky-300">{wf.trigger_type}</span></p>
        <div className="space-y-1">
          {steps.map((s: any) => (
            <div key={s.id} className="flex items-start gap-2 rounded border border-white/[0.05] bg-white/[0.02] px-2 py-1.5">
              <Badge variant="secondary" className="text-[9px] shrink-0 mt-0.5">{s.id}</Badge>
              <div className="min-w-0">
                <p className="text-[11px] font-medium">{s.type}{s.title ? ` — ${s.title}` : ""}{s.status ? ` → ${s.status}` : ""}{s.template ? ` (${s.template})` : ""}</p>
                {s.type === "branch" && (s.conditions ?? []).map((c: any, i: number) => (
                  <p key={i} className="text-[10px] text-muted-foreground">if {c.field} {c.op} {String(c.value)} → {c.next}</p>
                ))}
                {s.next && <p className="text-[10px] text-muted-foreground/60">next → {s.next}</p>}
              </div>
            </div>
          ))}
        </div>
      </Section>

      {config.agent_prompt ? (
        <Section icon={Bot} title="Agent prompt">
          <pre className="whitespace-pre-wrap text-[11px] leading-relaxed text-foreground/85 max-h-64 overflow-y-auto">{config.agent_prompt}</pre>
        </Section>
      ) : null}

      {(vars.length > 0 || fields.length > 0) && (
        <Section icon={Variable} title="Variables & extraction">
          {vars.map((v: any, i: number) => (
            <p key={`v${i}`} className="text-[11px]"><span className="font-medium">{v.name}</span> <span className="text-muted-foreground">— {v.source ?? v.description ?? "runtime"}</span></p>
          ))}
          {fields.map((f: any, i: number) => (
            <p key={`f${i}`} className="text-[11px]"><span className="font-medium">{f.name}</span> <span className="text-muted-foreground">— extracted from conversation</span></p>
          ))}
        </Section>
      )}

      {rules.length > 0 && (
        <Section icon={Bell} title="Follow-up rules">
          {rules.map((r: any, i: number) => (
            <p key={i} className="text-[11px] text-muted-foreground">
              <span className="text-foreground">{r.trigger}</span> → {r.action}
              {r.delay_hours ? ` (after ${r.delay_hours}h)` : ""}{r.channel ? ` via ${r.channel}` : ""}
            </p>
          ))}
        </Section>
      )}

      {(Object.keys(chan).length > 0 || creds.length > 0) && (
        <Section icon={ShieldAlert} title="Setup requirements">
          {Object.entries(chan).map(([k, v]) => (
            <p key={k} className="text-[11px]"><span className="font-medium capitalize">{k}:</span> <span className="text-muted-foreground">{String(v)}</span></p>
          ))}
          {creds.map((c, i) => (
            <p key={i} className="text-[11px] text-amber-300/90">Credential needed: {c} <span className="text-muted-foreground">(enter in WEBEE settings — never here)</span></p>
          ))}
        </Section>
      )}

      {risks.length > 0 && (
        <Section icon={AlertTriangle} title="Risks">
          {risks.map((r, i) => <p key={i} className="text-[11px] text-amber-300/90">{r}</p>)}
        </Section>
      )}

      {tests.length > 0 && (
        <Section icon={ListChecks} title="Test plan">
          {tests.map((t, i) => <p key={i} className="text-[11px] text-muted-foreground">{i + 1}. {t}</p>)}
        </Section>
      )}
    </div>
  );
}

// ── Version-to-version change summary + visual flow diagram ────────────────────

export type ConfigDiffLine = {
  kind: "added" | "removed" | "changed";
  label: string;
};

export type ConfigDiff = {
  lines:        ConfigDiffLine[];
  addedSteps:   Set<string>;
  changedSteps: Set<string>;
};

function stepFingerprint(s: any): string {
  return JSON.stringify({
    type: s.type, title: s.title ?? null, status: s.status ?? null,
    template: s.template ?? null, next: s.next ?? null,
    conditions: s.conditions ?? null, config: s.config ?? null,
  });
}

export function diffBuildConfigs(
  prev: Record<string, any> | null,
  next: Record<string, any>,
): ConfigDiff {
  const lines: ConfigDiffLine[] = [];
  const addedSteps   = new Set<string>();
  const changedSteps = new Set<string>();
  const pWf = (prev?.workflow ?? {}) as Record<string, any>;
  const nWf = (next.workflow ?? {}) as Record<string, any>;

  if (!prev) {
    lines.push({ kind: "added", label: `Workflow "${nWf.name ?? "Unnamed"}" created with ${(nWf.steps ?? []).length} step(s)` });
    for (const s of (nWf.steps ?? []) as any[]) addedSteps.add(String(s.id));
    return { lines, addedSteps, changedSteps };
  }

  if ((pWf.name ?? "") !== (nWf.name ?? "")) {
    lines.push({ kind: "changed", label: `Workflow renamed "${pWf.name ?? "?"}" → "${nWf.name ?? "?"}"` });
  }
  if ((pWf.trigger_type ?? "") !== (nWf.trigger_type ?? "")) {
    lines.push({ kind: "changed", label: `Trigger changed ${pWf.trigger_type ?? "none"} → ${nWf.trigger_type ?? "none"}` });
  }

  const pSteps = new Map(((pWf.steps ?? []) as any[]).map((s) => [String(s.id), s]));
  const nSteps = new Map(((nWf.steps ?? []) as any[]).map((s) => [String(s.id), s]));
  for (const [id, s] of nSteps) {
    const old = pSteps.get(id);
    if (!old) {
      addedSteps.add(id);
      lines.push({ kind: "added", label: `Step "${s.title ?? s.type}" (${s.type})` });
    } else if (stepFingerprint(old) !== stepFingerprint(s)) {
      changedSteps.add(id);
      lines.push({ kind: "changed", label: `Step "${s.title ?? s.type}" (${s.type}) updated` });
    }
  }
  for (const [id, s] of pSteps) {
    if (!nSteps.has(id)) lines.push({ kind: "removed", label: `Step "${s.title ?? s.type}" (${s.type})` });
  }

  if ((prev.agent_prompt ?? "") !== (next.agent_prompt ?? "")) {
    lines.push({ kind: "changed", label: "Agent prompt rewritten" });
  }

  const nameOf = (v: any) => String(v?.name ?? v?.key ?? "unnamed");
  const diffNamed = (a: any[], b: any[], noun: string) => {
    const aSet = new Set(a.map(nameOf));
    const bSet = new Set(b.map(nameOf));
    for (const n of bSet) if (!aSet.has(n)) lines.push({ kind: "added", label: `${noun} "${n}"` });
    for (const n of aSet) if (!bSet.has(n)) lines.push({ kind: "removed", label: `${noun} "${n}"` });
  };
  diffNamed((prev.variables ?? []) as any[], (next.variables ?? []) as any[], "Variable");
  diffNamed((prev.extraction_fields ?? []) as any[], (next.extraction_fields ?? []) as any[], "Extraction field");

  const pRules = JSON.stringify(prev.follow_up_rules ?? []);
  const nRules = JSON.stringify(next.follow_up_rules ?? []);
  if (pRules !== nRules) {
    const pCount = ((prev.follow_up_rules ?? []) as any[]).length;
    const nCount = ((next.follow_up_rules ?? []) as any[]).length;
    lines.push({ kind: "changed", label: `Follow-up rules updated (${pCount} → ${nCount})` });
  }

  return { lines, addedSteps, changedSteps };
}

const DIFF_KIND_STYLES: Record<string, string> = {
  added:   "text-emerald-400",
  removed: "text-red-400",
  changed: "text-amber-400",
};

export function ChangeSummary({
  diff, versionNumber, compact = false,
}: { diff: ConfigDiff; versionNumber: number; compact?: boolean }) {
  if (diff.lines.length === 0) {
    return compact ? null : (
      <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
        <p className="text-[11px] text-muted-foreground">
          v{versionNumber}: no structural changes detected against the previous version
          (wording-only or metadata tweaks).
        </p>
      </div>
    );
  }
  const body = (
    <div className={cn("space-y-0.5", compact && "max-h-24 overflow-y-auto")}>
      {diff.lines.map((l, i) => (
        <p key={i} className="text-[11px] text-muted-foreground">
          <span className={cn("mr-1 font-semibold", DIFF_KIND_STYLES[l.kind])}>{l.kind}</span>
          {l.label}
        </p>
      ))}
    </div>
  );
  if (compact) return body;
  return (
    <div className="rounded-lg border border-sky-500/20 bg-sky-500/[0.04] p-3 space-y-2">
      <div className="flex items-center gap-1.5">
        <GitCompareArrows className="h-3.5 w-3.5 text-sky-400" />
        <p className="text-[11px] font-semibold uppercase tracking-wide text-sky-300">
          What changed in v{versionNumber}
        </p>
      </div>
      {body}
    </div>
  );
}

// Visual representation of the generated workflow: an ordered flow of step
// nodes with branch fan-outs. Steps added/changed in the latest version are
// highlighted so you can SEE what each prompt did.
export function WorkflowFlowDiagram({
  config, addedSteps, changedSteps,
}: {
  config: Record<string, any>;
  addedSteps?: Set<string>;
  changedSteps?: Set<string>;
}) {
  const steps = ((config.workflow?.steps ?? []) as any[]);
  if (steps.length === 0) {
    return <p className="py-8 text-center text-[11px] text-muted-foreground">No steps to draw yet.</p>;
  }
  const titleOf = (id: string) => {
    const s = steps.find((x) => String(x.id) === String(id));
    return s ? (s.title ?? s.type) : id;
  };
  return (
    <div className="space-y-0">
      <div className="mb-3 flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full border border-emerald-500/60 bg-emerald-500/20" /> new this version</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full border border-amber-500/60 bg-amber-500/20" /> changed this version</span>
      </div>
      {steps.map((s: any, i: number) => {
        const id = String(s.id);
        const isAdded   = addedSteps?.has(id);
        const isChanged = !isAdded && changedSteps?.has(id);
        const conditions = (s.conditions ?? []) as any[];
        return (
          <div key={id} className="flex flex-col items-center">
            <div
              className={cn(
                "w-full max-w-md rounded-lg border px-3 py-2",
                isAdded
                  ? "border-emerald-500/50 bg-emerald-500/[0.07]"
                  : isChanged
                    ? "border-amber-500/50 bg-amber-500/[0.07]"
                    : s.type === "trigger"
                      ? "border-sky-500/40 bg-sky-500/[0.06]"
                      : s.type === "branch"
                        ? "border-violet-500/40 bg-violet-500/[0.05]"
                        : "border-white/[0.08] bg-white/[0.03]",
              )}
            >
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-[9px] shrink-0">{id}</Badge>
                <p className="min-w-0 truncate text-[11px] font-medium">
                  {s.title ?? s.type}
                </p>
                <Badge variant="outline" className="ml-auto shrink-0 text-[9px] font-mono">{s.type}</Badge>
                {isAdded   && <Badge variant="outline" className="shrink-0 border-emerald-500/50 text-[9px] text-emerald-300">new</Badge>}
                {isChanged && <Badge variant="outline" className="shrink-0 border-amber-500/50 text-[9px] text-amber-300">changed</Badge>}
              </div>
              {s.status && <p className="mt-0.5 text-[10px] text-muted-foreground">sets status → {s.status}</p>}
              {s.template && <p className="mt-0.5 text-[10px] text-muted-foreground">template: {s.template}</p>}
              {s.type === "branch" && conditions.length > 0 && (
                <div className="mt-1.5 space-y-1 border-t border-white/[0.06] pt-1.5">
                  {conditions.map((c: any, ci: number) => (
                    <p key={ci} className="flex items-center gap-1 text-[10px] text-violet-200/80">
                      <GitBranch className="h-2.5 w-2.5 shrink-0" />
                      if {c.field} {c.op} {String(c.value)}
                      <ArrowRight className="h-2.5 w-2.5 shrink-0 text-muted-foreground/60" />
                      <span className="truncate text-foreground/80">{titleOf(String(c.next))}</span>
                    </p>
                  ))}
                </div>
              )}
              {s.next && (
                <p className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground/70">
                  <ArrowRight className="h-2.5 w-2.5" /> then: <span className="text-foreground/70">{titleOf(String(s.next))}</span>
                </p>
              )}
            </div>
            {i < steps.length - 1 && (
              <div className="my-0.5 flex h-4 items-center justify-center">
                <div className="h-full w-px bg-white/[0.15]" />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Simulation panel ────────────────────────────────────────────────────────────

function SimulationView({ sim }: { sim: Record<string, any> }) {
  return (
    <div className="space-y-3">
      <div className={cn(
        "flex items-center gap-2 rounded-lg border p-3",
        sim.ok ? "border-green-500/30 bg-green-500/[0.05]" : "border-amber-500/30 bg-amber-500/[0.05]",
      )}>
        {sim.ok
          ? <CheckCircle2 className="h-4 w-4 text-green-400" />
          : <AlertTriangle className="h-4 w-4 text-amber-400" />}
        <p className="text-xs font-medium">
          {sim.ok
            ? `Simulation passed — ${sim.stepCount} steps, ${sim.paths?.length ?? 0} path(s), no warnings.`
            : `Simulation found ${(sim.warnings?.length ?? 0)} warning(s) and ${(sim.missingSetup?.length ?? 0)} setup gap(s).`}
        </p>
      </div>

      {(sim.paths ?? []).map((p: any, i: number) => (
        <Section key={i} icon={GitBranch} title={p.label}>
          <div className="flex flex-wrap items-center gap-1">
            {p.steps.map((s: any, j: number) => (
              <span key={j} className="inline-flex items-center gap-1">
                <span className="rounded bg-white/[0.05] border border-white/[0.06] px-1.5 py-0.5 text-[10px]" title={s.description}>
                  {s.type}
                </span>
                {j < p.steps.length - 1 && <ArrowRight className="h-2.5 w-2.5 text-muted-foreground/50" />}
              </span>
            ))}
          </div>
        </Section>
      ))}

      {(sim.actionsTriggered ?? []).length > 0 && (
        <Section icon={ListChecks} title="Actions that would trigger">
          {sim.actionsTriggered.map((a: string, i: number) => <p key={i} className="text-[11px] text-muted-foreground">• {a}</p>)}
        </Section>
      )}

      {(sim.variables ?? []).length > 0 && (
        <Section icon={Variable} title="Variables captured">
          {sim.variables.map((v: any, i: number) => (
            <p key={i} className="text-[11px]"><span className="font-medium">{v.name}</span> <span className="text-muted-foreground">— {v.source}</span></p>
          ))}
        </Section>
      )}

      {(sim.warnings ?? []).length > 0 && (
        <Section icon={AlertTriangle} title="Warnings">
          {sim.warnings.map((w: string, i: number) => <p key={i} className="text-[11px] text-amber-300/90">{w}</p>)}
        </Section>
      )}

      {(sim.missingSetup ?? []).length > 0 && (
        <Section icon={ShieldAlert} title="Missing setup">
          {sim.missingSetup.map((m: string, i: number) => <p key={i} className="text-[11px] text-red-300/90">{m}</p>)}
        </Section>
      )}
    </div>
  );
}

// ── Conversion report (Legacy Logic Converter) ─────────────────────────────────

const SOURCE_TYPE_LABELS: Record<string, string> = {
  agent:              "Existing agent",
  workflow:           "Existing WEBEE workflow",
  n8n:                "n8n workflow",
  hexmail_sequence:   "Email follow-up sequence",
  wati_setup:         "WATI WhatsApp campaign",
  webform_auto_call:  "Webform + auto-call setup",
  manual_description: "Described process",
};

const FIDELITY_STYLES: Record<string, string> = {
  full:     "border-green-500/40 text-green-400",
  partial:  "border-amber-500/40 text-amber-400",
  assisted: "border-sky-500/40 text-sky-400",
};

function ConversionReportView({ conversion }: { conversion: Record<string, any> }) {
  const r = (conversion.report ?? {}) as Record<string, any>;
  const converted   = (r.converted ?? []) as Array<{ from: string; to: string }>;
  const unsupported = (r.unsupported ?? []) as Array<{ item: string; reason: string }>;
  const warnings    = (r.warnings ?? []) as string[];
  const assumptions = (r.assumptions ?? []) as string[];
  const deps        = (r.provider_dependencies ?? []) as string[];
  const testPlan    = (r.test_plan ?? []) as string[];
  const fidelity    = String(conversion.fidelity ?? r.fidelity ?? "partial");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
        <Import className="h-4 w-4 text-sky-400" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold">
            Converted from {SOURCE_TYPE_LABELS[String(conversion.source_type)] ?? conversion.source_type}
            {conversion.source_name ? ` — “${conversion.source_name}”` : ""}
          </p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            {fmtTime(conversion.created_at)} · original untouched — nothing goes live until Apply
          </p>
        </div>
        <Badge variant="outline" className={cn("text-[10px] font-semibold", FIDELITY_STYLES[fidelity] ?? "border-white/20")}>
          {fidelity === "full" ? "full fidelity" : fidelity === "partial" ? "partial fidelity" : "AI-assisted"}
        </Badge>
        <RiskBadge risk={conversion.risk_level ?? r.risk_level} />
      </div>

      {r.original_summary && (
        <Section icon={Info} title="What the original did">
          <p className="text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap">{r.original_summary}</p>
          {r.detected_trigger && (
            <p className="text-[10px] text-muted-foreground/70">Trigger detected: <span className="text-sky-300">{r.detected_trigger}</span></p>
          )}
        </Section>
      )}

      {converted.length > 0 && (
        <Section icon={CheckCircle2} title={`Converted (${converted.length})`}>
          {converted.map((c, i) => (
            <p key={i} className="flex items-start gap-1.5 text-[11px]">
              <span className="text-muted-foreground truncate max-w-[45%]" title={c.from}>{c.from}</span>
              <ArrowRight className="mt-0.5 h-2.5 w-2.5 shrink-0 text-muted-foreground/50" />
              <span className="text-green-300/90">{c.to}</span>
            </p>
          ))}
        </Section>
      )}

      {unsupported.length > 0 && (
        <Section icon={AlertTriangle} title={`Needs manual review (${unsupported.length})`}>
          {unsupported.map((u, i) => (
            <div key={i} className="rounded border border-amber-500/20 bg-amber-500/[0.04] px-2 py-1.5">
              <p className="text-[11px] font-medium text-amber-200/90">{u.item}</p>
              <p className="text-[10px] text-muted-foreground">{u.reason}</p>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground/70">
            A review task has been added to the HiveMind action centre for these items.
          </p>
        </Section>
      )}

      {warnings.length > 0 && (
        <Section icon={ShieldAlert} title="Warnings">
          {warnings.map((w, i) => <p key={i} className="text-[11px] text-amber-300/90">{w}</p>)}
        </Section>
      )}

      {assumptions.length > 0 && (
        <Section icon={StickyNote} title="Assumptions made">
          {assumptions.map((a, i) => <p key={i} className="text-[11px] text-muted-foreground">• {a}</p>)}
        </Section>
      )}

      {deps.length > 0 && (
        <Section icon={ShieldAlert} title="Provider dependencies">
          {deps.map((d, i) => <p key={i} className="text-[11px] text-muted-foreground">• {d}</p>)}
        </Section>
      )}

      {testPlan.length > 0 && (
        <Section icon={ListChecks} title="Suggested test plan">
          {testPlan.map((t, i) => <p key={i} className="text-[11px] text-muted-foreground">{i + 1}. {t}</p>)}
        </Section>
      )}
    </div>
  );
}

// ── Step panels (Brief / Variables / CRM Mapping / Review) ─────────────────────

function BriefPanel({
  messages, currentVersion, config,
}: {
  messages: any[]; currentVersion: any | null; config: Record<string, any> | null;
}) {
  const firstUserMsg = messages.find((m) => m.role === "user");
  const wf = (config?.workflow ?? {}) as Record<string, any>;
  const creds = (config?.required_credentials ?? []) as string[];
  const risks = (config?.risks ?? []) as string[];

  if (!firstUserMsg && !currentVersion) {
    return (
      <p className="py-8 text-center text-[11px] text-muted-foreground">
        Nothing here yet — tell SystemMind what to build in the chat and the brief will fill in.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {firstUserMsg && (
        <Section icon={Lightbulb} title="Your original request">
          <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-foreground/90">{firstUserMsg.content}</p>
        </Section>
      )}
      {currentVersion?.assistant_summary && (
        <Section icon={Bot} title="What SystemMind understood">
          <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-muted-foreground">{currentVersion.assistant_summary}</p>
        </Section>
      )}
      {(wf.purpose || wf.trigger_type || wf.name) && (
        <Section icon={WorkflowIcon} title="Detected purpose & workflow type">
          {wf.name && <p className="text-[11px]"><span className="font-medium">Workflow:</span> {wf.name}</p>}
          {wf.purpose && <p className="text-[11px] text-muted-foreground">{wf.purpose}</p>}
          {wf.trigger_type && (
            <p className="text-[10px] text-muted-foreground/70">Recommended trigger: <span className="text-sky-300">{wf.trigger_type}</span></p>
          )}
        </Section>
      )}
      {currentVersion && (
        <Section icon={ShieldCheck} title="Current state">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-muted-foreground">Version v{currentVersion.version_number}</span>
            <StatusBadge status={currentVersion.status} />
            <RiskBadge risk={currentVersion.risk_level} />
          </div>
          {Array.isArray(currentVersion.risk_reasons) && currentVersion.risk_reasons.length > 0 && (
            <p className="text-[10px] text-amber-300/80">{currentVersion.risk_reasons.join(" · ")}</p>
          )}
        </Section>
      )}
      {(creds.length > 0 || risks.length > 0) && (
        <Section icon={AlertTriangle} title="Missing information / open points">
          {creds.map((c, i) => <p key={`c${i}`} className="text-[11px] text-amber-300/90">Credential needed: {c}</p>)}
          {risks.map((r, i) => <p key={`r${i}`} className="text-[11px] text-amber-300/90">{r}</p>)}
          {creds.length === 0 && risks.length === 0 && (
            <p className="text-[11px] text-muted-foreground">Nothing outstanding.</p>
          )}
        </Section>
      )}
    </div>
  );
}

function VariablesPanel({ config }: { config: Record<string, any> | null }) {
  const vars   = (config?.variables ?? []) as any[];
  const fields = (config?.extraction_fields ?? []) as any[];
  if (vars.length === 0 && fields.length === 0) {
    return (
      <p className="py-8 text-center text-[11px] text-muted-foreground">
        No variables detected yet. Generate a version first (chat or the Requirements step),
        then the detected variables appear here.
      </p>
    );
  }
  const row = (v: any, kind: "variable" | "extracted", i: number) => (
    <div key={`${kind}${i}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-2">
      <Variable className="h-3 w-3 shrink-0 text-sky-300" />
      <p className="text-[11px] font-medium">{v.name ?? v.key ?? "unnamed"}</p>
      <Badge variant="secondary" className="text-[9px]">{kind === "variable" ? "runtime variable" : "extracted from call"}</Badge>
      {v.type && <Badge variant="outline" className="text-[9px]">{String(v.type)}</Badge>}
      {(v.required === true || v.required === false) && (
        <Badge variant="outline" className={cn("text-[9px]", v.required ? "border-amber-500/40 text-amber-300" : "text-muted-foreground")}>
          {v.required ? "required" : "optional"}
        </Badge>
      )}
      <span className="ml-auto text-[10px] text-muted-foreground">
        {v.source ?? v.description ?? (kind === "extracted" ? "post-call extraction" : "runtime")}
        {(v.crm_destination || v.destination || v.maps_to) ? ` → ${v.crm_destination ?? v.destination ?? v.maps_to}` : ""}
      </span>
    </div>
  );
  return (
    <div className="space-y-2">
      {vars.map((v, i) => row(v, "variable", i))}
      {fields.map((f, i) => row(f, "extracted", i))}
      <p className="pt-1 text-[10px] text-muted-foreground/70">
        To add, remove or rename a variable, ask SystemMind in the chat — e.g. “add a variable for
        budget and make it required” — and a new version will be generated. The Requirements step can
        also add missing script questions for you.
      </p>
    </div>
  );
}

// ── Mandatory required-inputs form ────────────────────────────────────────────
// Like the platform's secret-request boxes: every captured field that has no CRM
// destination yet gets a mandatory box the user must fill in. Submitting sends a
// plain-language instruction to SystemMind, which generates a new version.

// Every page relevant to call results, with its sub-sections. Each captured data
// point maps to one of these and is written POST-CALL (after the call ends).
const DESTINATION_GROUPS: { page: string; subs: string[] }[] = [
  { page: "Leads",            subs: ["New lead", "Interested", "Qualified", "Not Interested", "Callback Requested", "Contact Made"] },
  { page: "Qualified",        subs: ["Qualified list"] },
  { page: "Calls",            subs: ["Call log", "Call outcome", "Transcript", "Sentiment"] },
  { page: "Pipeline",         subs: ["Leads stage", "Qualified stage", "Contact Made stage", "Second Call stage", "Bookings stage", "Sale Done stage", "Documents stage", "Follow Up stage"] },
  { page: "Follow-Up Centre", subs: ["Callback", "Email follow-up", "WhatsApp follow-up"] },
  { page: "Calendar",         subs: ["Appointment / booking"] },
  { page: "Contacts",         subs: ["Contact record"] },
  { page: "Data",             subs: ["Records"] },
];
const DEFAULT_DESTINATION = "Leads — New lead";
const destValue = (page: string, sub: string) =>
  sub && sub !== page ? `${page} — ${sub}` : page;

// ── Guided pre-call data points ───────────────────────────────────────────────
// Data the agent should know BEFORE the call. Each becomes a {{dynamic_variable}}
// in the script, mapped from the matching place in WEBEE (CRM/Leads, Data page…).
const PRE_CALL_SOURCES: { group: string; items: { label: string; varName: string; source: string }[] }[] = [
  {
    group: "Leads / CRM",
    items: [
      { label: "Lead name",          varName: "lead_name",         source: "Leads — full name" },
      { label: "Company",            varName: "company_name",      source: "Leads — company" },
      { label: "Phone number",       varName: "phone_number",      source: "Leads — phone" },
      { label: "Email",              varName: "email",             source: "Leads — email" },
      { label: "Lead status",        varName: "lead_status",       source: "Leads — status" },
      { label: "Lead source",        varName: "lead_source",       source: "Leads — source" },
      { label: "Last call summary",  varName: "last_call_summary", source: "Calls — last call summary" },
      { label: "Notes",              varName: "lead_notes",        source: "Leads — notes" },
    ],
  },
  {
    group: "Calendar",
    items: [
      { label: "Next appointment",   varName: "next_appointment",  source: "Calendar — next appointment" },
    ],
  },
  {
    group: "Data page (Records / CSV)",
    items: [
      { label: "Record name",        varName: "record_name",       source: "Data — Records name" },
    ],
  },
  {
    group: "Webform submission",
    items: [
      { label: "Form message / notes", varName: "form_notes",  source: "Webform — notes/message" },
      { label: "UTM source",           varName: "utm_source",  source: "Webform — utm_source" },
      { label: "Page submitted from",  varName: "source_page", source: "Webform — source page" },
    ],
  },
];

// ── Guided lead-intake source chooser ─────────────────────────────────────────
// Where do this agent's leads come from? Existing CRM/Leads records, or live
// webform intake (a submission creates the lead and starts the workflow).
function LeadSourcePanel({
  config, busy, onSend,
}: {
  config: Record<string, any> | null;
  busy: boolean;
  onSend: (prompt: string) => void;
}) {
  const listFormsFn = useServerFn(listWebformSources);
  const formsQ = useQuery({
    queryKey: ["bw-webform-sources"],
    queryFn: () => listFormsFn(),
    staleTime: 60_000,
    throwOnError: false,
  });
  const forms = ((formsQ.data as any)?.sources ?? []) as any[];
  const [choice, setChoice] = useState<"" | "crm" | `wf:${string}`>("");

  const cfgSource = String(
    (config?.workflow?.trigger_config as any)?.lead_source ?? "",
  );
  const cfgFormName = String(
    (config?.workflow?.trigger_config as any)?.webform_name ?? "",
  );

  const submit = () => {
    if (!choice) return;
    if (choice === "crm") {
      onSend(
        "Leads for this agent come from the WEBEE CRM / Leads page (existing records) — not from a webform. Set the workflow trigger and steps accordingly, and remove any webform lead_source from trigger_config. Keep everything else unchanged.",
      );
    } else {
      const name = choice.slice(3);
      onSend(
        `Leads for this agent come from live webform intake: the webform "${name}" creates a new lead the moment someone submits, and this workflow should start from it. Set trigger_type to "lead_added" with trigger_config {"lead_source": "webform", "webform_name": "${name}"}, and make the pre-call variables map from the webform submission where relevant. Keep everything else unchanged.`,
      );
    }
    setChoice("");
  };

  return (
    <div className="space-y-2 rounded-lg border border-violet-500/25 bg-violet-500/[0.04] p-3">
      <div className="flex items-center gap-2">
        <Import className="h-3.5 w-3.5 text-violet-300" />
        <p className="text-[11px] font-semibold text-violet-200">Lead intake — where do this agent's leads come from?</p>
        {cfgSource === "webform" && (
          <Badge variant="outline" className="border-violet-400/40 text-[9px] text-violet-200">
            current: webform{cfgFormName ? ` — ${cfgFormName}` : ""}
          </Badge>
        )}
      </div>
      <p className="text-[10px] text-muted-foreground">
        Choose <span className="font-medium text-foreground">CRM / Leads page</span> to work from
        records already in WEBEE, or a <span className="font-medium text-foreground">webform</span>{" "}
        so a live form submission creates the lead and kicks off this agent instantly.
      </p>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          disabled={busy}
          onClick={() => setChoice(choice === "crm" ? "" : "crm")}
          className={cn(
            "rounded-full border px-2.5 py-1 text-[10px] transition-colors",
            choice === "crm"
              ? "border-violet-400/60 bg-violet-500/20 text-violet-200"
              : "border-white/[0.1] bg-white/[0.02] text-muted-foreground hover:text-foreground",
          )}
        >
          CRM / Leads page
        </button>
        {forms.map((f) => {
          const v = `wf:${String(f.name)}` as const;
          return (
            <button
              key={String(f.id)}
              type="button"
              disabled={busy}
              onClick={() => setChoice(choice === v ? "" : v)}
              title={`Webform "${String(f.name)}" (${String(f.status ?? "active")})`}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[10px] transition-colors",
                choice === v
                  ? "border-violet-400/60 bg-violet-500/20 text-violet-200"
                  : "border-white/[0.1] bg-white/[0.02] text-muted-foreground hover:text-foreground",
              )}
            >
              Webform: {String(f.name)}
            </button>
          );
        })}
        {!formsQ.isLoading && forms.length === 0 && (
          <span className="self-center text-[10px] text-muted-foreground">
            No webforms yet — create one under Lead Generation → Webforms to use webform intake.
          </span>
        )}
      </div>
      <Button
        size="sm"
        className="h-7 gap-1.5 px-3 text-[11px]"
        disabled={busy || !choice}
        onClick={submit}
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
        Set lead source
      </Button>
    </div>
  );
}

function PreCallInputsPanel({
  config, busy, onSend,
}: {
  config: Record<string, any> | null;
  busy: boolean;
  onSend: (prompt: string) => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [customCols, setCustomCols] = useState("");
  const existing = new Set(
    ((config?.variables ?? []) as any[]).map((v) => String(v.name ?? v.key ?? "").toLowerCase()),
  );
  const allItems = PRE_CALL_SOURCES.flatMap((g) => g.items);
  const toggle = (v: string) =>
    setPicked((s) => { const n = new Set(s); n.has(v) ? n.delete(v) : n.add(v); return n; });

  const submit = () => {
    const chosen = allItems.filter((i) => picked.has(i.varName));
    const parts = chosen.map((i) => `{{${i.varName}}} from ${i.source}`);
    const cols = customCols.trim();
    const seen = new Set([...existing, ...chosen.map((i) => i.varName)]);
    if (cols) {
      for (const c of cols.split(",").map((x) => x.trim().slice(0, 60)).filter(Boolean)) {
        const vn = c.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
        if (vn && !seen.has(vn)) {
          seen.add(vn);
          parts.push(`{{${vn}}} from Data — Records column "${c}"`);
        }
      }
    }
    if (parts.length === 0) return;
    onSend(
      `Before each call, the agent should load these data points and use them as dynamic variables in the script: ${parts.join("; ")}. ` +
      `Add each one to "variables" with its WEBEE source, and rewrite the agent script so it references them naturally as {{placeholders}} (e.g. greeting the lead by name). Keep everything else unchanged.`,
    );
    setPicked(new Set());
    setCustomCols("");
  };

  return (
    <div className="space-y-2 rounded-lg border border-sky-500/25 bg-sky-500/[0.04] p-3">
      <div className="flex items-center gap-2">
        <Variable className="h-3.5 w-3.5 text-sky-300" />
        <p className="text-[11px] font-semibold text-sky-200">Pre-call data (dynamic variables in the script)</p>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Pick what the agent should already know before it dials. Each becomes a{" "}
        <code className="rounded bg-white/[0.06] px-1">{"{{variable}}"}</code> in the script, filled
        automatically from the matching place in your WEBEE data — so the script stays personalised
        without you hard-coding anything. Post-call captured data is mapped separately below.
      </p>
      {PRE_CALL_SOURCES.map((g) => (
        <div key={g.group} className="space-y-1">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{g.group}</p>
          <div className="flex flex-wrap gap-1.5">
            {g.items.map((i) => {
              const already = existing.has(i.varName);
              const on = picked.has(i.varName);
              return (
                <button
                  key={i.varName}
                  type="button"
                  disabled={already || busy}
                  onClick={() => toggle(i.varName)}
                  title={already ? "Already in this version's variables" : `${i.label} → {{${i.varName}}} (${i.source})`}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-[10px] transition-colors",
                    already
                      ? "cursor-default border-emerald-500/30 bg-emerald-500/10 text-emerald-300/80"
                      : on
                        ? "border-sky-400/60 bg-sky-500/20 text-sky-200"
                        : "border-white/[0.1] bg-white/[0.02] text-muted-foreground hover:text-foreground",
                  )}
                >
                  {already ? "✓ " : ""}{i.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={customCols}
          onChange={(e) => setCustomCols(e.target.value)}
          placeholder="Custom Data-page columns, comma-separated (e.g. budget, property type)"
          className="h-7 w-[320px] text-[11px]"
        />
        <Button
          size="sm"
          className="h-7 gap-1.5 px-3 text-[11px]"
          disabled={busy || (picked.size === 0 && !customCols.trim())}
          onClick={submit}
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
          Add to script
        </Button>
      </div>
    </div>
  );
}

export function findUnmappedFields(config: Record<string, any> | null): any[] {
  const fields = (config?.extraction_fields ?? []) as any[];
  return fields.filter((f) => !(f.crm_destination ?? f.destination ?? f.maps_to));
}

function RequiredInputsPanel({
  config, busy, onSend,
}: {
  config: Record<string, any> | null;
  busy: boolean;
  onSend: (prompt: string) => void;
}) {
  const unmapped = findUnmappedFields(config);
  const creds    = (config?.required_credentials ?? []) as string[];
  const [dest, setDest]         = useState<Record<string, string>>({});
  const [crmField, setCrmField] = useState<Record<string, string>>({});
  const [extCrm, setExtCrm]     = useState<"" | "yes" | "no">("");

  if (unmapped.length === 0 && creds.length === 0) return null;

  const nameOf  = (f: any) => String(f.name ?? f.key ?? "unnamed");
  const destOf  = (n: string) => dest[n] ?? DEFAULT_DESTINATION;
  const allFilled = unmapped.every((f) => !!destOf(nameOf(f)));

  const submit = () => {
    const parts = unmapped.map((f) => {
      const n = nameOf(f);
      const cf = crmField[n]?.trim();
      return `${n} → ${destOf(n)}${cf ? ` (field name: ${cf})` : ""}`;
    });
    const postCallNote = " Every mapped data point is written post-call (after the call ends).";
    const extNote =
      extCrm === "yes"
        ? " The user ALSO wants to sync leads to their external CRM — add a push_to_crm step at the right point in the workflow."
        : extCrm === "no"
          ? " The user does NOT want an external CRM sync — keep everything in WEBEE only (no push_to_crm step)."
          : "";
    onSend(`Map these captured fields into the WEBEE system: ${parts.join("; ")}. Update the workflow's mappings accordingly.${postCallNote}${extNote}`);
  };

  return (
    <div className="space-y-2 rounded-lg border border-amber-500/25 bg-amber-500/[0.04] p-3">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
        <p className="text-[11px] font-semibold text-amber-200">
          Required before this workflow is ready
        </p>
      </div>

      {unmapped.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] text-muted-foreground">
            Captured data always lands in your WEBEE system and is written post-call. Fields marked <span className="text-rose-400">*</span> are mandatory — each defaults to Leads → New lead; pick the page and sub-section a field belongs to.
          </p>
          {unmapped.map((f) => {
            const n = nameOf(f);
            return (
              <div key={n} className="flex flex-wrap items-center gap-2 rounded-md border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
                <p className="min-w-[110px] text-[11px] font-medium">{n}</p>
                <div className="flex items-center gap-1">
                  <span className="text-[11px] text-rose-400">*</span>
                  <Select value={destOf(n)} onValueChange={(v) => setDest((s) => ({ ...s, [n]: v }))}>
                    <SelectTrigger className="h-7 w-[210px] text-[11px]">
                      <SelectValue placeholder="WEBEE destination…" />
                    </SelectTrigger>
                    <SelectContent className="max-h-[300px]">
                      {DESTINATION_GROUPS.map((g) => (
                        <SelectGroup key={g.page}>
                          <SelectLabel className="text-[10px] text-muted-foreground">{g.page}</SelectLabel>
                          {g.subs.map((s) => {
                            const v = destValue(g.page, s);
                            return (
                              <SelectItem key={v} value={v} className="text-[11px]">{s}</SelectItem>
                            );
                          })}
                        </SelectGroup>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Input
                  value={crmField[n] ?? ""}
                  onChange={(e) => setCrmField((s) => ({ ...s, [n]: e.target.value }))}
                  placeholder="Field name (optional)"
                  className="h-7 w-[170px] text-[11px]"
                />
              </div>
            );
          })}
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
            <p className="text-[11px] font-medium">Also sync to an external CRM?</p>
            <span className="text-[10px] text-muted-foreground">(optional — WEBEE stores everything either way)</span>
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant={extCrm === "yes" ? "default" : "outline"}
                className="h-6 px-2.5 text-[10px]"
                onClick={() => setExtCrm(extCrm === "yes" ? "" : "yes")}
              >
                Yes, connect my CRM
              </Button>
              <Button
                size="sm"
                variant={extCrm === "no" ? "default" : "outline"}
                className="h-6 px-2.5 text-[10px]"
                onClick={() => setExtCrm(extCrm === "no" ? "" : "no")}
              >
                No, WEBEE only
              </Button>
            </div>
          </div>
          <Button
            size="sm"
            className="h-7 gap-1.5 px-3 text-[11px]"
            disabled={!allFilled || busy}
            onClick={submit}
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
            Save mappings
          </Button>
        </div>
      )}

      {creds.length > 0 && (
        <div className="space-y-1 pt-1">
          <p className="text-[10px] text-muted-foreground">Credentials this workflow needs:</p>
          {creds.map((c, i) => (
            <p key={i} className="text-[11px] text-amber-200/90">
              <span className="text-rose-400">*</span> {c}
              <span className="text-[10px] text-muted-foreground"> — add it in Settings → Integrations. Never paste keys into this chat.</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function MappingPanel({
  config, busy, onSend,
}: {
  config: Record<string, any> | null;
  busy?: boolean;
  onSend?: (prompt: string) => void;
}) {
  const fields = (config?.extraction_fields ?? []) as any[];
  const req    = (config?.requirements ?? {}) as Record<string, any>;
  const reqMappings = (req.variable_mappings ?? req.crm_mappings ?? []) as any[];

  const rows: Array<{ field: string; destination: string; crmField: string; usage: string }> = [];
  for (const f of fields) {
    rows.push({
      field:       String(f.name ?? f.key ?? "unnamed"),
      destination: String(f.crm_destination ?? f.destination ?? f.maps_to ?? ""),
      crmField:    String(f.crm_field ?? f.field ?? f.name ?? ""),
      usage:       String(f.usage ?? f.description ?? "post-call data"),
    });
  }
  for (const m of reqMappings) {
    rows.push({
      field:       String(m.variable ?? m.field ?? m.name ?? "unnamed"),
      destination: String(m.destination ?? m.crm_destination ?? "Leads"),
      crmField:    String(m.crm_field ?? m.field ?? ""),
      usage:       String(m.usage ?? m.reason ?? "workflow"),
    });
  }

  if (rows.length === 0) {
    return (
      <div className="space-y-3">
        {onSend && (
          <>
            <LeadSourcePanel config={config} busy={!!busy} onSend={onSend} />
            <PreCallInputsPanel config={config} busy={!!busy} onSend={onSend} />
            <RequiredInputsPanel config={config} busy={!!busy} onSend={onSend} />
          </>
        )}
        <p className="py-8 text-center text-[11px] text-muted-foreground">
          No CRM mappings yet. They are generated with the workflow — answer the Requirements step
          (it asks where each captured field should land: Calls, Leads, Qualified, Data, Follow-Up
          Centre, Calendar) or ask SystemMind in the chat, e.g. “map the post-call data to Leads and
          Qualified”.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {onSend && (
        <>
          <LeadSourcePanel config={config} busy={!!busy} onSend={onSend} />
          <PreCallInputsPanel config={config} busy={!!busy} onSend={onSend} />
          <RequiredInputsPanel config={config} busy={!!busy} onSend={onSend} />
        </>
      )}
      <div className="overflow-x-auto rounded-lg border border-white/[0.06]">
        <table className="w-full text-left text-[11px]">
          <thead>
            <tr className="border-b border-white/[0.06] bg-white/[0.02] text-[10px] uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2 font-medium">Extracted field</th>
              <th className="px-3 py-2 font-medium">CRM destination</th>
              <th className="px-3 py-2 font-medium">CRM field</th>
              <th className="px-3 py-2 font-medium">Used for</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-white/[0.04] last:border-0">
                <td className="px-3 py-2 font-medium">{r.field}</td>
                <td className="px-3 py-2">
                  {r.destination
                    ? <Badge variant="outline" className="text-[9px]">{r.destination}</Badge>
                    : <Badge variant="outline" className="border-amber-500/40 text-[9px] text-amber-300">Unmapped</Badge>}
                </td>
                <td className="px-3 py-2 text-muted-foreground">{r.crmField || "—"}</td>
                <td className="px-3 py-2 text-muted-foreground">{r.usage}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-muted-foreground/70">
        To change a destination, ask SystemMind in the chat — e.g. “send appointment_time to
        Calendar instead of Leads” — and a new version is generated. Nothing is written to your CRM
        until you Apply.
      </p>
    </div>
  );
}

function ReviewPanel({
  report, loading, config,
}: {
  report: Record<string, any> | null; loading: boolean; config: Record<string, any> | null;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-[11px] text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Running the pre-apply safety check…
      </div>
    );
  }
  if (!report) {
    return (
      <p className="py-8 text-center text-[11px] text-muted-foreground">
        Generate a version first, then this step shows the full pre-apply review: what changes,
        conflicts, risk level and rollback availability.
      </p>
    );
  }
  const impact    = (report.impact ?? {}) as Record<string, any>;
  const conflicts = (impact.conflicts ?? []) as any[];
  const diff      = (impact.diff ?? []) as any[];
  const deps      = (impact.dependencies ?? []) as string[];
  const creds     = (config?.required_credentials ?? []) as string[];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
        <ShieldCheck className="h-4 w-4 text-emerald-400" />
        <p className="text-xs font-medium">Pre-apply review</p>
        <RiskBadge risk={report.riskLevel} />
        {impact.requiresApproval && (
          <Badge variant="outline" className="border-amber-500/40 text-[10px] text-amber-300">requires approval</Badge>
        )}
        {impact.rollbackAvailable && (
          <Badge variant="outline" className="border-emerald-500/40 text-[10px] text-emerald-300">rollback available</Badge>
        )}
      </div>

      <Section icon={Info} title="Target">
        {impact.targetIsNew ? (
          <p className="text-[11px] text-emerald-300">Creates a brand-new workflow — nothing existing is touched.</p>
        ) : (
          <>
            <p className="text-[11px]">
              Updates <span className="font-semibold">{impact.targetWorkflowName ?? "an existing workflow"}</span>
              {impact.targetIsLive && <Badge variant="outline" className="ml-1.5 border-red-500/40 text-[10px] text-red-300">LIVE</Badge>}
            </p>
            {impact.targetAgentName && (
              <p className="text-[11px] text-muted-foreground">
                Also updates agent <span className="font-medium text-foreground/80">{impact.targetAgentName}</span>
                {impact.agentIsLive ? " (currently live)" : ""}.
              </p>
            )}
          </>
        )}
        {deps.length > 0 && deps.map((d, i) => <p key={i} className="text-[10px] text-muted-foreground">• could also affect: {d}</p>)}
      </Section>

      {conflicts.length > 0 && (
        <Section icon={AlertTriangle} title={`Blockers & approvals (${conflicts.length})`}>
          {conflicts.map((c: any, i: number) => (
            <div key={i} className={cn(
              "rounded border px-2 py-1.5 text-[11px]",
              c.severity === "block" && "border-red-500/30 bg-red-500/[0.05] text-red-200",
              c.severity === "needs_approval" && "border-amber-500/30 bg-amber-500/[0.05] text-amber-200",
              c.severity === "block_go_live" && "border-orange-500/30 bg-orange-500/[0.05] text-orange-200",
            )}>
              <p>{c.message}</p>
              <p className="mt-0.5 text-[10px] opacity-80">{c.suggestion}</p>
            </div>
          ))}
        </Section>
      )}

      {diff.length > 0 && (
        <Section icon={GitCompareArrows} title={`What changes (${diff.length})`}>
          <div className="max-h-48 space-y-1 overflow-y-auto">
            {diff.map((d: any, i: number) => (
              <p key={i} className="text-[11px] text-muted-foreground">
                <span className={cn(
                  "mr-1 font-semibold",
                  d.kind === "added" && "text-emerald-400",
                  d.kind === "removed" && "text-red-400",
                  (d.kind === "changed" || d.kind === "renamed") && "text-amber-400",
                  d.kind === "disabled" && "text-orange-400",
                )}>{d.kind}</span>
                {d.label}{d.detail ? ` — ${d.detail}` : ""}
              </p>
            ))}
          </div>
        </Section>
      )}

      {creds.length > 0 && (
        <Section icon={ShieldAlert} title="Setup still needed">
          {creds.map((c, i) => <p key={i} className="text-[11px] text-amber-300/90">Credential needed: {c}</p>)}
        </Section>
      )}

      <p className="text-[10px] text-muted-foreground/70">
        Nothing has been written — this is a read-only preview. Use Apply (or the Apply step) when
        you're happy; you'll confirm exactly how to apply it there, and a rollback snapshot is taken
        automatically before any existing setup is overwritten.
      </p>
    </div>
  );
}

// ── Session view ────────────────────────────────────────────────────────────────

type Tab =
  | "brief" | "requirements" | "variables" | "mapping" | "config" | "test"
  | "review" | "deploy" | "versions" | "usage" | "conversion";

export function BuildSessionView({
  sessionId,
  embedded = false,
  initialPrompt,
  onInitialPromptConsumed,
  onDeleted,
}: {
  sessionId: string;
  embedded?: boolean;
  initialPrompt?: string | null;
  onInitialPromptConsumed?: () => void;
  onDeleted?: () => void;
}) {
  const navigate = useNavigate();
  const qc       = useQueryClient();

  const getFn      = useServerFn(getBuildSession);
  const promptFn   = useServerFn(promptBuildSession);
  const simulateFn = useServerFn(simulateBuildVersion);
  const applyFn    = useServerFn(applyBuildVersion);
  const restoreFn  = useServerFn(restoreBuildVersion);
  const notesFn    = useServerFn(setBuildVersionNotes);
  const archiveFn  = useServerFn(setBuildSessionArchived);
  const deployedFn = useServerFn(markBuildVersionDeployed);
  const usageFn    = useServerFn(getSystemMindUsageSummary);
  const goLiveFn   = useServerFn(goLiveAgent);
  const safetyFn   = useServerFn(getBuildApplySafetyReport);
  const rollbackFn = useServerFn(rollbackBuildApply);
  const deleteFn   = useServerFn(deleteBuildSession);
  const conversionFn = useServerFn(getConversionForSession);

  const [prompt, setPrompt]           = useState("");
  const [tab, setTab]                 = useState<Tab>("config");
  const [sim, setSim]                 = useState<Record<string, any> | null>(null);
  const [notesEditId, setNotesEditId] = useState<string | null>(null);
  const [notesDraft, setNotesDraft]   = useState("");
  const [safetyOpen, setSafetyOpen]   = useState(false);
  const [safetyGoLive, setSafetyGoLive] = useState(false);
  const [safetyReport, setSafetyReport] = useState<Record<string, any> | null>(null);
  const [applyMode, setApplyMode]     = useState<"direct" | "new_draft" | "duplicate_edit" | "propose">("direct");
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ["smbw-session", sessionId],
    queryFn: () => getFn({ data: { sessionId } }),
    enabled: !!sessionId,
    throwOnError: false,
  });

  const { data: usage } = useQuery({
    queryKey: ["smbw-usage"],
    queryFn: () => usageFn({ data: { days: 30 } }),
    enabled: tab === "usage",
    throwOnError: false,
    staleTime: 60_000,
  });

  // Conversion lineage row for the open session (drives the Conversion tab)
  const { data: conversion } = useQuery({
    queryKey: ["smbw-conversion", sessionId],
    queryFn: () => conversionFn({ data: { sessionId } }),
    enabled: !!sessionId,
    throwOnError: false,
    staleTime: 60_000,
  });

  const session   = detail?.session as Record<string, any> | undefined;
  const versions  = (detail?.versions ?? []) as any[];
  const messages  = (detail?.messages ?? []) as any[];
  const snapshots = ((detail as any)?.snapshots ?? []) as any[];
  const currentVersion = useMemo(
    () => versions.find((v) => v.id === session?.current_version_id) ?? versions[0] ?? null,
    [versions, session?.current_version_id],
  );
  const config = (currentVersion?.generated_config ?? null) as Record<string, any> | null;
  const unmappedCount = useMemo(() => findUnmappedFields(config).length, [config]);
  const canApply = currentVersion
    && ["draft", "testing", "revised"].includes(String(currentVersion.status))
    && unmappedCount === 0;

  // What changed in the current version vs the one right before it (by number).
  const currentDiff = useMemo(() => {
    if (!currentVersion?.generated_config) return null;
    const prev = versions.find(
      (v) => v.version_number === currentVersion.version_number - 1,
    );
    return diffBuildConfigs(
      (prev?.generated_config ?? null) as Record<string, any> | null,
      currentVersion.generated_config as Record<string, any>,
    );
  }, [versions, currentVersion]);
  const [configView, setConfigView] = useState<"list" | "diagram">("list");

  // Read-only review report — fetched only while the Review step is open.
  const { data: reviewReport, isLoading: reviewLoading } = useQuery({
    queryKey: ["smbw-review", sessionId, currentVersion?.id],
    queryFn: () => safetyFn({ data: { sessionId, versionId: currentVersion!.id } }),
    enabled: tab === "review" && !!currentVersion,
    throwOnError: false,
    staleTime: 30_000,
  });

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const sendPrompt = useMutation({
    mutationFn: async (text?: string) => {
      const p = (text ?? prompt).trim();
      if (!p) throw new Error("Describe what you want SystemMind to build or change.");
      return promptFn({ data: { sessionId, prompt: p } });
    },
    onSuccess: (res: any) => {
      setPrompt("");
      setSim(null);
      setTab("config");
      qc.invalidateQueries({ queryKey: ["smbw-session", sessionId] });
      qc.invalidateQueries({ queryKey: ["smbw-sessions"] });
      qc.invalidateQueries({ queryKey: ["smbw-usage"] });
      qc.invalidateQueries({ queryKey: ["smbw-review", sessionId] });
      qc.invalidateQueries({ queryKey: ["smbw-testcall", sessionId] });
      toast.success(`Version ${res.versionNumber} generated`, {
        description: `${res.riskLevel} risk · ${fmtMs(res.elapsedMs)} · ${res.totalTokens} tokens · ~$${Number(res.estimatedCostUsd ?? 0).toFixed(4)} AI cost`,
      });
    },
    onError: (e: any) => {
      qc.invalidateQueries({ queryKey: ["smbw-session", sessionId] });
      toast.error("Generation failed", { description: e?.message });
    },
  });

  // Auto-send the initial prompt handed over from the Agent Builder prompt box.
  // The latch resets whenever the parent clears initialPrompt (via
  // onInitialPromptConsumed), so each newly handed-off prompt sends exactly once.
  const initialSentRef = useRef(false);
  useEffect(() => {
    if (!initialPrompt?.trim()) {
      initialSentRef.current = false;
      return;
    }
    if (initialSentRef.current) return;
    if (detailLoading || !session) return;
    if (session.status === "archived") return;
    initialSentRef.current = true;
    sendPrompt.mutate(initialPrompt.trim());
    onInitialPromptConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrompt, detailLoading, session]);

  const runSim = useMutation({
    mutationFn: () => simulateFn({ data: { sessionId, versionId: currentVersion!.id } }),
    onSuccess: (res: any) => {
      setSim(res);
      setTab("test");
      qc.invalidateQueries({ queryKey: ["smbw-session", sessionId] });
    },
    onError: (e: any) => toast.error("Simulation failed", { description: e?.message }),
  });

  // Safety pre-flight: fetch impact report, then open the panel for the user
  // to choose HOW to apply. Nothing is written by this call.
  const openSafetyPanel = useMutation({
    mutationFn: (goLive: boolean) =>
      safetyFn({ data: { sessionId, versionId: currentVersion!.id } }).then((r: any) => ({ r, goLive })),
    onSuccess: ({ r, goLive }: any) => {
      setSafetyReport(r);
      setSafetyGoLive(goLive);
      const impact = r?.impact ?? {};
      // Default mode mirrors the server's safe default: ONLY a completely
      // fresh target defaults to direct; ANY existing target defaults to
      // "Save as new draft" — overwriting is an explicit opt-in.
      setApplyMode(
        impact.targetIsNew && !impact.agentHasConfig && !impact.agentIsLive
          ? "direct"
          : "new_draft",
      );
      setSafetyOpen(true);
    },
    onError: (e: any) => toast.error("Safety check failed", { description: e?.message }),
  });

  const apply = useMutation({
    mutationFn: (vars: { mode?: string; goLiveIntent?: boolean } = {}) =>
      applyFn({ data: { sessionId, versionId: currentVersion!.id, mode: vars.mode as any, goLiveIntent: vars.goLiveIntent } }),
    onSuccess: (res: any) => {
      setSafetyOpen(false);
      qc.invalidateQueries({ queryKey: ["smbw-session", sessionId] });
      qc.invalidateQueries({ queryKey: ["smbw-sessions"] });
      if (res.requiresApproval) {
        toast.warning("Approval required before this goes live", {
          description: "This change needs a human sign-off. It has been sent to the HiveMind action centre for approval.",
          duration: 8000,
        });
      } else {
        toast.success(res.mode === "direct" ? "Build applied" : "Saved as a new draft", {
          description: res.mode === "direct"
            ? `The workflow has been saved to your Workflows page.${res.snapshotId ? " A rollback snapshot of the previous state was taken first." : ""}`
            : "A new inactive draft workflow was created — nothing existing was changed.",
          action: {
            label: "View workflows",
            onClick: () => navigate({ to: "/workflow-engine" }),
          },
          duration: 8000,
        });
      }
    },
    onError: (e: any) => {
      setSafetyOpen(false);
      toast.error("Apply blocked", { description: e?.message, duration: 12000 });
    },
  });

  const applyAndGoLive = useMutation({
    mutationFn: async (vars: { mode?: string } = {}) => {
      const versionId = currentVersion!.id;
      const res: any = await applyFn({
        data: { sessionId, versionId, mode: (vars.mode ?? "direct") as any, goLiveIntent: true },
      });
      if (res.requiresApproval) return { ...res, wentLive: false };
      // Reuse the EXISTING Go Live flow — same checks as the Deploy tab.
      await goLiveFn({
        data: {
          id: session!.target_agent_id,
          agentType: (session!.target_agent_type ?? "receptionist") as any,
        },
      });
      await deployedFn({ data: { sessionId, versionId, deployTarget: "agent go-live" } });
      return { ...res, wentLive: true };
    },
    onSuccess: (res: any) => {
      setSafetyOpen(false);
      qc.invalidateQueries({ queryKey: ["smbw-session", sessionId] });
      qc.invalidateQueries({ queryKey: ["smbw-sessions"] });
      if (res.requiresApproval) {
        toast.warning("Approval required before this goes live", {
          description: "This change needs a human sign-off. It has been sent to the HiveMind action centre for approval.",
          duration: 8000,
        });
      } else if (res.wentLive) {
        toast.success("Applied & live", { description: "The workflow is saved and the agent is now live." });
      }
    },
    onError: (e: any) => {
      setSafetyOpen(false);
      qc.invalidateQueries({ queryKey: ["smbw-session", sessionId] });
      toast.error("Go Live did not complete", {
        description: `${e?.message ?? "Unknown error"}`,
        duration: 10000,
      });
    },
  });

  const rollback = useMutation({
    mutationFn: (snapshotId: string) =>
      rollbackFn({ data: { sessionId, snapshotId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["smbw-session", sessionId] });
      toast.success("Rolled back", { description: "The previous setup was restored from the snapshot." });
    },
    onError: (e: any) => toast.error("Rollback failed", { description: e?.message }),
  });

  const restore = useMutation({
    mutationFn: (versionId: string) => restoreFn({ data: { sessionId, versionId } }),
    onSuccess: (res: any) => {
      setSim(null);
      qc.invalidateQueries({ queryKey: ["smbw-session", sessionId] });
      toast.success(`Restored as version ${res.versionNumber}`);
    },
    onError: (e: any) => toast.error("Restore failed", { description: e?.message }),
  });

  const saveNotes = useMutation({
    mutationFn: (versionId: string) =>
      notesFn({ data: { sessionId, versionId, notes: notesDraft } }),
    onSuccess: () => {
      setNotesEditId(null);
      qc.invalidateQueries({ queryKey: ["smbw-session", sessionId] });
      toast.success("Notes saved");
    },
    onError: (e: any) => toast.error("Could not save notes", { description: e?.message }),
  });

  const archive = useMutation({
    mutationFn: (args: { id: string; archived: boolean }) =>
      archiveFn({ data: { sessionId: args.id, archived: args.archived } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["smbw-sessions"] });
      qc.invalidateQueries({ queryKey: ["smbw-session", sessionId] });
    },
    onError: (e: any) => toast.error("Archive failed", { description: e?.message }),
  });

  const removeSession = useMutation({
    mutationFn: () => deleteFn({ data: { sessionId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["smbw-sessions"] });
      toast.success("Build session deleted");
      if (!embedded) {
        navigate({ to: "/systemmind/build", search: { session: undefined, workflow: undefined, agent: undefined } });
      }
      onDeleted?.();
    },
    onError: (e: any) => toast.error("Delete failed", { description: e?.message }),
  });

  const busy = sendPrompt.isPending;

  if (detailLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!session) {
    return (
      <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
        Build session not found.
      </div>
    );
  }

  const stepTabs: Array<readonly [Tab, React.ElementType, string]> = [
    ["brief",  Lightbulb, "Brief"],
    ...(session.target_agent_id ? ([["requirements", ClipboardList, "Requirements"]] as const) : []),
    ["variables", Variable, "Variables"],
    ["mapping",   Table2,   "CRM Mapping"],
    ["config",    FileCode2, "Workflow"],
    ["test",      FlaskConical, "Test"],
    ["review",    Eye,      "Review"],
    ...(session.target_agent_id ? ([["deploy", Rocket, "Apply"]] as const) : []),
  ];
  const extraTabs: Array<readonly [Tab, React.ElementType, string]> = [
    ["versions", History, "Versions"],
    ["usage",    Gauge,   "Usage"],
    ...(conversion ? ([["conversion", Import, "Conversion"]] as const) : []),
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="truncate text-sm font-semibold">{session.title}</h1>
        {currentVersion && <StatusBadge status={currentVersion.status} />}
        {currentVersion && <RiskBadge risk={currentVersion.risk_level} />}
        {session.linked_workflow_id && (
          <Badge variant="outline" className="text-[10px] border-sky-500/30 text-sky-300">editing live workflow</Badge>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {embedded && (
            <Button
              size="sm" variant="outline"
              className="h-7 gap-1 px-2 text-[11px] border-sky-500/30 text-sky-400 hover:text-sky-300"
              onClick={() =>
                navigate({
                  to: "/systemmind/build",
                  search: { session: session.id, workflow: undefined, agent: undefined },
                })
              }
            >
              <ExternalLink className="h-3 w-3" /> Open in SystemMind
            </Button>
          )}
          {(() => {
            const prev = currentVersion
              ? versions.find((v) => v.version_number === currentVersion.version_number - 1)
              : null;
            return (
              <Button
                size="sm" variant="outline"
                className="h-7 gap-1 px-2 text-[11px]"
                disabled={!prev || restore.isPending || busy}
                title={prev ? `Revert to v${prev.version_number}` : "No previous version to revert to"}
                onClick={() => {
                  if (!prev) return;
                  if (window.confirm(`Revert to version v${prev.version_number}? It will be restored as a new version — nothing is lost.`)) {
                    restore.mutate(prev.id);
                  }
                }}
              >
                {restore.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                Revert
              </Button>
            );
          })()}
          <Button
            size="sm" variant="ghost"
            className="h-7 gap-1 px-2 text-[11px] text-muted-foreground"
            onClick={() => archive.mutate({ id: session.id, archived: session.status !== "archived" })}
          >
            {session.status === "archived"
              ? (<><ArchiveRestore className="h-3 w-3" /> Restore</>)
              : (<><Archive className="h-3 w-3" /> Archive</>)}
          </Button>
          <Button
            size="sm" variant="ghost"
            className="h-7 gap-1 px-2 text-[11px] text-rose-400 hover:text-rose-300"
            disabled={removeSession.isPending || busy}
            onClick={() => {
              if (window.confirm("Delete this build session? Its versions and chat history will be removed. Anything already applied to your Workflows stays untouched.")) {
                removeSession.mutate();
              }
            }}
          >
            {removeSession.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
            Delete
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        {/* Chat column */}
        <div className={cn(
          "flex min-h-0 flex-col rounded-xl border border-white/[0.05] bg-white/[0.01]",
          embedded ? "w-[38%] min-w-[260px]" : "w-[42%] min-w-[300px]",
        )}>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
            {messages.length === 0 && !busy && (
              <div className="space-y-3 py-6">
                <p className="text-center text-[11px] text-muted-foreground">
                  Tell SystemMind what to build — or start from an example:
                </p>
                <div className="space-y-1.5">
                  {STARTER_PROMPTS.map((p) => (
                    <button
                      key={p}
                      onClick={() => setPrompt(p)}
                      className="w-full rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-left text-[11px] leading-relaxed text-muted-foreground transition-colors hover:border-sky-500/30 hover:bg-sky-500/[0.06] hover:text-foreground"
                    >
                      <Lightbulb className="mr-1.5 inline h-3 w-3 text-sky-300" />
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m: any) => (
              <div key={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                <div className={cn(
                  "max-w-[85%] rounded-lg px-3 py-2 text-xs leading-relaxed",
                  m.role === "user" && "bg-sky-500/15 text-sky-100",
                  m.role === "systemmind" && "border border-white/[0.06] bg-white/[0.03]",
                  m.role === "system" && "border border-amber-500/20 bg-amber-500/[0.04] text-amber-200/90 text-[11px]",
                )}>
                  {m.role !== "user" && (
                    <p className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {m.role === "systemmind" ? "SystemMind" : "System"}
                    </p>
                  )}
                  <p className="whitespace-pre-wrap">{m.content}</p>
                </div>
              </div>
            ))}
            {busy && (
              <BuildProgress phases={versions.length > 0 ? BUILD_PHASES_REVISION : BUILD_PHASES_FIRST} />
            )}
            <div ref={chatEndRef} />
          </div>
          <div className="border-t border-white/[0.05] p-2.5">
            {versions.length > 0 && !prompt && !busy && session.status !== "archived" && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {ITERATION_PROMPTS.map((p) => (
                  <button
                    key={p}
                    onClick={() => setPrompt(p)}
                    className="rounded-full border border-white/[0.08] bg-white/[0.02] px-2.5 py-1 text-[10px] text-muted-foreground transition-colors hover:border-sky-500/30 hover:bg-sky-500/[0.06] hover:text-foreground"
                  >
                    {p}
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2">
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !busy) sendPrompt.mutate(undefined);
                }}
                placeholder={versions.length > 0 ? "Ask for changes — a new version will be created…" : "Describe the agent/workflow to build…"}
                className="min-h-[60px] resize-none text-xs"
                disabled={busy || session.status === "archived"}
              />
              <Button
                size="sm"
                className="h-9 gap-1.5 px-3 text-xs"
                onClick={() => sendPrompt.mutate(undefined)}
                disabled={busy || !prompt.trim() || session.status === "archived"}
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>
        </div>

        {/* Workbench column */}
        <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-white/[0.05] bg-white/[0.01]">
          {/* Tabs + actions */}
          <div className="flex flex-wrap items-center gap-1 border-b border-white/[0.05] p-2">
            {stepTabs.map(([key, Icon, label], i) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors",
                  tab === key ? "bg-sky-500/15 text-sky-300" : "text-muted-foreground hover:bg-white/[0.04]",
                )}
              >
                <span className={cn(
                  "hidden h-3.5 w-3.5 items-center justify-center rounded-full text-[8px] font-bold xl:flex",
                  tab === key ? "bg-sky-500/30 text-sky-200" : "bg-white/[0.06] text-muted-foreground",
                )}>
                  {i + 1}
                </span>
                <Icon className="h-3 w-3 xl:hidden" /> {label}
              </button>
            ))}
            <div className="mx-1 h-4 w-px bg-white/[0.08]" />
            {extraTabs.map(([key, Icon, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors",
                  tab === key ? "bg-sky-500/15 text-sky-300" : "text-muted-foreground hover:bg-white/[0.04]",
                )}
              >
                <Icon className="h-3 w-3" /> {label}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-1.5">
              <Button
                size="sm" variant="outline"
                className="h-7 gap-1 px-2.5 text-[11px]"
                disabled={!currentVersion || runSim.isPending}
                onClick={() => runSim.mutate()}
              >
                {runSim.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <FlaskConical className="h-3 w-3" />}
                Simulate
              </Button>
              <Button
                size="sm"
                className="h-7 gap-1 px-2.5 text-[11px]"
                disabled={!canApply || apply.isPending || applyAndGoLive.isPending || openSafetyPanel.isPending}
                onClick={() => openSafetyPanel.mutate(false)}
              >
                {(apply.isPending || (openSafetyPanel.isPending && !openSafetyPanel.variables)) ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                Apply
              </Button>
              {session.target_agent_id && currentVersion?.risk_level !== "high" && (
                <Button
                  size="sm"
                  className="h-7 gap-1 bg-emerald-600 px-2.5 text-[11px] text-white hover:bg-emerald-500"
                  disabled={!canApply || apply.isPending || applyAndGoLive.isPending || openSafetyPanel.isPending}
                  onClick={() => openSafetyPanel.mutate(true)}
                >
                  {(applyAndGoLive.isPending || (openSafetyPanel.isPending && !!openSafetyPanel.variables)) ? <Loader2 className="h-3 w-3 animate-spin" /> : <Rocket className="h-3 w-3" />}
                  Apply &amp; Go Live
                </Button>
              )}
            </div>
          </div>

          {unmappedCount > 0 && currentVersion && (
            <div className="mx-3 mt-2 flex items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/[0.05] px-3 py-2">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
              <p className="text-[11px] text-amber-200/90">
                {unmappedCount} required input{unmappedCount === 1 ? "" : "s"} remaining — Apply is
                locked until every captured field has a CRM destination.
              </p>
              <button
                onClick={() => setTab("mapping")}
                className="ml-auto shrink-0 text-[11px] font-medium text-amber-300 underline-offset-2 hover:underline"
              >
                Fill them in
              </button>
            </div>
          )}

          {currentVersion?.risk_level === "high" && canApply && (
            <div className="mx-3 mt-2 flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/[0.05] px-3 py-2">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
              <p className="text-[11px] text-amber-200/90">
                This workflow affects live customer communication and requires approval
                before going live. Apply will send it to the HiveMind action centre.
              </p>
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {tab === "brief" && (
              <BriefPanel messages={messages} currentVersion={currentVersion} config={config} />
            )}

            {tab === "variables" && <VariablesPanel config={config} />}

            {tab === "mapping" && (
              <MappingPanel
                config={config}
                busy={busy}
                onSend={(p) => sendPrompt.mutate(p)}
              />
            )}

            {tab === "review" && (
              <ReviewPanel report={(reviewReport as any) ?? null} loading={reviewLoading} config={config} />
            )}

            {tab === "config" && (
              config
                ? <div className="space-y-3">
                    {currentDiff && currentVersion && (
                      <ChangeSummary diff={currentDiff} versionNumber={currentVersion.version_number} />
                    )}
                    {findUnmappedFields(config).length > 0 && (
                      <button
                        onClick={() => setTab("mapping")}
                        className="flex w-full items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/[0.05] px-3 py-2 text-left transition-colors hover:bg-amber-500/[0.1]"
                      >
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                        <span className="text-[11px] text-amber-200/90">
                          {findUnmappedFields(config).length} captured field{findUnmappedFields(config).length === 1 ? "" : "s"} still
                          need a CRM destination — fill them in on the CRM Mapping tab.
                        </span>
                        <ArrowRight className="ml-auto h-3 w-3 text-amber-400" />
                      </button>
                    )}
                    <div className="flex items-center gap-1 rounded-lg border border-white/[0.06] bg-white/[0.02] p-0.5 w-fit">
                      {(["list", "diagram"] as const).map((v) => (
                        <button
                          key={v}
                          onClick={() => setConfigView(v)}
                          className={cn(
                            "flex items-center gap-1 rounded-md px-2.5 py-1 text-[10px] font-medium transition-colors",
                            configView === v
                              ? "bg-sky-500/[0.15] text-sky-200"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {v === "list" ? <ListChecks className="h-3 w-3" /> : <WorkflowIcon className="h-3 w-3" />}
                          {v === "list" ? "Details" : "Diagram"}
                        </button>
                      ))}
                    </div>
                    {configView === "diagram"
                      ? <WorkflowFlowDiagram
                          config={config}
                          addedSteps={currentDiff?.addedSteps}
                          changedSteps={currentDiff?.changedSteps}
                        />
                      : <ConfigPreview config={config} />}
                  </div>
                : <p className="py-8 text-center text-[11px] text-muted-foreground">Nothing generated yet — send SystemMind a prompt to create the first version.</p>
            )}

            {tab === "conversion" && (
              conversion
                ? <ConversionReportView conversion={conversion as Record<string, any>} />
                : <p className="py-8 text-center text-[11px] text-muted-foreground">This session was not created by the Legacy Logic Converter.</p>
            )}

            {tab === "test" && (
              <div className="space-y-4">
                <TestCallPanel
                  sessionId={sessionId}
                  fixPending={sendPrompt.isPending}
                  onAskFix={(p) => sendPrompt.mutate(p)}
                />
                <div className="border-t border-white/[0.05] pt-3">
                  {sim
                    ? <SimulationView sim={sim} />
                    : <div className="py-4 text-center">
                        <p className="text-[11px] text-muted-foreground">
                          Run a safe simulation — it walks every workflow path, shows what
                          would trigger, and checks your workspace setup. Nothing is sent
                          to real customers.
                        </p>
                        <Button
                          size="sm" variant="outline" className="mt-3 gap-1.5 text-xs"
                          disabled={!currentVersion || runSim.isPending}
                          onClick={() => runSim.mutate()}
                        >
                          {runSim.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}
                          Run simulation
                        </Button>
                      </div>}
                </div>
              </div>
            )}

            {tab === "versions" && (
              <div className="space-y-2">
                {versions.length === 0 && (
                  <p className="py-8 text-center text-[11px] text-muted-foreground">No versions yet.</p>
                )}
                {versions.map((v: any) => (
                  <div
                    key={v.id}
                    className={cn(
                      "rounded-lg border p-3 space-y-1.5",
                      v.id === session.current_version_id
                        ? "border-sky-500/30 bg-sky-500/[0.04]"
                        : "border-white/[0.05] bg-white/[0.02]",
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-xs font-semibold">v{v.version_number}</p>
                      <StatusBadge status={v.status} />
                      <RiskBadge risk={v.risk_level} />
                      {v.id === session.current_version_id && (
                        <Badge variant="outline" className="text-[10px] border-sky-500/40 text-sky-300">current</Badge>
                      )}
                      {v.restored_from_version_id && (
                        <Badge variant="secondary" className="text-[10px]">restored</Badge>
                      )}
                      <span className="ml-auto text-[10px] text-muted-foreground">{fmtTime(v.created_at)}</span>
                    </div>
                    {v.user_prompt && (
                      <p className="text-[11px] text-muted-foreground line-clamp-2">
                        <span className="font-medium text-foreground/70">Prompt:</span> {v.user_prompt}
                      </p>
                    )}
                    {v.assistant_summary && (
                      <p className="text-[11px] text-muted-foreground line-clamp-3">{v.assistant_summary}</p>
                    )}
                    {v.generated_config && (() => {
                      const prevV = versions.find((p: any) => p.version_number === v.version_number - 1);
                      const d = diffBuildConfigs(
                        (prevV?.generated_config ?? null) as Record<string, any> | null,
                        v.generated_config as Record<string, any>,
                      );
                      return d.lines.length > 0 ? (
                        <div className="rounded-md border border-white/[0.05] bg-white/[0.02] px-2 py-1.5">
                          <ChangeSummary diff={d} versionNumber={v.version_number} compact />
                        </div>
                      ) : null;
                    })()}
                    {Array.isArray(v.risk_reasons) && v.risk_reasons.length > 0 && (
                      <p className="text-[10px] text-amber-300/80">{v.risk_reasons.join(" · ")}</p>
                    )}
                    {notesEditId === v.id ? (
                      <div className="flex items-end gap-2">
                        <Textarea
                          value={notesDraft}
                          onChange={(e) => setNotesDraft(e.target.value)}
                          className="min-h-[48px] resize-none text-[11px]"
                          placeholder="Notes about this version…"
                        />
                        <div className="flex flex-col gap-1">
                          <Button size="sm" className="h-6 px-2 text-[10px]" disabled={saveNotes.isPending} onClick={() => saveNotes.mutate(v.id)}>Save</Button>
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => setNotesEditId(null)}>Cancel</Button>
                        </div>
                      </div>
                    ) : v.notes ? (
                      <p className="flex items-start gap-1 text-[11px] text-sky-200/80">
                        <StickyNote className="mt-0.5 h-3 w-3 shrink-0" /> {v.notes}
                      </p>
                    ) : null}
                    <div className="flex items-center gap-1.5 pt-0.5">
                      {v.id !== session.current_version_id && !["pending_approval"].includes(v.status) && (
                        <Button
                          size="sm" variant="outline" className="h-6 gap-1 px-2 text-[10px]"
                          disabled={restore.isPending}
                          onClick={() => restore.mutate(v.id)}
                        >
                          <RotateCcw className="h-2.5 w-2.5" /> Restore
                        </Button>
                      )}
                      {notesEditId !== v.id && (
                        <Button
                          size="sm" variant="ghost" className="h-6 gap-1 px-2 text-[10px] text-muted-foreground"
                          onClick={() => { setNotesEditId(v.id); setNotesDraft(v.notes ?? ""); }}
                        >
                          <StickyNote className="h-2.5 w-2.5" /> {v.notes ? "Edit notes" : "Add notes"}
                        </Button>
                      )}
                      {v.applied_workflow_id && (
                        <Button
                          size="sm" variant="ghost" className="h-6 gap-1 px-2 text-[10px] text-muted-foreground"
                          onClick={() => navigate({ to: "/workflow-engine" })}
                        >
                          <ExternalLink className="h-2.5 w-2.5" /> View workflow
                        </Button>
                      )}
                    </div>
                  </div>
                ))}

                {snapshots.length > 0 && (
                  <div className="space-y-2 pt-3">
                    <p className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground/80">
                      <ShieldCheck className="h-3 w-3 text-emerald-400" /> Rollback snapshots
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      Taken automatically before each apply that changed an existing setup.
                      Rolling back restores the workflow (and agent configuration) exactly as it was.
                    </p>
                    {snapshots.map((s: any) => (
                      <div key={s.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-2">
                        <History className="h-3 w-3 shrink-0 text-muted-foreground" />
                        <p className="text-[11px]">
                          <span className="font-medium">{s.target_workflow_name ?? "Workflow"}</span>
                          {" · "}before v{s.version_number ?? "?"}
                        </p>
                        {s.restored_at ? (
                          <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-300">restored {fmtTime(s.restored_at)}</Badge>
                        ) : null}
                        <span className="text-[10px] text-muted-foreground">{fmtTime(s.created_at)}</span>
                        <Button
                          size="sm" variant="outline" className="ml-auto h-6 gap-1 px-2 text-[10px]"
                          disabled={rollback.isPending}
                          onClick={() => rollback.mutate(s.id)}
                        >
                          {rollback.isPending ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Undo2 className="h-2.5 w-2.5" />}
                          Roll back
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {tab === "deploy" && session.target_agent_id && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                  <Rocket className="h-4 w-4 text-emerald-400" />
                  <p className="text-xs font-medium">Apply &amp; deploy</p>
                  <div className="ml-auto flex flex-wrap items-center gap-1.5">
                    <Button
                      size="sm" variant="outline" className="h-7 gap-1 px-2.5 text-[11px]"
                      disabled={!canApply || apply.isPending || applyAndGoLive.isPending}
                      onClick={() => apply.mutate({ mode: "new_draft" })}
                    >
                      <FilePlus2 className="h-3 w-3" /> Save Draft
                    </Button>
                    <Button
                      size="sm" className="h-7 gap-1 px-2.5 text-[11px]"
                      disabled={!canApply || apply.isPending || applyAndGoLive.isPending || openSafetyPanel.isPending}
                      onClick={() => openSafetyPanel.mutate(false)}
                    >
                      <CheckCircle2 className="h-3 w-3" /> Apply
                    </Button>
                    {currentVersion?.risk_level !== "high" && (
                      <Button
                        size="sm"
                        className="h-7 gap-1 bg-emerald-600 px-2.5 text-[11px] text-white hover:bg-emerald-500"
                        disabled={!canApply || apply.isPending || applyAndGoLive.isPending || openSafetyPanel.isPending}
                        onClick={() => openSafetyPanel.mutate(true)}
                      >
                        <Rocket className="h-3 w-3" /> Apply &amp; Go Live
                      </Button>
                    )}
                    <Button
                      size="sm" variant="ghost" className="h-7 gap-1 px-2 text-[11px] text-muted-foreground"
                      onClick={() => navigate({ to: "/workflow-engine" })}
                    >
                      <ExternalLink className="h-3 w-3" /> View in Workflows
                    </Button>
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground/70">
                  Save Draft creates a separate inactive workflow (nothing existing changes). Apply
                  runs the safety check first and asks how to apply. Apply &amp; Go Live stays
                  disabled until the deployment checks below pass.
                </p>
                <DeploymentChecklistPanel agentId={session.target_agent_id} />
              </div>
            )}

            {tab === "requirements" && session.target_agent_id && (
              <RequirementsPanel
                agentId={session.target_agent_id}
                currentRequirements={(config?.requirements as Record<string, any>) ?? null}
                onVersionCreated={() => {
                  qc.invalidateQueries({ queryKey: ["smbw-session", sessionId] });
                  qc.invalidateQueries({ queryKey: ["smbw-sessions"] });
                }}
              />
            )}

            {tab === "usage" && (
              <div className="space-y-3">
                {!usage ? (
                  <p className="py-8 text-center text-[11px] text-muted-foreground">Loading usage…</p>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {[
                        ["Runs (30d)", String(usage.totalRuns ?? 0)],
                        ["Tokens", (usage.totalTokens ?? 0).toLocaleString()],
                        ["Time", fmtMs(usage.totalElapsedMs ?? 0)],
                        ["Charge", `$${Number(usage.totalChargeUsd ?? 0).toFixed(4)}`],
                      ].map(([label, value]) => (
                        <div key={label} className="rounded-lg border border-white/[0.05] bg-white/[0.02] p-3">
                          <p className="text-[10px] text-muted-foreground">{label}</p>
                          <p className="mt-0.5 text-sm font-semibold">{value}</p>
                        </div>
                      ))}
                    </div>
                    {usage.included && (
                      <p className="text-[11px] text-muted-foreground">
                        Plan allowance: {usage.included.runsPerMonth || "∞"} runs ·{" "}
                        {usage.included.secondsPerMonth || "∞"} seconds ·{" "}
                        {usage.included.tokensPerMonth ? usage.included.tokensPerMonth.toLocaleString() : "∞"} tokens per month.
                      </p>
                    )}
                    {usage.byTask && Object.keys(usage.byTask).length > 0 && (
                      <Section icon={Gauge} title="By task type">
                        {Object.entries(usage.byTask as Record<string, any>).map(([t, s]) => (
                          <p key={t} className="text-[11px] text-muted-foreground">
                            <span className="font-medium text-foreground/80">{t.replace(/_/g, " ")}</span>
                            {" — "}{s.runs} runs · {s.tokens.toLocaleString()} tokens · {fmtMs(s.elapsedMs)} · ${Number(s.chargeUsd).toFixed(4)}
                          </p>
                        ))}
                      </Section>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Apply safety panel ── */}
      <Dialog open={safetyOpen} onOpenChange={(o) => { if (!o) setSafetyOpen(false); }}>
        <DialogContent className="max-h-[85dvh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
              {safetyGoLive ? "Apply & Go Live — safety check" : "Apply — safety check"}
            </DialogTitle>
            <DialogDescription className="text-[11px]">
              Review what this apply will change before anything is written.
            </DialogDescription>
          </DialogHeader>

          {safetyReport && (() => {
            const impact = (safetyReport.impact ?? {}) as Record<string, any>;
            const conflicts = (impact.conflicts ?? []) as any[];
            const diff = (impact.diff ?? []) as any[];
            const deps = (impact.dependencies ?? []) as string[];
            const hasBlock = conflicts.some((c) => c.severity === "block");
            const goLiveBlocked = safetyGoLive && impact.canGoLive === false;
            const confirmDisabled =
              apply.isPending || applyAndGoLive.isPending ||
              (applyMode === "direct" && hasBlock) ||
              (safetyGoLive && (applyMode !== "direct" || goLiveBlocked));
            return (
              <div className="space-y-3">
                {/* Target */}
                <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-[11px]">
                  {impact.targetIsNew ? (
                    <p className="flex items-center gap-1.5 text-emerald-300">
                      <FilePlus2 className="h-3 w-3" /> This creates a brand-new workflow — nothing existing is touched.
                    </p>
                  ) : (
                    <>
                      <p>
                        Updates <span className="font-semibold">{impact.targetWorkflowName ?? "an existing workflow"}</span>
                        {impact.targetIsLive && <Badge variant="outline" className="ml-1.5 border-red-500/40 text-[10px] text-red-300">LIVE</Badge>}
                      </p>
                      {impact.targetAgentName && (
                        <p className="mt-1 text-muted-foreground">
                          Also updates the setup of agent <span className="font-medium text-foreground/80">{impact.targetAgentName}</span>
                          {impact.agentIsLive ? " (currently live)" : ""}.
                        </p>
                      )}
                      {impact.rollbackAvailable && (
                        <p className="mt-1 flex items-center gap-1 text-emerald-300/90">
                          <Undo2 className="h-3 w-3" /> A rollback snapshot is taken automatically before overwriting.
                        </p>
                      )}
                    </>
                  )}
                  {deps.length > 0 && (
                    <div className="mt-2 border-t border-white/[0.05] pt-2 text-muted-foreground">
                      <p className="font-medium text-foreground/70">Could also affect:</p>
                      {deps.map((d, i) => <p key={i}>• {d}</p>)}
                    </div>
                  )}
                </div>

                {/* Conflicts */}
                {conflicts.length > 0 && (
                  <div className="space-y-1.5">
                    {conflicts.map((c: any, i: number) => (
                      <div
                        key={i}
                        className={cn(
                          "rounded-lg border px-3 py-2 text-[11px]",
                          c.severity === "block" && "border-red-500/30 bg-red-500/[0.05] text-red-200",
                          c.severity === "needs_approval" && "border-amber-500/30 bg-amber-500/[0.05] text-amber-200",
                          c.severity === "block_go_live" && "border-orange-500/30 bg-orange-500/[0.05] text-orange-200",
                        )}
                      >
                        <p className="flex items-start gap-1.5">
                          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {c.message}
                        </p>
                        <p className="mt-0.5 pl-[18px] opacity-80">{c.suggestion}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Diff */}
                {diff.length > 0 && (
                  <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                    <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-foreground/80">
                      <GitCompareArrows className="h-3 w-3" /> What changes ({diff.length})
                    </p>
                    <div className="max-h-40 space-y-1 overflow-y-auto">
                      {diff.map((d: any, i: number) => (
                        <p key={i} className="text-[11px] text-muted-foreground">
                          <span className={cn(
                            "mr-1 font-semibold",
                            d.kind === "added" && "text-emerald-400",
                            d.kind === "removed" && "text-red-400",
                            (d.kind === "changed" || d.kind === "renamed") && "text-amber-400",
                            d.kind === "disabled" && "text-orange-400",
                          )}>{d.kind}</span>
                          {d.label}{d.detail ? ` — ${d.detail}` : ""}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
                {!impact.targetIsNew && diff.length === 0 && (
                  <p className="text-[11px] text-muted-foreground">No differences detected against the current setup.</p>
                )}

                {/* Apply mode chooser (only when a target exists) */}
                {!impact.targetIsNew && (
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-semibold text-foreground/80">How do you want to apply it?</p>
                    {([
                      ["new_draft",      FilePlus2,   "Save as new draft",      "Creates a separate inactive workflow. Nothing existing changes. Safest."],
                      ["direct",         CheckCircle2, "Update the existing one", "Overwrites the current setup (a rollback snapshot is taken first)."],
                      ["duplicate_edit", Copy,        "Duplicate & edit",        "Copies the existing workflow with the changes applied, as an inactive draft."],
                      ["propose",        SendToBack,  "Propose for approval",    "Sends the change to the HiveMind action centre for sign-off first."],
                    ] as const).map(([value, Icon, label, hint]) => {
                      const disabled = value === "direct" && hasBlock;
                      return (
                        <button
                          key={value}
                          disabled={disabled}
                          onClick={() => setApplyMode(value)}
                          className={cn(
                            "flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left transition-colors",
                            applyMode === value ? "border-sky-500/40 bg-sky-500/[0.08]" : "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05]",
                            disabled && "cursor-not-allowed opacity-40",
                          )}
                        >
                          <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-300" />
                          <span>
                            <span className="block text-[11px] font-medium">{label}</span>
                            <span className="block text-[10px] text-muted-foreground">{hint}</span>
                          </span>
                        </button>
                      );
                    })}
                    {safetyGoLive && applyMode !== "direct" && (
                      <p className="text-[10px] text-amber-300/90">
                        Go Live only works with “Update the existing one” — other modes save a draft without deploying.
                      </p>
                    )}
                  </div>
                )}

                {(safetyReport.riskLevel === "high" || impact.requiresApproval) && (
                  <p className="flex items-start gap-1.5 rounded-lg border border-amber-500/25 bg-amber-500/[0.05] px-3 py-2 text-[11px] text-amber-200/90">
                    <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    This change requires approval — confirming sends it to the HiveMind action centre instead of applying immediately.
                  </p>
                )}

                <DialogFooter className="gap-2 sm:gap-0">
                  <Button variant="ghost" size="sm" className="text-xs" onClick={() => setSafetyOpen(false)}>Cancel</Button>
                  <Button
                    size="sm"
                    className={cn("gap-1.5 text-xs", safetyGoLive && "bg-emerald-600 text-white hover:bg-emerald-500")}
                    disabled={confirmDisabled}
                    onClick={() =>
                      safetyGoLive
                        ? applyAndGoLive.mutate({ mode: applyMode })
                        : apply.mutate({ mode: applyMode })
                    }
                  >
                    {(apply.isPending || applyAndGoLive.isPending)
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : safetyGoLive ? <Rocket className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                    {safetyGoLive ? "Apply & Go Live" : "Confirm apply"}
                  </Button>
                </DialogFooter>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
