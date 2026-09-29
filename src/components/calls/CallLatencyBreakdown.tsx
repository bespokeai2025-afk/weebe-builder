/**
 * "End to End Latency: XXXms" with a hover breakdown — the same shape Retell's own
 * call-detail view uses: End to end / Transcription / LLM / TTS, each as P90 / Median / Min.
 *
 * Only meaningful for calls with `call_turns` rows (the native engine instruments every turn);
 * a call placed on real Retell infrastructure has no per-turn data here, so the badge is
 * omitted entirely rather than showing a misleading "0ms".
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Info, Loader2 } from "lucide-react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { getCallLatencyDetail } from "@/lib/voice/call-latency.functions";
import type { LatencyCategoryStat } from "@/lib/voice/call-latency-stats.shared";

function ms(v: number | null | undefined): string {
  return typeof v === "number" ? `${v} ms` : "—";
}

function CategoryBlock({ cat, isLast }: { cat: LatencyCategoryStat; isLast: boolean }) {
  return (
    <div className={isLast ? "" : "border-b border-white/10 pb-2 mb-2"}>
      <p className="text-[11px] font-semibold text-foreground">{cat.label}</p>
      {cat.stats ? (
        <dl className="mt-1 space-y-0.5 text-[10.5px]">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">- P90</dt>
            <dd className="font-mono tabular-nums">{ms(cat.stats.p90)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">- Median</dt>
            <dd className="font-mono tabular-nums">{ms(cat.stats.p50)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">- Min</dt>
            <dd className="font-mono tabular-nums">{ms(cat.stats.min)}</dd>
          </div>
        </dl>
      ) : (
        <p className="mt-1 text-[10.5px] text-muted-foreground">Not enough turns to measure.</p>
      )}
    </div>
  );
}

export function CallLatencyBreakdown({ retellCallId }: { retellCallId: string }) {
  const [open, setOpen] = useState(false);
  const detailFn = useServerFn(getCallLatencyDetail);

  const { data, isLoading } = useQuery({
    queryKey: ["call-latency-detail", retellCallId],
    queryFn: () => detailFn({ data: { callId: retellCallId } } as never),
    enabled: open,
    staleTime: 60_000,
    throwOnError: false,
  });

  const endToEnd = data?.categories?.find((c) => c.category === "endToEnd")?.stats ?? null;

  return (
    <HoverCard open={open} onOpenChange={setOpen} openDelay={100} closeDelay={100}>
      <HoverCardTrigger asChild>
        <span className="inline-flex cursor-default items-center gap-1 font-medium">
          {endToEnd ? `${endToEnd.p50} ms` : isLoading ? "…" : "—"}
          <Info className="h-3 w-3 text-muted-foreground" />
        </span>
      </HoverCardTrigger>
      <HoverCardContent className="w-72" side="bottom" align="start">
        {isLoading ? (
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading…
          </div>
        ) : data?.turns.length ? (
          data.categories.map((cat, i) => (
            <CategoryBlock key={cat.category} cat={cat} isLast={i === data.categories.length - 1} />
          ))
        ) : (
          <p className="text-[11px] text-muted-foreground">
            No per-turn latency recorded for this call.
          </p>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}
