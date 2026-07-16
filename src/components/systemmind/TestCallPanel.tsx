// ── SystemMind Test Call Validation Loop — UI panel (Test tab) ─────────────────
// User runs a REAL test call against the target agent, then SystemMind fetches
// it, validates expected-vs-actual against the current build version, shows a
// per-check breakdown + plain-English diagnosis, and can send a fix request
// back into the build chat (normal draft + approval machinery). A passed test
// (or a reasoned manual override) is MANDATORY before Go Live for build
// sessions.

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  PhoneCall, Loader2, CheckCircle2, XCircle, AlertTriangle, RefreshCw,
  Wrench, ShieldCheck, History,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  getBuildTestCallState, listBuildTestCallCandidates,
  analyzeBuildTestCall, overrideBuildTestPassed,
} from "@/lib/systemmind/build-workspace.functions";

function CheckRow({ c }: { c: { key: string; label: string; status: string; detail: string } }) {
  const Icon = c.status === "passed" ? CheckCircle2 : c.status === "failed" ? XCircle : AlertTriangle;
  const color = c.status === "passed" ? "text-emerald-400" : c.status === "failed" ? "text-red-400" : "text-amber-400";
  return (
    <div className="flex items-start gap-2 rounded-md border border-white/[0.05] bg-white/[0.02] px-2.5 py-2">
      <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", color)} />
      <div className="min-w-0">
        <p className="text-[11px] font-medium">{c.label}</p>
        <p className="text-[10px] text-muted-foreground">{c.detail}</p>
      </div>
    </div>
  );
}

function fmt(ts?: string | null) {
  if (!ts) return "";
  try { return new Date(ts).toLocaleString(); } catch { return String(ts); }
}

