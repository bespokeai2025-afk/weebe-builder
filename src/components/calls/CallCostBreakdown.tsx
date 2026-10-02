/**
 * "Total Cost: $X.XXXX" with a hover breakdown — same shape as CallLatencyBreakdown,
 * reusing the admin-only cost data the Builder's Cost tab already computes
 * (see TestCallCostPanel.tsx / call-cost.functions.ts). `getTestCallCost` isn't
 * actually test-call-specific despite its name — it only needs a `retell_call_id`
 * — so this works for any call in the main Calls panel, not just Builder test calls.
 *
 * Real COGS/margin data, so the row this renders inside must only mount for a
 * platform admin — gating lives in the caller (CallDetailSheet), mirroring how
 * the Builder's own Cost tab is hidden entirely for a workspace user.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Info, Loader2 } from "lucide-react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
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

export function CallCostBreakdown({ retellCallId }: { retellCallId: string }) {
  const [open, setOpen] = useState(false);
  const costFn = useServerFn(getTestCallCost);

  const { data, isLoading } = useQuery({
    queryKey: ["call-cost-detail", retellCallId],
    queryFn: () => costFn({ data: { callId: retellCallId } } as never),
    enabled: open,
    staleTime: 60_000,
    throwOnError: false,
  });

  return (
    <HoverCard open={open} onOpenChange={setOpen} openDelay={100} closeDelay={100}>
      <HoverCardTrigger asChild>
        <span className="inline-flex cursor-default items-center gap-1 font-medium">
          {data ? cents(data.costCents) : isLoading ? "…" : "—"}
          <Info className="h-3 w-3 text-muted-foreground" />
        </span>
      </HoverCardTrigger>
      <HoverCardContent className="w-72" side="bottom" align="start">
        {isLoading ? (
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading…
          </div>
        ) : data?.breakdown ? (
          <div className="space-y-1">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Native engine breakdown
            </p>
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-muted-foreground">
                STT
                {data.breakdown.sttProvider && (
                  <span className="ml-1 text-[9px] text-muted-foreground/70">
                    ({data.breakdown.sttProvider})
                  </span>
                )}
              </span>
              <span className="font-mono tabular-nums text-foreground">
                {cents(data.breakdown.sttCents)}
              </span>
            </div>
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-muted-foreground">
                TTS
                {data.breakdown.ttsProvider && (
                  <span className="ml-1 text-[9px] text-muted-foreground/70">
                    ({data.breakdown.ttsProvider})
                  </span>
                )}
              </span>
              <span className="font-mono tabular-nums text-foreground">
                {cents(data.breakdown.ttsCents)}
              </span>
            </div>
            {BREAKDOWN_ROWS.map((row) => (
              <div key={row.key} className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">{row.label}</span>
                <span className="font-mono tabular-nums text-foreground">
                  {cents(data.breakdown![row.key])}
                </span>
              </div>
            ))}
            <div className="flex items-center justify-between border-t border-white/10 pt-1 text-[11px] font-semibold">
              <span>Total</span>
              <span className="font-mono tabular-nums">{cents(data.breakdown.totalCents)}</span>
            </div>
            {data.breakdown.telephonyIncludedInTotal && (
              <div className="flex items-center justify-between text-[10.5px] text-muted-foreground">
                <span>+ Telephony (estimated)</span>
                <span className="font-mono tabular-nums">{cents(data.breakdown.telephonyCents)}</span>
              </div>
            )}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            No cost breakdown available for this call.
          </p>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}
