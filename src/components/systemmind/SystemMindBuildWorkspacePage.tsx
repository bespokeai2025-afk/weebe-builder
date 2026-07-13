// ── SystemMind Build Workspace ─────────────────────────────────────────────────
// Replit-style iterative agent/workflow builder: prompt → generate → test →
// re-prompt → version → apply → deploy. Everything is workspace-scoped and
// nothing touches a live workflow until Apply.

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Hammer, Loader2, Send, Plus, Archive, ArchiveRestore, History,
  FlaskConical, FileCode2, Gauge, RotateCcw, CheckCircle2, AlertTriangle,
  ShieldAlert, Rocket, GitBranch, Variable, ListChecks, Bell, StickyNote,
  ArrowRight, Bot, Workflow as WorkflowIcon, ExternalLink, ShieldCheck,
  Undo2, GitCompareArrows, FilePlus2, Copy, SendToBack, Import, Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SystemMindShell } from "./SystemMindShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  createBuildSession, listBuildSessions, getBuildSession, promptBuildSession,
  simulateBuildVersion, applyBuildVersion, restoreBuildVersion,
  setBuildVersionNotes, setBuildSessionArchived, markBuildVersionDeployed,
  getSystemMindUsageSummary, getBuildApplySafetyReport, rollbackBuildApply,
} from "@/lib/systemmind/build-workspace.functions";
import {
  listLegacyConversionSources, convertLegacySourceToDraft, getConversionForSession,
} from "@/lib/systemmind/legacy-conversion.functions";
import { goLiveAgent } from "@/lib/agents/agents.functions";

// ── Small bits ─────────────────────────────────────────────────────────────────

function RiskBadge({ risk }: { risk?: string | null }) {
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

function StatusBadge({ status }: { status?: string | null }) {
  if (!status) return null;
  return (
    <Badge variant="outline" className={cn("text-[10px]", STATUS_STYLES[status] ?? "border-white/20")}>
      {status.replace(/_/g, " ")}
    </Badge>
  );
}

function fmtTime(iso?: string | null) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleString(); } catch { return ""; }
}

