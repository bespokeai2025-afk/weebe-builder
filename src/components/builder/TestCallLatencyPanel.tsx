/**
 * Test-call latency register.
 *
 * After placing a test call this is where its turns show up: one row per turn
 * with the stage breakdown, which routing path the turn took, and whether
 * speculative speech hit. Previously all of this existed only as a console.log
 * on the server, so there was no way to see what a test call actually did.
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getCallLatencyDetail,
  listLatencyCalls,
} from "@/lib/voice/call-latency.functions";
import { LATENCY_BUDGET_MS } from "@/lib/voice/call-latency-stats.shared";

function ms(v: number | null | undefined) {
  return typeof v === "number" ? `${v}ms` : "—";
}

/** Green inside budget, amber close, rose over. */
function budgetTone(v: number | null | undefined) {
  if (typeof v !== "number") return "text-muted-foreground";
  if (v <= LATENCY_BUDGET_MS) return "text-emerald-300";
  if (v <= LATENCY_BUDGET_MS * 1.5) return "text-amber-300";
  return "text-rose-300";
}

/** An LLM classify on the critical path is the expensive path — call it out. */
function methodTone(method: string | null) {
  if (method === "llm" || method === "global_llm") return "text-rose-300";
  if (method === "heuristic" || method === "global_heuristic") return "text-sky-300";
  return "text-muted-foreground";
}

export function TestCallLatencyPanel() {
  const listFn = useServerFn(listLatencyCalls);
  const detailFn = useServerFn(getCallLatencyDetail);
  const [callId, setCallId] = useState<string | null>(null);

  const { data: list, isFetching, refetch } = useQuery({
    queryKey: ["test-call-latency-list"],
    queryFn: () => listFn({ data: { testOnly: true, limit: 15 } } as never),
    refetchInterval: 15_000,
    throwOnError: false,
  });

  const calls = list?.calls ?? [];

  // Land on the newest call so the panel is useful the moment it opens.
  useEffect(() => {
    if (!callId && calls.length) setCallId(calls[0]!.callId);
  }, [callId, calls]);

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ["test-call-latency-detail", callId],
    queryFn: () => detailFn({ data: { callId: callId! } } as never),
    enabled: !!callId,
    throwOnError: false,
  });

  if (!isFetching && calls.length === 0) {
    return (
      <div className="px-3 py-6 text-center text-[11px] text-muted-foreground">
        No test-call latency recorded yet. Place a test call and its turns appear here.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      {/* Call list */}
      <div className="w-44 shrink-0 overflow-y-auto border-r border-white/[0.06]">
        <div className="flex items-center justify-between px-2 py-1">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Test calls</span>
          <button
            type="button"
            onClick={() => refetch()}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Refresh test calls"
          >
            <RefreshCw className={cn("h-3 w-3", isFetching && "animate-spin")} />
          </button>
        </div>
        {calls.map((c) => (
          <button
            key={c.callId}
            type="button"
            onClick={() => setCallId(c.callId)}
            className={cn(
              "block w-full px-2 py-1.5 text-left hover:bg-white/[0.04]",
              callId === c.callId && "bg-white/[0.06]",
            )}
          >
            <div className="flex items-baseline justify-between gap-1">
              <span className="truncate font-mono text-[10px] text-muted-foreground">
                {c.callId.slice(-10)}
              </span>
              <span className={cn("shrink-0 text-[10px]", budgetTone(c.medianMs))}>
                {ms(c.medianMs)}
              </span>
            </div>
            <div className="text-[9px] text-muted-foreground">
              {c.turns} turn{c.turns === 1 ? "" : "s"} · worst {ms(c.worstMs)}
            </div>
          </button>
        ))}
      </div>

      {/* Detail */}
      <div className="min-w-0 flex-1 overflow-auto">
        {detailLoading || !detail ? (
          <div className="flex items-center gap-2 px-3 py-6 text-[11px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading turns…
          </div>
        ) : (
          <div className="space-y-3 p-2">
            {/* Headline */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px]">
              <span className="text-muted-foreground">
                Within {detail.budget.budgetMs}ms:{" "}
                <span
                  className={cn(
                    detail.budget.measured && detail.budget.share >= 0.9
                      ? "text-emerald-300"
                      : "text-amber-300",
                  )}
                >
                  {detail.budget.measured
                    ? `${detail.budget.within}/${detail.budget.measured}`
                    : "not measured"}
                </span>
              </span>
              <span className="text-muted-foreground">
                Speculative hits:{" "}
                <span className="text-foreground">
                  {detail.speculation.hits}/{detail.speculation.turns}
                </span>
                {detail.speculation.savedMs !== null && (
                  <span
                    className={cn(
                      "ml-1",
                      detail.speculation.savedMs > 0 ? "text-emerald-300" : "text-rose-300",
                    )}
                  >
                    ({detail.speculation.savedMs > 0 ? "−" : "+"}
                    {Math.abs(detail.speculation.savedMs)}ms)
                  </span>
                )}
              </span>
            </div>

            {/* Stage medians */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 sm:grid-cols-3">
              {detail.stages.map((s) => (
                <div key={s.key} className="flex items-baseline justify-between gap-2 text-[10px]">
                  <span className="truncate text-muted-foreground">{s.label}</span>
                  <span className="shrink-0 font-mono text-foreground">
                    {s.stats ? `${s.stats.p50}ms` : "—"}
                  </span>
                </div>
              ))}
            </div>

            {/* Per-turn table */}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-[10px]">
                <thead>
                  <tr className="text-muted-foreground">
                    <th className="py-1 pr-2 text-left font-normal">#</th>
                    <th className="py-1 pr-2 text-right font-normal">STT</th>
                    <th className="py-1 pr-2 text-right font-normal">Route</th>
                    <th className="py-1 pr-2 text-right font-normal">1st token</th>
                    <th className="py-1 pr-2 text-right font-normal">1st audio</th>
                    <th className="py-1 pr-2 text-right font-normal">Speech→audio</th>
                    <th className="py-1 pr-2 text-left font-normal">Path</th>
                    <th className="py-1 text-left font-normal">Node</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {detail.turns.map((t) => (
                    <tr key={t.turn_index} className="border-t border-white/[0.04]">
                      <td className="py-1 pr-2 text-muted-foreground">{t.turn_index}</td>
                      <td className="py-1 pr-2 text-right">{ms(t.endpoint_to_stt_final_ms)}</td>
                      <td className="py-1 pr-2 text-right">{ms(t.stt_to_route_ms)}</td>
                      <td className="py-1 pr-2 text-right">{ms(t.stt_to_first_token_ms)}</td>
                      <td className="py-1 pr-2 text-right">{ms(t.stt_to_first_audio_ms)}</td>
                      <td
                        className={cn(
                          "py-1 pr-2 text-right font-medium",
                          budgetTone(t.speech_to_first_audio_ms),
                        )}
                      >
                        {ms(t.speech_to_first_audio_ms)}
                      </td>
                      <td className={cn("py-1 pr-2 font-sans", methodTone(t.edge_route_method))}>
                        {t.edge_route_method ?? "—"}
                        {t.speculative_hit && <span className="ml-1 text-emerald-300">spec</span>}
                        {t.interrupted && <span className="ml-1 text-amber-300">int</span>}
                      </td>
                      <td className="py-1 truncate text-muted-foreground">{t.node_id ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
