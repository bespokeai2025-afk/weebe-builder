// ── SystemMind Build Workspace ─────────────────────────────────────────────────
// Replit-style iterative agent/workflow builder: prompt → generate → test →
// re-prompt → version → apply → deploy. Everything is workspace-scoped and
// nothing touches a live workflow until Apply.
// The session workspace itself lives in BuildSessionView (shared with the
// Agent Builder right-side drawer); this page adds the sessions rail, the
// empty state and the Legacy Logic Converter.

import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Hammer, Loader2, Plus, Import, Trash2, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { SystemMindShell } from "./SystemMindShell";
import { BuildSessionView, fmtTime } from "./BuildSessionView";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { createBuildSession, listBuildSessions, deleteBuildSession } from "@/lib/systemmind/build-workspace.functions";
import {
  listLegacyConversionSources, convertLegacySourceToDraft,
} from "@/lib/systemmind/legacy-conversion.functions";

// Quick-start presets — merged in from the old Workflow Generator page.
const WORKFLOW_TYPES = [
  { value: "receptionist",         label: "Receptionist"          },
  { value: "lead_qualification",   label: "Lead Qualification"    },
  { value: "rebooking",            label: "Rebooking"             },
  { value: "appointment_booking",  label: "Appointment Booking"   },
  { value: "callback_scheduling",  label: "Callback Scheduling"   },
  { value: "document_collection",  label: "Document Collection"   },
  { value: "call_transfer",        label: "Call Transfer"         },
  { value: "whatsapp_followup",    label: "WhatsApp Follow-up"    },
  { value: "crm_update",           label: "CRM Update"            },
  { value: "post_call_summary",    label: "Post-Call Summary"     },
  { value: "client_intake",        label: "Client Intake"         },
  { value: "complaint_handling",   label: "Complaint Handling"    },
  { value: "sales_enquiry",        label: "Sales Enquiry"         },
  { value: "custom_workflow",      label: "Custom Workflow"       },
];

const EXAMPLE_PROMPTS: Record<string, string> = {
  rebooking:
    "If the caller wants a callback, collect preferred date and time, check calendar availability, confirm the slot, update CRM, and schedule the callback.",
  appointment_booking:
    "Greet the caller, collect their name and contact details, ask for their preferred appointment date and time, check availability, confirm the booking, and send a confirmation SMS.",
  lead_qualification:
    "Ask the caller about their business needs, budget range, timeline, and decision-making authority. Score the lead and route hot leads to sales, warm leads to nurture campaign.",
  receptionist:
    "Welcome callers to the company. Identify their need (sales, support, billing, or general enquiry). Route to the correct department or take a message if unavailable.",
  complaint_handling:
    "Listen to the caller's complaint, gather details, apologise empathetically, escalate urgent issues to a human agent, and log the complaint in the CRM.",
};

// ── Page ────────────────────────────────────────────────────────────────────────

