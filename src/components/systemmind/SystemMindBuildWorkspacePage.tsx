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
import { Hammer, Loader2, Plus, Import } from "lucide-react";
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
import { createBuildSession, listBuildSessions } from "@/lib/systemmind/build-workspace.functions";
import {
  listLegacyConversionSources, convertLegacySourceToDraft,
} from "@/lib/systemmind/legacy-conversion.functions";

// ── Page ────────────────────────────────────────────────────────────────────────

export function SystemMindBuildWorkspacePage() {
  const navigate = useNavigate();
  const qc       = useQueryClient();
  const search   = useSearch({ from: "/_authenticated/systemmind/build" }) as {
    session?: string; workflow?: string; agent?: string; convert?: string;
  };
  const sessionId = search.session;

  const createFn      = useServerFn(createBuildSession);
  const listFn        = useServerFn(listBuildSessions);
  const convSourcesFn = useServerFn(listLegacyConversionSources);
  const convertFn     = useServerFn(convertLegacySourceToDraft);

  const [convertOpen, setConvertOpen]         = useState(false);
  const [convertType, setConvertType]         = useState<string>("");
  const [convertSourceId, setConvertSourceId] = useState<string>("");
  const [convertDesc, setConvertDesc]         = useState("");

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
        ) : (
          <BuildSessionView key={sessionId} sessionId={sessionId} />
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
    </SystemMindShell>
  );
}
