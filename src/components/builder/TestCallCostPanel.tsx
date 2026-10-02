/**
 * Test-call cost register — admin only.
 *
 * Same call list as the Latency tab (they're the same test calls), but reads
 * `calls.cost_cents` and, for a native-engine call, breaks it down by the
 * component rates set in the admin cost-engine dashboard. Real COGS/margin
 * data, so this tab is hidden entirely for anyone who isn't a platform admin
 * — see `checkCanSeeCallCost`.
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { listLatencyCalls } from "@/lib/voice/call-latency.functions";
import { getTestCallCost } from "@/lib/voice/call-cost.functions";

function cents(v: number | null | undefined): string {
  if (typeof v !== "number") return "—";
  return `$${(v / 100).toFixed(4)}`;
}

const BREAKDOWN_ROWS: Array<{ key: "llmCents" | "routerCents" | "analysisCents" | "concurrencyCents"; label: string }> = [
  { key: "llmCents", label: "LLM" },
  { key: "routerCents", label: "Router" },
  { key: "analysisCents", label: "Analysis" },
  { key: "concurrencyCents", label: "Concurrency" },
];

const TELEPHONY_BASIS_LABEL: Record<string, string> = {
  twilio_outbound_us: "Twilio, outbound US",
  twilio_inbound_us: "Twilio, inbound US",
  web_estimate: "estimated — browser test call",
};

function providerLabel(provider: string | null, rateMissing: boolean): string | null {
  if (!provider) return null;
  return rateMissing ? `${provider} — no rate, using blended avg` : provider;
}

export function TestCallCostPanel() {
  const listFn = useServerFn(listLatencyCalls);
  const costFn = useServerFn(getTestCallCost);
  const [callId, setCallId] = useState<string | null>(null);

  const { data: list, isFetching, refetch } = useQuery({
    queryKey: ["test-call-latency-list"], // same data the Latency tab uses — one cache entry, not two
    queryFn: () => listFn({ data: { testOnly: true, limit: 15 } } as never),
    refetchInterval: 15_000,
    throwOnError: false,
  });

  const calls = list?.calls ?? [];

  useEffect(() => {
    if (!callId && calls.length) setCallId(calls[0]!.callId);
  }, [callId, calls]);

  const { data: cost, isLoading: costLoading } = useQuery({
    queryKey: ["test-call-cost", callId],
    queryFn: () => costFn({ data: { callId: callId! } } as never),
    enabled: !!callId,
    throwOnError: false,
  });

  if (!isFetching && calls.length === 0) {
    return (
      <div className="px-3 py-6 text-center text-[11px] text-muted-foreground">
        No test calls recorded yet. Place one and its cost appears here.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      {/* Call list — identical to the Latency tab's, so the two stay in lockstep */}
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
            <span className="block truncate font-mono text-[10px] text-muted-foreground">
              {c.callId.slice(-10)}
            </span>
            <span className="text-[9px] text-muted-foreground">
              {c.turns} turn{c.turns === 1 ? "" : "s"}
            </span>
          </button>
        ))}
      </div>

      {/* Detail */}
      <div className="min-w-0 flex-1 overflow-auto p-3">
        {costLoading || !cost ? (
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading cost…
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-baseline gap-3">
              <span className="text-2xl font-semibold tabular-nums text-foreground">
                {cents(cost.costCents)}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {cost.durationSeconds != null ? `${cost.durationSeconds}s` : "duration unknown"}
              </span>
            </div>
            {cost.costCents == null && (
              <p className="text-[10px] text-muted-foreground">
                Not available yet — cost is written once the call ends and Retell (or the native
                engine) reports the final analysis. Refresh in a moment if this call just finished.
              </p>
            )}

            {cost.breakdown && (
              <div className="space-y-1 border-t border-white/[0.06] pt-2">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Native engine breakdown
                </p>
                {/* STT/TTS are provider-specific — each call is costed against whichever engine
                    it actually used, not one blended average. */}
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground">
                    STT
                    {providerLabel(cost.breakdown.sttProvider, cost.breakdown.sttRateMissing) && (
                      <span className="ml-1 text-[9px] text-muted-foreground/70">
                        ({providerLabel(cost.breakdown.sttProvider, cost.breakdown.sttRateMissing)})
                      </span>
                    )}
                  </span>
                  <span className="tabular-nums text-foreground">{cents(cost.breakdown.sttCents)}</span>
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground">
                    TTS
                    {providerLabel(cost.breakdown.ttsProvider, cost.breakdown.ttsRateMissing) && (
                      <span className="ml-1 text-[9px] text-muted-foreground/70">
                        ({providerLabel(cost.breakdown.ttsProvider, cost.breakdown.ttsRateMissing)})
                      </span>
                    )}
                  </span>
                  <span className="tabular-nums text-foreground">{cents(cost.breakdown.ttsCents)}</span>
                </div>
                {BREAKDOWN_ROWS.map((row) => (
                  <div key={row.key} className="flex items-center justify-between text-[11px]">
                    <span className="text-muted-foreground">{row.label}</span>
                    <span className="tabular-nums text-foreground">{cents(cost.breakdown![row.key])}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between border-t border-white/[0.06] pt-1 text-[11px] font-medium">
                  <span>Total</span>
                  <span className="tabular-nums">{cents(cost.breakdown.totalCents)}</span>
                </div>

                {/* Telephony is shown separately from the total above: a real phone call's
                    carrier minutes are reconciled from Twilio's own invoice (adding them here
                    would double-count), while a web test call has no carrier at all, so its
                    estimate is folded into its own "estimated total" instead. */}
                <div className="flex items-center justify-between pt-1 text-[11px]">
                  <span className="text-muted-foreground">
                    Telephony
                    <span className="ml-1 text-[9px] text-muted-foreground/70">
                      ({TELEPHONY_BASIS_LABEL[cost.breakdown.telephonyBasis] ?? cost.breakdown.telephonyBasis})
                    </span>
                  </span>
                  <span className="tabular-nums text-foreground">{cents(cost.breakdown.telephonyCents)}</span>
                </div>
                {cost.breakdown.telephonyIncludedInTotal ? (
                  <div className="flex items-center justify-between text-[11px] font-medium">
                    <span>Estimated total (incl. telephony)</span>
                    <span className="tabular-nums">{cents(cost.breakdown.estimatedTotalCents)}</span>
                  </div>
                ) : (
                  <p className="text-[9px] text-muted-foreground">
                    Telephony is reconciled from the carrier's own invoice — shown for reference,
                    not included in the total above.
                  </p>
                )}

                <p className="pt-1 text-[9px] text-muted-foreground">
                  Rates as of {new Date(cost.breakdown.ratesAsOf).toLocaleDateString()} — edit in
                  the admin cost-engine dashboard.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
