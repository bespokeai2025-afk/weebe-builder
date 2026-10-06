/**
 * Per-call cost shown straight after a test call ends: the overall figure plus each stage,
 * labelled with the provider that actually served it.
 *
 * The cost is written by the webhook a moment after hangup, so this polls briefly until the
 * breakdown exists rather than showing a blank. Platform-admin only, the same gate as every
 * other cost surface.
 */
import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { checkCanSeeCallCost, getTestCallCost } from "@/lib/voice/call-cost.functions";

/** How often to re-check while the webhook is still writing the cost. */
const POLL_MS = 3_000;
/** Stop polling after this many checks (~1 minute); the calls page has the full record. */
const MAX_POLLS = 20;

function usd(cents: number | null | undefined, dp = 4) {
  if (cents == null) return "—";
  return `$${(cents / 100).toFixed(dp)}`;
}

function StageRow({
  label,
  provider,
  cents,
  estimated,
}: {
  label: string;
  provider: string | null;
  cents: number;
  estimated: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-[11px]">
      <span className="text-muted-foreground w-20 shrink-0">{label}</span>
      <span className="font-mono text-foreground/80 flex-1 truncate">
        {provider ?? "not recorded"}
        {estimated && provider ? (
          <span className="ml-1 text-[10px] text-amber-600 dark:text-amber-400">(blended rate)</span>
        ) : null}
      </span>
      <span className="tabular-nums text-foreground/80">{usd(cents)}</span>
    </div>
  );
}

export function PostCallCostBreakdown({ callId }: { callId: string }) {
  const canSeeFn = useServerFn(checkCanSeeCallCost);
  const costFn = useServerFn(getTestCallCost);

  const { data: access } = useQuery({
    queryKey: ["can-see-call-cost"],
    queryFn: () => canSeeFn(),
    throwOnError: false,
  });

  const gaveUp = useRef(false);
  const { data, isError, error } = useQuery({
    queryKey: ["post-call-cost", callId],
    queryFn: () => costFn({ data: { callId } } as never),
    enabled: !!access?.canSee && !!callId,
    throwOnError: false,
    // Poll only until the webhook has written the breakdown, then stop.
    refetchInterval: (query) => {
      const d = query.state.data as { breakdown?: unknown } | undefined;
      if (d?.breakdown) return false;
      if (query.state.dataUpdateCount >= MAX_POLLS) {
        gaveUp.current = true;
        return false;
      }
      return POLL_MS;
    },
  });

  if (!access?.canSee) return null;

  if (isError) {
    return (
      <span className="text-[10px] text-destructive">
        Cost unavailable: {String((error as Error)?.message ?? error).slice(0, 80)}
      </span>
    );
  }

  const b = data?.breakdown;

  if (!b) {
    return (
      <div className="text-[11px] text-muted-foreground">
        {gaveUp.current ? "Cost not yet available — see the Calls page." : "Calculating cost…"}
      </div>
    );
  }

  return (
    <div className="space-y-1.5 rounded-md border border-border/60 bg-muted/30 p-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium">Call cost</span>
        <span className="text-[13px] font-semibold tabular-nums">
          {usd(b.estimatedTotalCents ?? b.totalCents)}
        </span>
      </div>

      <div className="space-y-1">
        <StageRow label="Speech-to-text" provider={b.sttProvider} cents={b.sttCents} estimated={b.sttRateMissing || !b.sttProvider} />
        <StageRow label="AI model" provider={b.llmProvider} cents={b.llmCents} estimated={b.llmRateMissing || !b.llmProvider} />
        <StageRow label="Text-to-speech" provider={b.ttsProvider} cents={b.ttsCents} estimated={b.ttsRateMissing || !b.ttsProvider} />
        <div className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
          <span className="w-20 shrink-0">Router, analysis</span>
          <span className="flex-1" />
          <span className="tabular-nums">{usd((b.routerCents ?? 0) + (b.analysisCents ?? 0) + (b.concurrencyCents ?? 0))}</span>
        </div>
        {b.telephonyCents != null && b.telephonyCents > 0 ? (
          <div className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
            <span className="w-20 shrink-0">Telephony</span>
            <span className="flex-1 truncate">
              {b.telephonyIncludedInTotal ? "web estimate, in total" : "carrier invoice, not in total"}
            </span>
            <span className="tabular-nums">{usd(b.telephonyCents)}</span>
          </div>
        ) : null}
      </div>

      <p className="text-[10px] text-muted-foreground">
        Engine cost of this call, priced against the providers it used.
      </p>
    </div>
  );
}
