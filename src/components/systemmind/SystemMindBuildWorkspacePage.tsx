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
  ArrowRight, Bot, Workflow as WorkflowIcon, ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SystemMindShell } from "./SystemMindShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  createBuildSession, listBuildSessions, getBuildSession, promptBuildSession,
  simulateBuildVersion, applyBuildVersion, restoreBuildVersion,
  setBuildVersionNotes, setBuildSessionArchived, markBuildVersionDeployed,
  getSystemMindUsageSummary,
} from "@/lib/systemmind/build-workspace.functions";
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

// ── Page ────────────────────────────────────────────────────────────────────────

export function SystemMindBuildWorkspacePage() {
  const navigate = useNavigate();
  const qc       = useQueryClient();
  const search   = useSearch({ from: "/_authenticated/systemmind/build" }) as {
    session?: string; workflow?: string; agent?: string;
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

  const [prompt, setPrompt]           = useState("");
  const [tab, setTab]                 = useState<"config" | "test" | "versions" | "usage">("config");
  const [sim, setSim]                 = useState<Record<string, any> | null>(null);
  const [notesEditId, setNotesEditId] = useState<string | null>(null);
  const [notesDraft, setNotesDraft]   = useState("");
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

  const session  = detail?.session as Record<string, any> | undefined;
  const versions = (detail?.versions ?? []) as any[];
  const messages = (detail?.messages ?? []) as any[];
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

  const apply = useMutation({
    mutationFn: () => applyFn({ data: { sessionId: sessionId!, versionId: currentVersion!.id } }),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ["smbw-session", sessionId] });
      qc.invalidateQueries({ queryKey: ["smbw-sessions"] });
      if (res.requiresApproval) {
        toast.warning("Approval required before this goes live", {
          description: "This build affects live customer communication. It has been sent to the HiveMind action centre for approval.",
          duration: 8000,
        });
      } else {
        toast.success("Build applied", {
          description: "The workflow has been saved to your Workflows page.",
          action: {
            label: "View workflows",
            onClick: () => navigate({ to: "/workflow-engine" }),
          },
          duration: 8000,
        });
      }
    },
    onError: (e: any) => toast.error("Apply failed", { description: e?.message }),
  });

  const applyAndGoLive = useMutation({
    mutationFn: async () => {
      const versionId = currentVersion!.id;
      const res: any = await applyFn({ data: { sessionId: sessionId!, versionId } });
      if (res.requiresApproval) return { ...res, wentLive: false };
      // Reuse the EXISTING Go Live flow — same checks as the Deploy tab.
      await goLiveFn({ data: { id: session!.target_agent_id, agentType: "receptionist" } });
      await deployedFn({ data: { sessionId: sessionId!, versionId, deployTarget: "agent go-live" } });
      return { ...res, wentLive: true };
    },
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ["smbw-session", sessionId] });
      qc.invalidateQueries({ queryKey: ["smbw-sessions"] });
      if (res.requiresApproval) {
        toast.warning("Approval required before this goes live", {
          description: "This build affects live customer communication. It has been sent to the HiveMind action centre for approval.",
          duration: 8000,
        });
      } else if (res.wentLive) {
        toast.success("Applied & live", { description: "The workflow is saved and the agent is now live." });
      }
    },
    onError: (e: any) => {
      qc.invalidateQueries({ queryKey: ["smbw-session", sessionId] });
      toast.error("Go Live did not complete", {
        description: `${e?.message ?? "Unknown error"} — the applied version is saved; finish Go Live from the agent's Deploy tab.`,
        duration: 10000,
      });
    },
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
            <Button size="sm" className="gap-1.5 text-xs" onClick={() => newSession.mutate()} disabled={newSession.isPending}>
              {newSession.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Start a build
            </Button>
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
                      disabled={!canApply || apply.isPending || applyAndGoLive.isPending}
                      onClick={() => apply.mutate()}
                    >
                      {apply.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                      Apply
                    </Button>
                    {session.target_agent_id && currentVersion?.risk_level !== "high" && (
                      <Button
                        size="sm"
                        className="h-7 gap-1 bg-emerald-600 px-2.5 text-[11px] text-white hover:bg-emerald-500"
                        disabled={!canApply || apply.isPending || applyAndGoLive.isPending}
                        onClick={() => applyAndGoLive.mutate()}
                      >
                        {applyAndGoLive.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Rocket className="h-3 w-3" />}
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
    </SystemMindShell>
  );
}
