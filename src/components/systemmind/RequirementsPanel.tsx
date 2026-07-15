// ── SystemMind Guided Requirements Assistant — Build Workspace tab panel ──────
// Flow: analyze agent → show detected setup → gap-driven questions with
// recommended defaults → generate (deterministic, lands as a normal Build
// Workspace version) → approve/reject script-addition drafts → simulate →
// re-prompt in plain language. Apply / Go Live stay in the existing toolbar.

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Bot, CheckCircle2, ChevronDown, FlaskConical, KeyRound, Loader2, RefreshCcw,
  ShieldCheck, Sparkles, Wand2, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  startRequirementsInterview,
  answerRequirementsQuestions,
  generateRequirementsVersion,
  setScriptAdditionStatus,
  simulateRequirements,
  repromptRequirements,
} from "@/lib/systemmind/requirements.functions";

type Question = {
  key: string; section: string; prompt: string;
  type: "choice" | "boolean" | "text" | "number";
  options?: Array<{ value: string; label: string }>;
  recommendedDefault: unknown; required: boolean; whyAsked: string;
};

export function RequirementsPanel({
  agentId,
  currentRequirements,
  onVersionCreated,
}: {
  agentId: string;
  currentRequirements: Record<string, any> | null;
  onVersionCreated: () => void;
}) {
  const qc = useQueryClient();
  const startFn    = useServerFn(startRequirementsInterview);
  const answerFn   = useServerFn(answerRequirementsQuestions);
  const generateFn = useServerFn(generateRequirementsVersion);
  const scriptFn   = useServerFn(setScriptAdditionStatus);
  const simFn      = useServerFn(simulateRequirements);
  const repromptFn = useServerFn(repromptRequirements);

  const [draft, setDraft]           = useState<Record<string, string | number | boolean>>({});
  const [simResults, setSimResults] = useState<any[] | null>(null);
  const [instruction, setInstruction] = useState("");
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});

  const { data: interview, isLoading, error, refetch } = useQuery({
    queryKey: ["smbw-requirements", agentId],
    queryFn: () => startFn({ data: { agentId } }),
    throwOnError: false,
    staleTime: 30_000,
  });

  const detected  = (interview?.detected ?? null) as Record<string, any> | null;
  const questions = ((interview?.questions ?? []) as Question[]);
  const answers   = (interview?.answers ?? {}) as Record<string, string | number | boolean>;

  const sections = useMemo(() => {
    const map = new Map<string, Question[]>();
    for (const q of questions) {
      if (!map.has(q.section)) map.set(q.section, []);
      map.get(q.section)!.push(q);
    }
    return [...map.entries()];
  }, [questions]);

  const valueFor = (q: Question): string | number | boolean => {
    if (draft[q.key] !== undefined) return draft[q.key];
    if (answers[q.key] !== undefined) return answers[q.key];
    return q.recommendedDefault as string | number | boolean;
  };
  const answeredCount = questions.filter((q) => answers[q.key] !== undefined || draft[q.key] !== undefined).length;

  const generate = useMutation({
    mutationFn: async () => {
      if (!interview) throw new Error("Interview not ready yet.");
      // Persist every question's effective value (draft > saved > recommended
      // default) so the generated config matches exactly what's on screen.
      const patch: Record<string, string | number | boolean> = {};
      for (const q of questions) patch[q.key] = valueFor(q);
      await answerFn({ data: { interviewId: interview.id, answers: patch } });
      return generateFn({ data: { interviewId: interview.id } });
    },
    onSuccess: () => {
      toast.success("Requirements generated", {
        description: "Saved as a new draft version. Nothing is live and no calls are activated — review, then Apply when ready.",
      });
      setDraft({});
      setSimResults(null);
      qc.invalidateQueries({ queryKey: ["smbw-requirements", agentId] });
      onVersionCreated();
    },
    onError: (e: any) => toast.error("Could not generate requirements", { description: e?.message }),
  });

  const decideScript = useMutation({
    mutationFn: (vars: { additionId: string; decision: "approved" | "rejected" }) =>
      scriptFn({ data: { interviewId: interview!.id, additionId: vars.additionId, decision: vars.decision } }),
    onSuccess: (_res, vars) => {
      toast.success(vars.decision === "approved" ? "Script addition approved" : "Script addition rejected", {
        description: vars.decision === "approved"
          ? "Merged into the draft prompt as a new version. The live agent is unchanged until you Apply."
          : "The draft stays recorded but will never be merged.",
      });
      qc.invalidateQueries({ queryKey: ["smbw-requirements", agentId] });
      onVersionCreated();
    },
    onError: (e: any) => toast.error("Could not update script addition", { description: e?.message }),
  });

  const runSim = useMutation({
    mutationFn: () => simFn({ data: { interviewId: interview!.id, outcome: null } }),
    onSuccess: (res: any) => setSimResults(res ?? []),
    onError: (e: any) => toast.error("Simulation failed", { description: e?.message }),
  });

  const reprompt = useMutation({
    mutationFn: () => repromptFn({ data: { interviewId: interview!.id, instruction: instruction.trim() } }),
    onSuccess: (res: any) => {
      toast.success("Requirements updated", {
        description: `${res.changedKeys.length} setting${res.changedKeys.length === 1 ? "" : "s"} changed and a new version generated.${res.explanation ? ` ${res.explanation}` : ""}`,
      });
      setInstruction("");
      setSimResults(null);
      qc.invalidateQueries({ queryKey: ["smbw-requirements", agentId] });
      onVersionCreated();
    },
    onError: (e: any) => toast.error("Could not apply that change", { description: e?.message }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-[11px] text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Analyzing your agent…
      </div>
    );
  }
  if (error || !interview) {
    return (
      <div className="space-y-2 py-8 text-center">
        <p className="text-[11px] text-rose-300">{(error as any)?.message ?? "Could not start the requirements assistant."}</p>
        <Button size="sm" variant="outline" className="h-7 px-2.5 text-[11px]" onClick={() => refetch()}>
          <RefreshCcw className="mr-1 h-3 w-3" /> Retry
        </Button>
      </div>
    );
  }

  const scriptAdditions: any[] = Array.isArray(currentRequirements?.script_additions)
    ? currentRequirements!.script_additions : [];
  const proposed = scriptAdditions.filter((s) => s.status === "proposed");
  const decided  = scriptAdditions.filter((s) => s.status !== "proposed");

  return (
    <div className="space-y-4">
      {/* Detected setup */}
      {detected && (
        <div className="rounded-lg border border-white/[0.05] bg-white/[0.02] p-3">
          <div className="mb-2 flex items-center gap-2">
            <Bot className="h-3.5 w-3.5 text-sky-300" />
            <p className="text-[12px] font-medium">What SystemMind detected</p>
            <Badge variant="outline" className="ml-auto text-[10px]">{detected.detectedPurpose}</Badge>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-muted-foreground sm:grid-cols-3">
            <span>Channel: <span className="text-foreground">{detected.channel}</span></span>
            <span>Flow nodes: <span className="text-foreground">{detected.nodeCount}</span></span>
            <span>Variables: <span className="text-foreground">{(detected.variables ?? []).length}</span></span>
            <span>Booking logic: <span className="text-foreground">{detected.hasBookingLogic ? "yes" : "no"}</span></span>
            <span>Opt-out handling: <span className={cn(detected.hasOptOutLogic ? "text-foreground" : "text-amber-300")}>{detected.hasOptOutLogic ? "yes" : "missing"}</span></span>
            <span>CRM mapping: <span className={cn(detected.hasCrmFieldMapping ? "text-foreground" : "text-amber-300")}>{detected.hasCrmFieldMapping ? "yes" : "missing"}</span></span>
          </div>
        </div>
      )}

      {/* SOP §2 — REQUIRED KEY box: the chosen data source needs an access key */}
      {(() => {
        const src = String(draft["data_source_kind"] ?? answers["data_source_kind"] ?? "");
        const needsKey = src === "crm" || src === "call_source";
        const keyName = String(
          draft["data_source_key_name"] ??
          (currentRequirements as any)?.data_source?.required_key_name ??
          answers["data_source_key_name"] ??
          (src === "crm" ? "CRM API key" : "Call source API key"),
        );
        if (!needsKey) return null;
        return (
          <div className="rounded-lg border border-amber-400/40 bg-amber-400/[0.06] p-3">
            <div className="flex items-center gap-2">
              <KeyRound className="h-3.5 w-3.5 text-amber-300" />
              <p className="text-[12px] font-medium text-amber-200">Required key: {keyName}</p>
            </div>
            <p className="mt-1 text-[11px] text-amber-200/80">
              This agent pulls its {src === "crm" ? "leads from your CRM" : "calls from your call source"} — access is required before it can go live.
              Add the actual key value securely in Settings → Integrations. Never paste key values into this assistant.
            </p>
          </div>
        );
      })()}

      {/* Questions, grouped by section */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <p className="text-[12px] font-medium">Fill the gaps ({answeredCount}/{questions.length} answered)</p>
          <p className="ml-auto text-[10px] text-muted-foreground">Recommended defaults are pre-filled — change only what you want.</p>
        </div>
        {sections.map(([section, qs]) => {
          const open = openSections[section] ?? true;
          return (
            <div key={section} className="rounded-lg border border-white/[0.05] bg-white/[0.01]">
              <button
                className="flex w-full items-center gap-2 px-3 py-2 text-left"
                onClick={() => setOpenSections((s) => ({ ...s, [section]: !open }))}
              >
                <ChevronDown className={cn("h-3 w-3 transition-transform", !open && "-rotate-90")} />
                <p className="text-[11px] font-medium">{section}</p>
                <span className="ml-auto text-[10px] text-muted-foreground">{qs.length} question{qs.length === 1 ? "" : "s"}</span>
              </button>
              {open && (
                <div className="space-y-3 border-t border-white/[0.05] p-3">
                  {qs.map((q) => (
                    <div key={q.key} className="space-y-1">
                      <p className="text-[11px]">{q.prompt}{q.required && <span className="text-rose-300"> *</span>}</p>
                      <p className="text-[10px] text-muted-foreground">{q.whyAsked}</p>
                      {q.type === "choice" && (
                        <Select
                          value={String(valueFor(q))}
                          onValueChange={(v) => setDraft((d) => ({ ...d, [q.key]: v }))}
                        >
                          <SelectTrigger className="h-7 w-full max-w-sm text-[11px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {(q.options ?? []).map((o) => (
                              <SelectItem key={o.value} value={o.value} className="text-[11px]">
                                {o.label}{o.value === q.recommendedDefault ? " (recommended)" : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                      {q.type === "boolean" && (
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={Boolean(valueFor(q))}
                            onCheckedChange={(v) => setDraft((d) => ({ ...d, [q.key]: v }))}
                          />
                          <span className="text-[10px] text-muted-foreground">
                            {Boolean(valueFor(q)) ? "Yes" : "No"}
                            {q.recommendedDefault === Boolean(valueFor(q)) ? " (recommended)" : ""}
                          </span>
                        </div>
                      )}
                      {(q.type === "text" || q.type === "number") && (
                        <Input
                          className="h-7 max-w-sm text-[11px]"
                          type={q.type === "number" ? "number" : "text"}
                          value={String(valueFor(q))}
                          onChange={(e) =>
                            setDraft((d) => ({
                              ...d,
                              [q.key]: q.type === "number" ? Number(e.target.value) : e.target.value,
                            }))
                          }
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm" className="h-7 gap-1 px-2.5 text-[11px]"
          disabled={generate.isPending}
          onClick={() => generate.mutate()}
        >
          {generate.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
          {interview.lastGeneratedVersionId ? "Regenerate requirements" : "Generate requirements"}
        </Button>
        {interview.lastGeneratedVersionId && (
          <Button
            size="sm" variant="outline" className="h-7 gap-1 px-2.5 text-[11px]"
            disabled={runSim.isPending}
            onClick={() => runSim.mutate()}
          >
            {runSim.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <FlaskConical className="h-3 w-3" />}
            Simulate outcomes
          </Button>
        )}
        <p className="text-[10px] text-muted-foreground">
          Generation only creates a draft version — nothing goes live and no calling is activated here.
        </p>
      </div>

      {/* Script-addition drafts (approval-gated) */}
      {(proposed.length > 0 || decided.length > 0) && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-3.5 w-3.5 text-amber-300" />
            <p className="text-[12px] font-medium">Script additions (need your approval)</p>
          </div>
          {proposed.map((s) => (
            <div key={s.id} className="rounded-lg border border-amber-500/20 bg-amber-500/[0.04] p-3">
              <div className="mb-1 flex items-center gap-2">
                <p className="text-[11px] font-medium">{s.title}</p>
                <Badge variant="outline" className="border-amber-500/40 text-[10px] text-amber-300">proposed</Badge>
              </div>
              <p className="mb-1 text-[10px] text-muted-foreground">{s.reason}</p>
              <p className="whitespace-pre-wrap rounded bg-black/20 p-2 text-[10px]">{s.suggested_text}</p>
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm" className="h-6 gap-1 bg-emerald-600 px-2 text-[10px] text-white hover:bg-emerald-500"
                  disabled={decideScript.isPending}
                  onClick={() => decideScript.mutate({ additionId: s.id, decision: "approved" })}
                >
                  <CheckCircle2 className="h-2.5 w-2.5" /> Approve &amp; merge
                </Button>
                <Button
                  size="sm" variant="outline" className="h-6 gap-1 px-2 text-[10px]"
                  disabled={decideScript.isPending}
                  onClick={() => decideScript.mutate({ additionId: s.id, decision: "rejected" })}
                >
                  <X className="h-2.5 w-2.5" /> Reject
                </Button>
              </div>
            </div>
          ))}
          {decided.map((s) => (
            <div key={s.id} className="flex items-center gap-2 rounded-lg border border-white/[0.05] bg-white/[0.01] px-3 py-2">
              <p className="text-[11px]">{s.title}</p>
              <Badge
                variant="outline"
                className={cn("ml-auto text-[10px]", s.status === "approved" ? "border-emerald-500/40 text-emerald-300" : "border-rose-500/40 text-rose-300")}
              >
                {s.status}
              </Badge>
            </div>
          ))}
        </div>
      )}

      {/* Simulation results */}
      {simResults && (
        <div className="space-y-2">
          <p className="text-[12px] font-medium">Simulated call outcomes (no real calls, no CRM writes)</p>
          {simResults.map((r: any) => (
            <div key={r.outcome} className="rounded-lg border border-white/[0.05] bg-white/[0.01] p-2.5">
              <div className="mb-1 flex items-center gap-2">
                <Badge variant="outline" className="text-[10px] capitalize">{String(r.outcome).replace(/_/g, " ")}</Badge>
                {!r.matched && <span className="text-[10px] text-amber-300">no rule configured</span>}
              </div>
              <ul className="space-y-0.5">
                {(r.actions ?? []).map((a: any, i: number) => (
                  <li key={i} className="text-[10px] text-muted-foreground">• {a.detail}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {/* Re-prompt */}
      {interview.lastGeneratedVersionId && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-sky-300" />
            <p className="text-[12px] font-medium">Change something in plain language</p>
          </div>
          <div className="flex gap-2">
            <Input
              className="h-7 text-[11px]"
              placeholder={`e.g. "make neutral calls retry after 24 hours" or "don't create tasks for bookings"`}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && instruction.trim().length >= 3 && !reprompt.isPending) reprompt.mutate(); }}
            />
            <Button
              size="sm" className="h-7 gap-1 px-2.5 text-[11px]"
              disabled={reprompt.isPending || instruction.trim().length < 3}
              onClick={() => reprompt.mutate()}
            >
              {reprompt.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              Update
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
