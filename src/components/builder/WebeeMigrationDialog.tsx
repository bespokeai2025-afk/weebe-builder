/**
 * Migration console for one agent: shadow tests, then the cutover switch.
 *
 * Two things happen here, in the order the plan requires them. Replaying real
 * calls through the native conversation graph produces evidence that the graph VM
 * behaves like Retell did; the checklist turns that evidence — plus the provider
 * keys and flow the engine needs — into a go/no-go. Only then does the engine
 * switch, and only for this agent.
 *
 * Rollback is always available and never gated: the Retell agent is untouched by
 * a cutover, so switching back takes effect on the next call.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeftRight,
  Check,
  CircleDashed,
  Loader2,
  Play,
  Radio,
  Waves,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getCutoverReadiness,
  listShadowRuns,
  runShadowComparison,
  setAgentEngine,
  type CutoverCheck,
} from "@/lib/voice/shadow/shadow.functions";
import { cn } from "@/lib/utils";

interface Props {
  agentId: string;
  agentName: string;
  /** Mode resolved from builder state, so the dialog reflects unsaved switches. */
  currentMode: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful cutover so the builder can reload the agent. */
  onModeChanged: (mode: "WEBEE_NATIVE" | "RETELL") => void;
}

const VERDICT_STYLES: Record<string, string> = {
  aligned: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  partial: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  divergent: "border-destructive/40 bg-destructive/10 text-destructive",
};

function CheckRow({ check }: { check: CutoverCheck }) {
  const Icon = check.status === "pass" ? Check : check.status === "warn" ? AlertTriangle : X;
  const tone =
    check.status === "pass"
      ? "text-emerald-400"
      : check.status === "warn"
        ? "text-amber-400"
        : "text-destructive";
  return (
    <div className="flex items-start gap-2 py-1.5">
      <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", tone)} />
      <div className="min-w-0">
        <p className="text-xs font-medium text-foreground">{check.label}</p>
        <p className="text-[11px] leading-snug text-muted-foreground">{check.detail}</p>
      </div>
    </div>
  );
}