function fmtMs(ms: number) {
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

// ── Page ────────────────────────────────────────────────────────────────────────

export function SystemMindBuildWorkspacePage() {
  const navigate = useNavigate();
  const qc       = useQueryClient();
  const search   = useSearch({ from: "/_authenticated/systemmind/build" }) as {
    session?: string; workflow?: string; agent?: string; convert?: string;
  };
  const sessionId = search.session;

  const createFn   = useServerFn(createBuildSession);
  const listFn     = useServerFn(listBuildSessions);
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
  const convSourcesFn = useServerFn(listLegacyConversionSources);
  const convertFn     = useServerFn(convertLegacySourceToDraft);
  const conversionFn  = useServerFn(getConversionForSession);

  const [prompt, setPrompt]           = useState("");
  const [tab, setTab]                 = useState<"config" | "test" | "versions" | "usage" | "conversion">("config");
  const [convertOpen, setConvertOpen]   = useState(false);
  const [convertType, setConvertType]   = useState<string>("");
  const [convertSourceId, setConvertSourceId] = useState<string>("");
  const [convertDesc, setConvertDesc]   = useState("");
  const [sim, setSim]                 = useState<Record<string, any> | null>(null);
  const [notesEditId, setNotesEditId] = useState<string | null>(null);
  const [notesDraft, setNotesDraft]   = useState("");
  const [safetyOpen, setSafetyOpen]   = useState(false);
  const [safetyGoLive, setSafetyGoLive] = useState(false);
  const [safetyReport, setSafetyReport] = useState<Record<string, any> | null>(null);
  const [applyMode, setApplyMode]     = useState<"direct" | "new_draft" | "duplicate_edit" | "propose">("direct");
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const { data: sessions, isLoading: sessionsLoading } = useQuery({
    queryKey: ["smbw-sessions"],
    queryFn: () => listFn(),
    throwOnError: false,
    staleTime: 30_000,
  });

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ["smbw-session", sessionId],
    queryFn: () => getFn({ data: { sessionId: sessionId! } }),
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

  // Legacy Logic Converter: convertible sources (only fetched while the dialog is open)
  const { data: convSources, isLoading: convSourcesLoading } = useQuery({
    queryKey: ["smbw-convert-sources"],
    queryFn: () => convSourcesFn(),
    enabled: convertOpen,
    throwOnError: false,
    staleTime: 60_000,
  });

  // Conversion lineage row for the open session (drives the Conversion tab)
  const { data: conversion } = useQuery({
    queryKey: ["smbw-conversion", sessionId],
    queryFn: () => conversionFn({ data: { sessionId: sessionId! } }),
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
  const canApply = currentVersion && ["draft", "testing", "revised"].includes(String(currentVersion.status));

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // Edit-mode / builder entry: auto-create a session from URL params exactly once.
  const autoCreatedRef = useRef(false);
  useEffect(() => {
    if (sessionId || autoCreatedRef.current) return;
    if (!search.workflow && !search.agent) return;
    autoCreatedRef.current = true;
    createFn({
      data: {
        linkedWorkflowId: search.workflow ?? null,
        targetAgentId:    search.agent ?? null,
        sourcePage:       search.workflow ? "workflows" : "agent_builder",
      },
    })
      .then((res: any) => {
        qc.invalidateQueries({ queryKey: ["smbw-sessions"] });
        navigate({
          to: "/systemmind/build",
          search: { session: res.sessionId, workflow: undefined, agent: undefined },
          replace: true,
        });
      })
      .catch((e: any) => toast.error("Could not open build session", { description: e?.message }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, search.workflow, search.agent]);

  const newSession = useMutation({
    mutationFn: () => createFn({ data: {} }),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ["smbw-sessions"] });
      navigate({ to: "/systemmind/build", search: { session: res.sessionId, workflow: undefined, agent: undefined } });
    },
    onError: (e: any) => toast.error("Could not create build session", { description: e?.message }),
  });

  // Open the converter dialog automatically when arriving via ?convert=1
  const convertAutoOpenedRef = useRef(false);
  useEffect(() => {
    if (search.convert && !convertAutoOpenedRef.current) {
      convertAutoOpenedRef.current = true;
      setConvertOpen(true);
    }
  }, [search.convert]);

  const runConvert = useMutation({
    mutationFn: () => {
      if (!convertType) throw new Error("Pick what you want to convert.");
      if (convertType === "manual_description") {
        return convertFn({ data: { sourceType: convertType as any, description: convertDesc.trim(), sourcePage: "systemmind" } });
      }
      if (!convertSourceId) throw new Error("Pick the source to convert.");
      return convertFn({ data: { sourceType: convertType as any, sourceId: convertSourceId, sourcePage: "systemmind" } });
    },
    onSuccess: (res: any) => {
      setConvertOpen(false);
      setConvertType("");
      setConvertSourceId("");
      setConvertDesc("");
      setSim(null);
      setTab("conversion");
      qc.invalidateQueries({ queryKey: ["smbw-sessions"] });
      const rep = res?.report ?? {};
      const unsup = (rep.unsupported ?? []).length;
      toast.success("Converted to a WEBEE draft", {
        description: `${(rep.converted ?? []).length} element(s) converted${unsup ? `, ${unsup} need manual review` : ""}. The original is untouched.`,
        duration: 8000,
      });
      navigate({ to: "/systemmind/build", search: { session: res.sessionId, workflow: undefined, agent: undefined } });
    },
    onError: (e: any) => toast.error("Conversion failed", { description: e?.message, duration: 10000 }),
  });

  const sendPrompt = useMutation({
    mutationFn: async () => {
      const p = prompt.trim();
      if (!p) throw new Error("Describe what you want SystemMind to build or change.");
      return promptFn({ data: { sessionId: sessionId!, prompt: p } });
    },
    onSuccess: (res: any) => {
      setPrompt("");
      setSim(null);
      setTab("config");
      qc.invalidateQueries({ queryKey: ["smbw-session", sessionId] });
      qc.invalidateQueries({ queryKey: ["smbw-sessions"] });
      qc.invalidateQueries({ queryKey: ["smbw-usage"] });
      toast.success(`Version ${res.versionNumber} generated`, {
        description: `${res.riskLevel} risk · ${fmtMs(res.elapsedMs)} · ${res.totalTokens} tokens`,
      });
    },
    onError: (e: any) => {
      qc.invalidateQueries({ queryKey: ["smbw-session", sessionId] });
      toast.error("Generation failed", { description: e?.message });
    },
  });

  const runSim = useMutation({
    mutationFn: () => simulateFn({ data: { sessionId: sessionId!, versionId: currentVersion!.id } }),
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
      safetyFn({ data: { sessionId: sessionId!, versionId: currentVersion!.id } }).then((r: any) => ({ r, goLive })),
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
      applyFn({ data: { sessionId: sessionId!, versionId: currentVersion!.id, mode: vars.mode as any, goLiveIntent: vars.goLiveIntent } }),
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
        data: { sessionId: sessionId!, versionId, mode: (vars.mode ?? "direct") as any, goLiveIntent: true },
      });
      if (res.requiresApproval) return { ...res, wentLive: false };
      // Reuse the EXISTING Go Live flow — same checks as the Deploy tab.
      await goLiveFn({ data: { id: session!.target_agent_id, agentType: "receptionist" } });
      await deployedFn({ data: { sessionId: sessionId!, versionId, deployTarget: "agent go-live" } });
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
      rollbackFn({ data: { sessionId: sessionId!, snapshotId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["smbw-session", sessionId] });
      toast.success("Rolled back", { description: "The previous setup was restored from the snapshot." });
    },
    onError: (e: any) => toast.error("Rollback failed", { description: e?.message }),
  });

  const restore = useMutation({
    mutationFn: (versionId: string) => restoreFn({ data: { sessionId: sessionId!, versionId } }),
    onSuccess: (res: any) => {
      setSim(null);
      qc.invalidateQueries({ queryKey: ["smbw-session", sessionId] });
      toast.success(`Restored as version ${res.versionNumber}`);
    },
    onError: (e: any) => toast.error("Restore failed", { description: e?.message }),
  });

  const saveNotes = useMutation({
    mutationFn: (versionId: string) =>
      notesFn({ data: { sessionId: sessionId!, versionId, notes: notesDraft } }),
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

  const busy = sendPrompt.isPending;

  return (
    <SystemMindShell>
      {/* Definite height (not h-full) — see full-height layout trap: 3rem = app header */}
      <div className="flex h-[calc(100dvh-3rem)] min-h-0 gap-4 p-4">
        {/* ── Sessions rail ── */}
        <div className="hidden w-60 shrink-0 flex-col gap-2 lg:flex">
          <Button
            size="sm"
            className="w-full gap-1.5 text-xs"
            onClick={() => newSession.mutate()}
            disabled={newSession.isPending}
          >
            {newSession.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            New build
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="w-full gap-1.5 text-xs border-sky-500/30 text-sky-400 hover:text-sky-300"
            onClick={() => setConvertOpen(true)}
          >
            <Import className="h-3.5 w-3.5" />
            Convert legacy logic
          </Button>
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
            {sessionsLoading && <p className="px-2 py-4 text-center text-[11px] text-muted-foreground">Loading…</p>}
            {(sessions ?? []).map((s: any) => (
              <button
                key={s.id}
                onClick={() => navigate({ to: "/systemmind/build", search: { session: s.id, workflow: undefined, agent: undefined } })}
                className={cn(
                  "w-full rounded-lg border px-2.5 py-2 text-left transition-colors",
                  s.id === sessionId
                    ? "border-sky-500/40 bg-sky-500/[0.08]"
                    : "border-white/[0.05] bg-white/[0.02] hover:bg-white/[0.05]",
                  s.status === "archived" && "opacity-50",
                )}
              >
                <p className="truncate text-xs font-medium">{s.title}</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {s.source_page?.replace(/_/g, " ")} · {fmtTime(s.updated_at)}
                </p>
              </button>
            ))}
            {!sessionsLoading && (sessions ?? []).length === 0 && (
              <p className="px-2 py-6 text-center text-[11px] text-muted-foreground">
                No build sessions yet. Start one and tell SystemMind what to build.
              </p>
            )}
          </div>
        </div>

        {/* ── Main ── */}
        {!sessionId ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-white/[0.05] bg-white/[0.01] p-8 text-center">
            <Hammer className="h-8 w-8 text-sky-400/60" />
            <div>
              <p className="text-sm font-semibold">SystemMind Build Workspace</p>
              <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
                Describe the agent or workflow you want. SystemMind builds it, you test it,
                re-prompt until it's right, then Apply to save it to your Workflows page —
                nothing goes live without your say-so.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" className="gap-1.5 text-xs" onClick={() => newSession.mutate()} disabled={newSession.isPending}>
                {newSession.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                Start a build
              </Button>
              <Button
                size="sm" variant="outline"
                className="gap-1.5 text-xs border-sky-500/30 text-sky-400 hover:text-sky-300"
                onClick={() => setConvertOpen(true)}
              >
                <Import className="h-3.5 w-3.5" />
                Convert legacy logic
              </Button>
            </div>
            <p className="max-w-md text-[11px] text-muted-foreground/70">
              Convert legacy logic pulls an old setup — an agent flow, an n8n workflow, an email
              sequence, a WATI campaign, or a process you describe — into an editable draft here.
            </p>
          </div>
        ) : detailLoading ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !session ? (
          <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
            Build session not found.
          </div>
        ) : (
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
                <Button
                  size="sm" variant="ghost"
                  className="h-7 gap-1 px-2 text-[11px] text-muted-foreground"
                  onClick={() => archive.mutate({ id: session.id, archived: session.status !== "archived" })}
                >
                  {session.status === "archived"
                    ? (<><ArchiveRestore className="h-3 w-3" /> Restore</>)
                    : (<><Archive className="h-3 w-3" /> Archive</>)}
                </Button>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 gap-3">
              {/* Chat column */}
              <div className="flex min-h-0 w-[42%] min-w-[300px] flex-col rounded-xl border border-white/[0.05] bg-white/[0.01]">
                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
                  {messages.length === 0 && (
                    <p className="py-8 text-center text-[11px] text-muted-foreground">
                      Tell SystemMind what to build — e.g. “Build me a WhatsApp qualification
                      agent for estate agency leads.”
                    </p>
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
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" /> SystemMind is building…
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>
                <div className="border-t border-white/[0.05] p-2.5">
                  <div className="flex items-end gap-2">
                    <Textarea
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !busy) sendPrompt.mutate();
                      }}
                      placeholder={versions.length > 0 ? "Ask for changes — a new version will be created…" : "Describe the agent/workflow to build…"}
                      className="min-h-[60px] resize-none text-xs"
                      disabled={busy || session.status === "archived"}
                    />
                    <Button
                      size="sm"
                      className="h-9 gap-1.5 px-3 text-xs"
                      onClick={() => sendPrompt.mutate()}
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
                  {([
                    ["config",   FileCode2,    "Config"],
                    ["test",     FlaskConical, "Test"],
                    ["versions", History,      "Versions"],
                    ["usage",    Gauge,        "Usage"],
                    ...(conversion ? ([["conversion", Import, "Conversion"]] as const) : []),
                  ] as const).map(([key, Icon, label]) => (
                    <button
                      key={key}
                      onClick={() => setTab(key)}
                      className={cn(
                        "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors",
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
                  {tab === "config" && (
                    config
                      ? <ConfigPreview config={config} />
                      : <p className="py-8 text-center text-[11px] text-muted-foreground">Nothing generated yet — send SystemMind a prompt to create the first version.</p>
                  )}

                  {tab === "conversion" && (
                    conversion
                      ? <ConversionReportView conversion={conversion as Record<string, any>} />
                      : <p className="py-8 text-center text-[11px] text-muted-foreground">This session was not created by the Legacy Logic Converter.</p>
                  )}

                  {tab === "test" && (
                    sim
                      ? <SimulationView sim={sim} />
                      : <div className="py-8 text-center">
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
          </div>
        )}
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

      {/* ── Legacy Logic Converter dialog ── */}
      <Dialog open={convertOpen} onOpenChange={(o) => { if (!o && !runConvert.isPending) setConvertOpen(false); }}>
        <DialogContent className="max-h-[85dvh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Import className="h-4 w-4 text-sky-400" />
              Convert legacy logic
            </DialogTitle>
            <DialogDescription className="text-[11px]">
              SystemMind reads an old setup and rebuilds it as an editable WEBEE draft.
              The original is never modified, and nothing goes live until you Apply.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold text-foreground/80">What do you want to convert?</p>
              <Select
                value={convertType}
                onValueChange={(v) => { setConvertType(v); setConvertSourceId(""); }}
                disabled={runConvert.isPending}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Pick a source type…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="agent" className="text-xs">Existing agent (call flow → workflow)</SelectItem>
                  <SelectItem value="workflow" className="text-xs">Existing WEBEE workflow (load for editing)</SelectItem>
                  <SelectItem value="n8n" className="text-xs">n8n workflow</SelectItem>
                  <SelectItem value="hexmail_sequence" className="text-xs">Email follow-up sequence</SelectItem>
                  <SelectItem value="wati_setup" className="text-xs">WATI WhatsApp campaign</SelectItem>
                  <SelectItem value="webform_auto_call" className="text-xs">Webform + auto-call setup</SelectItem>
                  <SelectItem value="manual_description" className="text-xs">Describe a process manually</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {convertType && convertType !== "manual_description" && (() => {
              const options: Array<{ id: string; label: string }> =
                convertType === "agent"             ? ((convSources?.agents ?? []) as any[]).map((a) => ({ id: a.id, label: `${a.name}${a.agent_type ? ` (${a.agent_type})` : ""}` })) :
                convertType === "workflow"          ? ((convSources?.workflows ?? []) as any[]).map((w) => ({ id: w.id, label: `${w.name}${w.is_active ? " (active)" : ""}` })) :
                convertType === "n8n"               ? ((convSources?.n8n ?? []) as any[]).map((n) => ({ id: n.id, label: n.name })) :
                convertType === "hexmail_sequence"  ? ((convSources?.sequences ?? []) as any[]).map((s) => ({ id: s.id, label: `${s.name}${s.status ? ` (${s.status})` : ""}` })) :
                convertType === "wati_setup"        ? ((convSources?.wati ?? []) as any[]).map((w) => ({ id: w.id, label: `${w.name}${w.template_name ? ` — ${w.template_name}` : ""}` })) :
                ((convSources?.webforms ?? []) as any[]).map((w) => ({ id: w.id, label: `${w.name}${w.status ? ` (${w.status})` : ""}` }));
              return (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-semibold text-foreground/80">Pick the source</p>
                  {convSourcesLoading ? (
                    <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" /> Loading your sources…
                    </p>
                  ) : options.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground">
                      Nothing found for this source type in your workspace.
                    </p>
                  ) : (
                    <Select value={convertSourceId} onValueChange={setConvertSourceId} disabled={runConvert.isPending}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Pick one…" />
                      </SelectTrigger>
                      <SelectContent>
                        {options.map((o) => (
                          <SelectItem key={o.id} value={o.id} className="text-xs">{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              );
            })()}

            {convertType === "manual_description" && (
              <div className="space-y-1.5">
                <p className="text-[11px] font-semibold text-foreground/80">Describe the process</p>
                <Textarea
                  value={convertDesc}
                  onChange={(e) => setConvertDesc(e.target.value)}
                  placeholder="e.g. “When a lead comes in from our website we call them within 5 minutes; if no answer we send a WhatsApp, then email the day after…”"
                  className="min-h-[100px] resize-none text-xs"
                  disabled={runConvert.isPending}
                />
                <p className="text-[10px] text-muted-foreground/70">
                  SystemMind will convert this into a workflow draft and clearly mark any assumptions it makes.
                </p>
              </div>
            )}

            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="ghost" size="sm" className="text-xs" disabled={runConvert.isPending} onClick={() => setConvertOpen(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                className="gap-1.5 text-xs"
                disabled={
                  runConvert.isPending ||
                  !convertType ||
                  (convertType === "manual_description" ? convertDesc.trim().length < 20 : !convertSourceId)
                }
                onClick={() => runConvert.mutate()}
              >
                {runConvert.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Import className="h-3.5 w-3.5" />}
                {runConvert.isPending ? "Converting…" : "Convert to draft"}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </SystemMindShell>
  );
}