export function TestCallPanel({
  sessionId,
  onAskFix,
  fixPending,
}: {
  sessionId: string;
  onAskFix: (prompt: string) => void;
  fixPending: boolean;
}) {
  const qc = useQueryClient();
  const stateFn      = useServerFn(getBuildTestCallState);
  const candidatesFn = useServerFn(listBuildTestCallCandidates);
  const analyzeFn    = useServerFn(analyzeBuildTestCall);
  const overrideFn   = useServerFn(overrideBuildTestPassed);

  const [scenario, setScenario]       = useState("positive_booked");
  const [picking, setPicking]         = useState(false);
  const [selectedCall, setSelectedCall] = useState<string | null>(null);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  const { data: state, isLoading } = useQuery({
    queryKey: ["smbw-testcall", sessionId],
    queryFn: () => stateFn({ data: { sessionId } }),
    enabled: !!sessionId,
    throwOnError: false,
  });

  const { data: candidates, isFetching: candidatesLoading, refetch: refetchCandidates } = useQuery({
    queryKey: ["smbw-testcall-candidates", sessionId],
    queryFn: () => candidatesFn({ data: { sessionId } }),
    enabled: picking,
    throwOnError: false,
    staleTime: 0,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["smbw-testcall", sessionId] });

  const analyze = useMutation({
    mutationFn: (callId: string) => analyzeFn({ data: { sessionId, callId, scenario } }),
    onSuccess: (row: any) => {
      setPicking(false);
      setSelectedCall(null);
      invalidate();
      row?.passed
        ? toast.success("Test call passed", { description: "SystemMind validated the call against this build." })
        : toast.error("Test call failed validation", { description: "See the diagnosis below — you can ask SystemMind to fix it." });
    },
    onError: (e: any) => toast.error("Analysis failed", { description: e?.message }),
  });

  const override = useMutation({
    mutationFn: () => overrideFn({ data: { sessionId, reason: overrideReason } }),
    onSuccess: () => {
      setOverrideOpen(false);
      setOverrideReason("");
      invalidate();
      toast.success("Sent to HiveMind for approval", { description: "The manual pass takes effect once it's approved in the HiveMind action centre." });
    },
    onError: (e: any) => toast.error("Could not request a manual pass", { description: e?.message }),
  });

  if (isLoading) {
    return <div className="flex justify-center py-6"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>;
  }
  if (!state?.versionId) {
    return (
      <p className="py-4 text-center text-[11px] text-muted-foreground">
        Generate a build version first — then run a real test call to validate it.
      </p>
    );
  }

  const gate = state.gate;
  const latest = gate?.latest as any | null;
  const latestFull = (state.history ?? []).find((h: any) => h.id === latest?.id) ?? latest;

  return (
    <div className="space-y-3">
      {/* Gate banner */}
      <div className={cn(
        "flex items-center gap-2 rounded-lg border px-3 py-2",
        gate?.status === "passed" ? "border-emerald-500/30 bg-emerald-500/[0.06]"
          : gate?.status === "failed" ? "border-red-500/30 bg-red-500/[0.06]"
          : "border-amber-500/30 bg-amber-500/[0.06]",
      )}>
        <ShieldCheck className={cn("h-4 w-4",
          gate?.status === "passed" ? "text-emerald-400" : gate?.status === "failed" ? "text-red-400" : "text-amber-400")} />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold">
            {gate?.status === "passed" ? "Test call gate: PASSED"
              : gate?.status === "failed" ? "Test call gate: FAILED"
              : "Test call gate: not tested yet"}
          </p>
          <p className="text-[10px] text-muted-foreground">
            A validated test call is required before this build can go live (v{state.versionNumber}).
            {latest?.is_manual_override ? " Passed via manual override." : ""}
          </p>
        </div>
        {gate?.status !== "passed" && (
          <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => setOverrideOpen((v) => !v)}>
            Request manual pass
          </Button>
        )}
      </div>

      {overrideOpen && (
        <div className="space-y-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
          <p className="text-[11px] font-medium">Request a manual pass (HiveMind approval required)</p>
          <Textarea
            value={overrideReason}
            onChange={(e) => setOverrideReason(e.target.value)}
            placeholder="Why should the test gate be skipped? (required — sent to HiveMind and recorded in the audit log)"
            className="min-h-[60px] text-[11px]"
          />
          <div className="flex gap-2">
            <Button size="sm" className="h-7 text-[11px]" disabled={overrideReason.trim().length < 5 || override.isPending} onClick={() => override.mutate()}>
              {override.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Send to HiveMind"}
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => setOverrideOpen(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {/* Run a test */}
      <div className="space-y-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
        <div className="flex items-center gap-2">
          <PhoneCall className="h-3.5 w-3.5 text-sky-300" />
          <p className="text-[11px] font-semibold">Run a real test call</p>
        </div>
        <p className="text-[10px] text-muted-foreground">
          1. Choose the scenario you'll act out. 2. Call the agent (web test call or its phone number) and play that scenario.
          3. When the call ends, click “I made the test call” and SystemMind will fetch and validate it.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={scenario}
            onChange={(e) => setScenario(e.target.value)}
            className="h-7 rounded-md border border-white/[0.08] bg-background px-2 text-[11px]"
          >
            {(state.scenarios ?? []).map((s: any) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
          <Button
            size="sm" variant="outline" className="h-7 gap-1.5 text-[11px]"
            onClick={() => { setPicking(true); refetchCandidates(); }}
            disabled={candidatesLoading}
          >
            {candidatesLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            I made the test call
          </Button>
        </div>

        {picking && (
          <div className="space-y-1.5 pt-1">
            {candidatesLoading && <p className="text-[10px] text-muted-foreground">Looking for recent calls…</p>}
            {!candidatesLoading && (candidates ?? []).length === 0 && (
              <p className="text-[10px] text-amber-300">
                No recent calls found for this agent (last 48h). The call may still be processing — wait a moment and retry.
              </p>
            )}
            {(candidates ?? []).map((c: any) => (
              <button
                key={c.id}
                onClick={() => setSelectedCall(c.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left",
                  selectedCall === c.id ? "border-sky-500/40 bg-sky-500/[0.08]" : "border-white/[0.05] bg-white/[0.02] hover:bg-white/[0.04]",
                )}
              >
                <PhoneCall className="h-3 w-3 shrink-0 text-muted-foreground" />
                <span className="text-[10px]">{fmt(c.started_at ?? c.created_at)}</span>
                <span className="text-[10px] text-muted-foreground">{c.duration_seconds ?? 0}s · {c.call_status}{c.sentiment ? ` · ${c.sentiment}` : ""}</span>
                {!c.has_transcript && <Badge variant="outline" className="ml-auto text-[9px] border-amber-500/40 text-amber-300">no transcript yet</Badge>}
              </button>
            ))}
            {(candidates ?? []).length > 0 && (
              <Button
                size="sm" className="h-7 gap-1.5 text-[11px]"
                disabled={!selectedCall || analyze.isPending}
                onClick={() => selectedCall && analyze.mutate(selectedCall)}
              >
                {analyze.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldCheck className="h-3 w-3" />}
                {analyze.isPending ? "SystemMind is analyzing…" : "Analyze this call"}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Latest result */}
      {latestFull && !latestFull.is_manual_override && (
        <div className="space-y-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
          <div className="flex items-center gap-2">
            <p className="text-[11px] font-semibold">Latest test result</p>
            <Badge variant="outline" className={cn("text-[9px]",
              latestFull.passed ? "border-emerald-500/40 text-emerald-300" : "border-red-500/40 text-red-300")}>
              {latestFull.passed ? "PASSED" : "FAILED"}
            </Badge>
            <span className="ml-auto text-[10px] text-muted-foreground">{fmt(latestFull.created_at)}</span>
          </div>
          <div className="space-y-1.5">
            {((latestFull.checks ?? []) as any[]).map((c, i) => <CheckRow key={`${c.key}-${i}`} c={c} />)}
          </div>
          {latestFull.diagnosis && (
            <div className="rounded-md border border-amber-500/20 bg-amber-500/[0.04] px-2.5 py-2">
              <p className="text-[10px] font-medium text-amber-300">Diagnosis</p>
              <p className="text-[10px] text-muted-foreground">{latestFull.diagnosis}</p>
            </div>
          )}
          {!latestFull.passed && latestFull.suggested_fix && (
            <Button
              size="sm" variant="outline" className="h-7 gap-1.5 text-[11px]"
              disabled={fixPending}
              onClick={() => onAskFix(
                `Fix the issues found in the last test call. Diagnosis: ${latestFull.diagnosis ?? "see failed checks"}. Suggested fix: ${latestFull.suggested_fix}`,
              )}
            >
              {fixPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wrench className="h-3 w-3" />}
              Ask SystemMind to fix this
            </Button>
          )}
        </div>
      )}

      {/* History */}
      {(state.history ?? []).length > 0 && (
        <div className="space-y-1.5">
          <button className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground" onClick={() => setShowHistory((v) => !v)}>
            <History className="h-3 w-3" />
            Test history ({state.history.length}) {showHistory ? "▾" : "▸"}
          </button>
          {showHistory && (state.history as any[]).map((h) => (
            <div key={h.id} className="flex items-center gap-2 rounded-md border border-white/[0.04] bg-white/[0.01] px-2.5 py-1.5">
              {h.passed ? <CheckCircle2 className="h-3 w-3 text-emerald-400" /> : <XCircle className="h-3 w-3 text-red-400" />}
              <span className="text-[10px]">{h.test_scenario}{h.is_manual_override ? " (override)" : ""}</span>
              {(h.failed_checks ?? []).length > 0 && (
                <span className="text-[10px] text-muted-foreground">failed: {(h.failed_checks as string[]).join(", ")}</span>
              )}
              <span className="ml-auto text-[10px] text-muted-foreground">{fmt(h.created_at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