export function SystemMindBuildWorkspacePage({ embedded = false }: { embedded?: boolean } = {}) {
  const navigate = useNavigate();
  const qc       = useQueryClient();
  const search   = useSearch({ strict: false }) as {
    session?: string; workflow?: string; agent?: string; convert?: string;
  };
  const sessionId = search.session;

  const createFn      = useServerFn(createBuildSession);
  const listFn        = useServerFn(listBuildSessions);
  const convSourcesFn = useServerFn(listLegacyConversionSources);
  const convertFn     = useServerFn(convertLegacySourceToDraft);

  const deleteFn = useServerFn(deleteBuildSession);

  const [convertOpen, setConvertOpen]         = useState(false);
  const [convertType, setConvertType]         = useState<string>("");
  const [convertSourceId, setConvertSourceId] = useState<string>("");
  const [convertDesc, setConvertDesc]         = useState("");

  // Quick-start (merged Workflow Generator): pick a type, describe it, and the
  // first prompt is sent automatically once the new session opens.
  const [quickType, setQuickType]     = useState<string>("");
  const [quickDesc, setQuickDesc]     = useState("");
  const [pendingPrompt, setPendingPrompt] = useState<{ sessionId: string; prompt: string } | null>(null);

  const { data: sessions, isLoading: sessionsLoading } = useQuery({
    queryKey: ["smbw-sessions"],
    queryFn: () => listFn(),
    throwOnError: false,
    staleTime: 30_000,
  });

  // Legacy Logic Converter: convertible sources (only fetched while the dialog is open)
  const { data: convSources, isLoading: convSourcesLoading } = useQuery({
    queryKey: ["smbw-convert-sources"],
    queryFn: () => convSourcesFn(),
    enabled: convertOpen,
    throwOnError: false,
    staleTime: 60_000,
  });

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

  const quickStart = useMutation({
    mutationFn: () => {
      const label = WORKFLOW_TYPES.find((w) => w.value === quickType)?.label;
      return createFn({ data: { title: label ? `${label} workflow` : undefined, sourcePage: "systemmind" } });
    },
    onSuccess: (res: any) => {
      const label = WORKFLOW_TYPES.find((w) => w.value === quickType)?.label;
      const prompt = [
        label && label !== "Custom Workflow" ? `Build a ${label.toLowerCase()} workflow.` : "Build this workflow:",
        quickDesc.trim(),
      ].filter(Boolean).join(" ");
      setPendingPrompt({ sessionId: res.sessionId, prompt });
      setQuickDesc("");
      qc.invalidateQueries({ queryKey: ["smbw-sessions"] });
      navigate({ to: "/systemmind/build", search: { session: res.sessionId, workflow: undefined, agent: undefined } });
    },
    onError: (e: any) => toast.error("Could not create build session", { description: e?.message }),
  });

  const removeSession = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { sessionId: id } }),
    onSuccess: (_res, id) => {
      qc.invalidateQueries({ queryKey: ["smbw-sessions"] });
      toast.success("Build session deleted");
      if (id === sessionId) {
        navigate({ to: "/systemmind/build", search: { session: undefined, workflow: undefined, agent: undefined } });
      }
    },
    onError: (e: any) => toast.error("Could not delete session", { description: e?.message }),
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

  const Wrapper = embedded ? EmbeddedPassthrough : SystemMindShell;
  return (
    <Wrapper>
      {/* Definite height (not h-full) — see full-height layout trap: 3rem = app header */}
      <div className={embedded ? "flex h-[calc(100dvh-9.5rem)] min-h-0 gap-4 py-4" : "flex h-[calc(100dvh-3rem)] min-h-0 gap-4 p-4"}>
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
              <div
                key={s.id}
                className={cn(
                  "group relative w-full rounded-lg border transition-colors",
                  s.id === sessionId
                    ? "border-sky-500/40 bg-sky-500/[0.08]"
                    : "border-white/[0.05] bg-white/[0.02] hover:bg-white/[0.05]",
                  s.status === "archived" && "opacity-50",
                )}
              >
                <button
                  onClick={() => navigate({ to: "/systemmind/build", search: { session: s.id, workflow: undefined, agent: undefined } })}
                  className="w-full px-2.5 py-2 pr-8 text-left"
                >
                  <p className="truncate text-xs font-medium">{s.title}</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {s.source_page?.replace(/_/g, " ")} · {fmtTime(s.updated_at)}
                  </p>
                </button>
                <button
                  title="Delete session"
                  disabled={removeSession.isPending}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm(`Delete build session "${s.title}"? Its versions and chat history go with it. Any workflow you already applied to the Workflows page stays untouched.`)) {
                      removeSession.mutate(s.id);
                    }
                  }}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground/50 opacity-0 transition-opacity hover:bg-red-500/[0.12] hover:text-red-400 group-hover:opacity-100 disabled:opacity-30"
                >
                  {removeSession.isPending && removeSession.variables === s.id
                    ? <Loader2 className="h-3 w-3 animate-spin" />
                    : <Trash2 className="h-3 w-3" />}
                </button>
              </div>
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
          <div className="flex min-h-0 flex-1 flex-col items-center gap-3 overflow-y-auto rounded-xl border border-white/[0.05] bg-white/[0.01] p-8 text-center [&>:first-child]:mt-auto [&>:last-child]:mb-auto">
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

            {/* ── Quick-start (merged Workflow Generator) ── */}
            <div className="mt-2 w-full max-w-md space-y-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-left">
              <p className="flex items-center gap-1.5 text-xs font-semibold">
                <Wand2 className="h-3.5 w-3.5 text-sky-400" /> Quick-start a workflow
              </p>
              <p className="text-[11px] text-muted-foreground">
                Pick a workflow type, describe it in plain English, and SystemMind generates
                the first version straight into a new build session.
              </p>
              <Select value={quickType} onValueChange={setQuickType} disabled={quickStart.isPending}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Workflow type…" />
                </SelectTrigger>
                <SelectContent>
                  {WORKFLOW_TYPES.map((wt) => (
                    <SelectItem key={wt.value} value={wt.value} className="text-xs">{wt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Textarea
                value={quickDesc}
                onChange={(e) => setQuickDesc(e.target.value)}
                placeholder={EXAMPLE_PROMPTS[quickType] ?? "Describe what the workflow should do, step by step…"}
                className="min-h-[80px] resize-none text-xs"
                disabled={quickStart.isPending}
              />
              <Button
                size="sm"
                className="gap-1.5 text-xs"
                disabled={quickStart.isPending || quickDesc.trim().length < 15}
                onClick={() => quickStart.mutate()}
              >
                {quickStart.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                Generate workflow
              </Button>

              {/* Clickable example prompt boxes */}
              <div className="space-y-1.5 pt-1">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                  Example prompts — click to use
                </p>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {(quickType && EXAMPLE_PROMPTS[quickType]
                    ? [{ value: quickType, label: WORKFLOW_TYPES.find((w) => w.value === quickType)?.label ?? "", prompt: EXAMPLE_PROMPTS[quickType] }]
                    : WORKFLOW_TYPES.filter((wt) => EXAMPLE_PROMPTS[wt.value]).map((wt) => ({ value: wt.value, label: wt.label, prompt: EXAMPLE_PROMPTS[wt.value] }))
                  ).map((ex) => (
                    <button
                      key={ex.value}
                      disabled={quickStart.isPending}
                      onClick={() => { setQuickType(ex.value); setQuickDesc(ex.prompt); }}
                      className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-left transition-colors hover:border-sky-500/30 hover:bg-sky-500/[0.06] disabled:opacity-50"
                    >
                      <p className="text-[10px] font-medium text-sky-300">{ex.label}</p>
                      <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">{ex.prompt}</p>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <BuildSessionView
            key={sessionId}
            sessionId={sessionId}
            initialPrompt={pendingPrompt?.sessionId === sessionId ? pendingPrompt.prompt : null}
            onInitialPromptConsumed={() => setPendingPrompt(null)}
          />
        )}
      </div>

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
    </Wrapper>
  );
}

function EmbeddedPassthrough({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