export function WebeeMigrationDialog({
  agentId,
  agentName,
  currentMode,
  open,
  onOpenChange,
  onModeChanged,
}: Props) {
  const qc = useQueryClient();
  const [replaying, setReplaying] = useState(false);
  const [switching, setSwitching] = useState(false);

  const readinessQ = useQuery({
    queryKey: ["webee-cutover-readiness", agentId],
    queryFn: () => getCutoverReadiness({ data: { agentId } }),
    enabled: open,
    refetchOnWindowFocus: false,
    throwOnError: false,
  });

  const runsQ = useQuery({
    queryKey: ["webee-shadow-runs", agentId],
    queryFn: () => listShadowRuns({ data: { agentId, limit: 10 } }),
    enabled: open,
    refetchOnWindowFocus: false,
    throwOnError: false,
  });

  const readiness = readinessQ.data ?? null;
  const runs = runsQ.data ?? [];
  const isNative = currentMode === "WEBEE_NATIVE";
  const blockers = readiness?.checks.filter((c) => c.status === "fail") ?? [];

  async function handleReplay() {
    setReplaying(true);
    try {
      const result = await runShadowComparison({ data: { agentId, limit: 3 } });
      if (result.runs.length === 0) {
        toast.warning("Nothing to compare", { description: result.message });
      } else {
        const aligned = result.runs.filter((r) => r.verdict === "aligned").length;
        toast.success(result.message, {
          description: `${aligned}/${result.runs.length} aligned with the reference transcript${
            result.skipped ? ` · ${result.skipped} call(s) too short to judge` : ""
          }`,
        });
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["webee-shadow-runs", agentId] }),
        qc.invalidateQueries({ queryKey: ["webee-cutover-readiness", agentId] }),
      ]);
    } catch (e) {
      toast.error("Shadow run failed", { description: (e as Error).message });
    } finally {
      setReplaying(false);
    }
  }

  async function handleSwitch(mode: "WEBEE_NATIVE" | "RETELL", force = false) {
    setSwitching(true);
    try {
      await setAgentEngine({ data: { agentId, mode, force } });
      onModeChanged(mode);
      toast.success(
        mode === "WEBEE_NATIVE" ? "Switched to WEBEE Native" : "Rolled back to OmniVoice",
        {
          description:
            mode === "WEBEE_NATIVE"
              ? "New calls run on the in-house engine. The Retell agent is left in place for rollback."
              : "New calls route through Retell again.",
        },
      );
      await qc.invalidateQueries({ queryKey: ["webee-cutover-readiness", agentId] });
      qc.invalidateQueries({ queryKey: ["my-agents"] });
    } catch (e) {
      toast.error("Engine switch failed", { description: (e as Error).message });
    } finally {
      setSwitching(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-full max-w-2xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-sm">
            <ArrowLeftRight className="h-4 w-4" />
            Voice engine migration
            <Badge
              variant="outline"
              className={cn(
                "ml-1 gap-1 px-1.5 py-0.5 text-[10px]",
                isNative
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-white/[0.12] text-muted-foreground",
              )}
            >
              {isNative ? <Waves className="h-2.5 w-2.5" /> : <Radio className="h-2.5 w-2.5" />}
              {isNative ? "WEBEE Native" : "OmniVoice"}
            </Badge>
          </DialogTitle>
          <DialogDescription className="text-[11px]">
            Replay {agentName}&apos;s real calls through the in-house engine, then switch this agent
            over. Every other agent keeps running on its current engine.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {/* ── Readiness checklist ── */}
          <section className="space-y-1">
            <div className="flex items-center justify-between">
              <h3 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Cutover checklist
              </h3>
              {readinessQ.isFetching && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
            </div>
            {readinessQ.error ? (
              <p className="rounded border border-destructive/20 bg-destructive/5 px-2 py-1.5 text-[11px] text-destructive/80">
                {(readinessQ.error as Error).message}
              </p>
            ) : readiness ? (
              <div className="divide-y divide-white/[0.04] rounded-lg border border-white/[0.06] bg-white/[0.01] px-3">
                {readiness.checks.map((c) => (
                  <CheckRow key={c.id} check={c} />
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-2 py-4 text-[11px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Checking providers, flow and shadow history…
              </div>
            )}
          </section>

          {/* ── Shadow runs ── */}
          <section className="space-y-1.5">
            <div className="flex items-center justify-between">
              <h3 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Shadow replays
              </h3>
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 text-[11px]"
                disabled={replaying}
                onClick={handleReplay}
              >
                {replaying ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Play className="h-3 w-3" />
                )}
                Replay 3 recent calls
              </Button>
            </div>
            <p className="text-[10px] leading-snug text-muted-foreground/70">
              Each replay drives the graph VM with the caller turns from a real call and scores the
              agent&apos;s replies against what the old engine said. Replays cost one LLM generation
              per turn, so they are run on demand rather than continuously.
            </p>
            {runs.length === 0 ? (
              <p className="flex items-center gap-1.5 py-2 text-[11px] text-muted-foreground">
                <CircleDashed className="h-3 w-3" />
                No replays yet.
              </p>
            ) : (
              <div className="overflow-hidden rounded-lg border border-white/[0.06]">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="border-b border-white/[0.06] text-left text-[9px] uppercase tracking-wider text-muted-foreground">
                      <th className="px-2.5 py-1.5">Verdict</th>
                      <th className="px-2.5 py-1.5">Similarity</th>
                      <th className="px-2.5 py-1.5">Turns</th>
                      <th className="px-2.5 py-1.5">Diverged</th>
                      <th className="px-2.5 py-1.5">Reference call</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((r) => (
                      <tr key={String(r.id)} className="border-b border-white/[0.03] last:border-0">
                        <td className="px-2.5 py-1.5">
                          <span
                            className={cn(
                              "rounded-full border px-1.5 py-0.5 text-[9px] capitalize",
                              VERDICT_STYLES[String(r.verdict)] ?? "border-white/[0.12]",
                            )}
                          >
                            {String(r.verdict)}
                          </span>
                        </td>
                        <td className="px-2.5 py-1.5 tabular-nums text-muted-foreground">
                          {Math.round(Number(r.average_similarity ?? 0) * 100)}%
                        </td>
                        <td className="px-2.5 py-1.5 tabular-nums text-muted-foreground">
                          {String(r.candidate_agent_turns ?? 0)}/{String(r.reference_agent_turns ?? 0)}
                        </td>
                        <td className="px-2.5 py-1.5 tabular-nums text-muted-foreground">
                          {r.diverged_at_turn === null || r.diverged_at_turn === undefined
                            ? "—"
                            : `turn ${String(r.diverged_at_turn)}`}
                        </td>
                        <td className="max-w-[160px] truncate px-2.5 py-1.5 font-mono text-[10px] text-muted-foreground/70">
                          {String(r.reference_call_id ?? "—")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        {/* ── Switch ── */}
        <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
          <p className="text-[10px] leading-snug text-muted-foreground/70">
            {isNative
              ? "Rolling back is instant and keeps the flow as it is."
              : blockers.length > 0
                ? `${blockers.length} blocking issue(s) — fix them or override.`
                : "Switching affects new calls only; calls in progress finish on the current engine."}
          </p>
          <div className="flex items-center gap-2">
            {isNative ? (
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 text-xs"
                disabled={switching}
                onClick={() => handleSwitch("RETELL")}
              >
                {switching ? <Loader2 className="h-3 w-3 animate-spin" /> : <Radio className="h-3 w-3" />}
                Roll back to OmniVoice
              </Button>
            ) : (
              <>
                {blockers.length > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 text-xs text-muted-foreground"
                    disabled={switching}
                    onClick={() => handleSwitch("WEBEE_NATIVE", true)}
                  >
                    Override
                  </Button>
                )}
                <Button
                  size="sm"
                  className="h-8 gap-1.5 text-xs"
                  disabled={switching || blockers.length > 0 || !readiness}
                  onClick={() => handleSwitch("WEBEE_NATIVE")}
                >
                  {switching ? <Loader2 className="h-3 w-3 animate-spin" /> : <Waves className="h-3 w-3" />}
                  Cut over to WEBEE Native
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
