/**
 * Builder — how fast each WEBEE Native model and voice has actually been on this workspace's calls.
 *
 * The model menu used to describe models with fixed claims ("Fast — best for live voice"). These
 * read the measured medians from `call_turns` instead (getEngineSpeed), so the menu shows what a
 * caller would wait and warns when the chosen model or voice cannot reach a 1–1.4 s reply.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle } from "lucide-react";
import { getEngineSpeed } from "@/lib/voice/call-latency.functions";
import {
  fmtSpeedSeconds,
  isSpeedStatReliable,
  SLOW_FIRST_WORD_MS,
  SLOW_VOICE_MS,
  speedStatLabel,
  type EngineSpeed,
} from "@/lib/voice/call-latency-stats.shared";

export function useEngineSpeed(enabled = true): EngineSpeed | null {
  const fetchFn = useServerFn(getEngineSpeed);
  const q = useQuery({
    queryKey: ["engine-speed"],
    queryFn: () => fetchFn({ data: {} }),
    enabled,
    staleTime: 5 * 60_000,
    throwOnError: false,
  });
  return q.data ?? null;
}

/** One line under a model in the menu: its measured time to the first word. */
export function ModelSpeedLine({ speed, modelId }: { speed: EngineSpeed | null; modelId: string }) {
  if (!speed) return null;
  return (
    <span className="text-[10px] leading-snug text-muted-foreground/80">
      First word: {speedStatLabel(speed.models[modelId])}
    </span>
  );
}

function SlowNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex gap-1 text-[10px] leading-snug text-amber-600 dark:text-amber-400">
      <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/** Shown under the model menu when the chosen model has measured slow, with the fastest measured alternative. */
export function ModelSpeedWarning({
  speed,
  modelId,
  choices,
}: {
  speed: EngineSpeed | null;
  modelId: string;
  choices: { id: string; label: string }[];
}) {
  const stat = speed?.models[modelId];
  if (!speed || !isSpeedStatReliable(stat) || stat.medianMs <= SLOW_FIRST_WORD_MS) return null;
  const faster = choices
    .filter((c) => c.id !== modelId)
    .map((c) => ({ ...c, stat: speed.models[c.id] }))
    .filter((c) => isSpeedStatReliable(c.stat) && c.stat.medianMs < stat.medianMs)
    .sort((a, b) => a.stat!.medianMs - b.stat!.medianMs)[0];
  return (
    <SlowNote>
      Callers waited {fmtSpeedSeconds(stat.medianMs)} for this model&apos;s first word, so replies land well past
      1–1.4 s.
      {faster ? ` ${faster.label} measured ${fmtSpeedSeconds(faster.stat!.medianMs)}.` : ""}
    </SlowNote>
  );
}

/** Under the voice menu: how long the chosen voice adds between the first word and the first audio. */
export function VoiceSpeedHint({ speed, provider }: { speed: EngineSpeed | null; provider: string }) {
  if (!speed) return null;
  const stat = speed.voices[provider];
  if (isSpeedStatReliable(stat) && stat.medianMs > SLOW_VOICE_MS) {
    return (
      <SlowNote>
        This voice adds {fmtSpeedSeconds(stat.medianMs)} before callers hear the reply ({stat.turns} turns). A
        1–1.4 s reply needs it under {fmtSpeedSeconds(SLOW_VOICE_MS)}.
      </SlowNote>
    );
  }
  return (
    <p className="text-[10px] leading-snug text-muted-foreground">
      Time added before the reply is heard: {speedStatLabel(stat)}
    </p>
  );
}
