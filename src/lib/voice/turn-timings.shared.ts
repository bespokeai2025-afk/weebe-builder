/**
 * Turn timings — how a turn's latency is counted, in one place.
 *
 * Governing rule: use actual timestamps; null means "not measured", never "fast", and nothing is
 * derived from audio or summed. Stages overlap (TTS starts while the model is still writing), so
 * adding asr + llm + tts would overstate latency; every figure below is the interval between two
 * real timestamps.
 *
 * Three reference timestamps, as recorded per turn in `call_turns`:
 *   speech end   — the caller's last word: estimated as the endpoint minus the trailing silence
 *                  that closed it (`speech_end_reference` says which boundary was actually used)
 *   committed    — the end-of-speech wait is over and the turn starts (VAD endpoint + coalescing)
 *   first audio  — the agent's first audio byte sent
 *
 * Headline numbers:
 *   perceived_ms   = committed   → first audio   ← the headline, Retell-comparable
 *   caller_wait_ms = speech end  → first audio   = perceived + endpointing (what the human waits)
 *   endpointing_ms = speech end  → committed     (the configured end-of-speech wait)
 *   full_turn_ms   = speech end  → turn complete (includes all the agent's speech)
 *
 * Stage numbers (all measured intervals):
 *   asr_ms                       committed → final transcript
 *   workflow_ms                  final transcript → route decided
 *   llm_request_start_offset_ms  committed → the reply's model request sent
 *   llm_ttft_ms                  model request → first token
 *   llm_first_speakable_ms       model request → first phrase handed to TTS. This is what gates
 *                                audio; its gap over llm_ttft_ms is pure phrase buffering.
 *   tts_first_audio_ms           first phrase handed to TTS → first audio
 *
 * `call_turns` stores marks relative to two anchors (committed, final transcript), so an interval
 * between two marks on the same anchor is an exact timestamp difference, not a sum of stages.
 *
 * Relative imports only — this module is reachable from vite.config.ts.
 */

export type SpeechEndReference = "caller_speech_frame" | "estimated_from_silence" | "endpoint";

/** The `call_turns` columns turn timings are computed from. */
export interface TurnTimingRow {
  voice_end_to_first_audio_ms?: number | null;
  end_of_speech_wait_ms?: number | null;
  speech_to_first_audio_ms?: number | null;
  endpoint_to_stt_final_ms?: number | null;
  stt_to_route_ms?: number | null;
  stt_to_llm_request_ms?: number | null;
  stt_to_first_token_ms?: number | null;
  stt_to_first_speakable_ms?: number | null;
  stt_to_first_audio_ms?: number | null;
  full_turn_ms?: number | null;
  speech_end_reference?: string | null;
}

export interface TurnTimings {
  perceivedMs: number | null;
  callerWaitMs: number | null;
  endpointingMs: number | null;
  fullTurnMs: number | null;
  asrMs: number | null;
  workflowMs: number | null;
  llmRequestStartOffsetMs: number | null;
  llmTtftMs: number | null;
  llmFirstSpeakableMs: number | null;
  ttsFirstAudioMs: number | null;
  speechEndReference: SpeechEndReference;
}

const num = (v: number | null | undefined): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** b − a for two marks on the same anchor, or null when either was not measured. */
function between(a: number | null | undefined, b: number | null | undefined): number | null {
  const x = num(a);
  const y = num(b);
  return x === null || y === null ? null : Math.round(y - x);
}

function referenceOf(row: TurnTimingRow): SpeechEndReference {
  const r = row.speech_end_reference;
  if (r === "caller_speech_frame" || r === "estimated_from_silence" || r === "endpoint") return r;
  // Rows from before the column: a recorded last-word time was always the silence estimate.
  return num(row.voice_end_to_first_audio_ms) !== null ? "estimated_from_silence" : "endpoint";
}

export function computeTurnTimings(row: TurnTimingRow): TurnTimings {
  const reference = referenceOf(row);
  const perceived = num(row.speech_to_first_audio_ms);
  const asr = num(row.endpoint_to_stt_final_ms);
  // Committed → model request: committed → transcript, then transcript → request, on one chain of
  // timestamps (the transcript mark is shared), so this is the exact interval, not two stages added.
  const sttToRequest = num(row.stt_to_llm_request_ms);
  return {
    perceivedMs: perceived,
    // Without a last-word time the boundary is the endpoint: caller wait is then the perceived
    // figure, and `speechEndReference` says so instead of claiming an acoustic measurement.
    callerWaitMs: reference === "endpoint" ? perceived : num(row.voice_end_to_first_audio_ms),
    endpointingMs: reference === "endpoint" ? null : num(row.end_of_speech_wait_ms),
    fullTurnMs: num(row.full_turn_ms),
    asrMs: asr,
    workflowMs: num(row.stt_to_route_ms),
    llmRequestStartOffsetMs: asr !== null && sttToRequest !== null ? Math.round(asr + sttToRequest) : null,
    llmTtftMs: between(row.stt_to_llm_request_ms, row.stt_to_first_token_ms),
    llmFirstSpeakableMs: between(row.stt_to_llm_request_ms, row.stt_to_first_speakable_ms),
    ttsFirstAudioMs: between(row.stt_to_first_speakable_ms, row.stt_to_first_audio_ms),
    speechEndReference: reference,
  };
}

/** Target for `perceived_ms` (committed → first audio). WEBEE_NATIVE_PERCEIVED_BUDGET_MS overrides. */
export const PERCEIVED_BUDGET_MS_DEFAULT = 850;

export function perceivedBudgetMs(): number {
  const raw = typeof process !== "undefined" ? process.env?.WEBEE_NATIVE_PERCEIVED_BUDGET_MS : undefined;
  const n = Number(String(raw ?? "").trim());
  return Number.isFinite(n) && n > 0 ? n : PERCEIVED_BUDGET_MS_DEFAULT;
}

export interface LatencySummary {
  count: number;
  median: number;
  p95: number;
}

/**
 * Median and p95 over the turns where the value was measured; null when none were.
 * Median as `statistics.median` (mean of the middle two for an even count); p95 nearest-rank at
 * idx = round(pct/100 × (n − 1)).
 */
export function summarizeLatency(values: Array<number | null | undefined>): LatencySummary | null {
  const xs = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  const median = xs.length % 2 ? xs[mid]! : Math.round((xs[mid - 1]! + xs[mid]!) / 2);
  const p95 = xs[Math.round(0.95 * (xs.length - 1))]!;
  return { count: xs.length, median, p95 };
}

export const TIMING_FIELDS = [
  ["perceivedMs", "perceived", "Perceived (committed → first audio)"],
  ["callerWaitMs", "caller_wait", "Caller wait (last word → first audio)"],
  ["endpointingMs", "endpointing", "Endpointing (end-of-speech wait)"],
  ["asrMs", "asr", "ASR (committed → transcript)"],
  ["workflowMs", "workflow", "Workflow (transcript → route)"],
  ["llmRequestStartOffsetMs", "llm_request_start_offset", "LLM request start (after commit)"],
  ["llmTtftMs", "llm_ttft", "LLM first token"],
  ["llmFirstSpeakableMs", "llm_first_speakable", "LLM first speakable phrase"],
  ["ttsFirstAudioMs", "tts_first_audio", "TTS first audio"],
  ["fullTurnMs", "full_turn", "Full turn (last word → agent done)"],
] as const satisfies ReadonlyArray<readonly [keyof TurnTimings, string, string]>;

export type TimingKey = (typeof TIMING_FIELDS)[number][0];

/** Median / p95 per timing over a call's (or a window's) turns. */
export function summarizeTurnTimings(rows: TurnTimingRow[]): Array<{
  key: TimingKey;
  label: string;
  summary: LatencySummary | null;
}> {
  const timings = rows.map(computeTurnTimings);
  return TIMING_FIELDS.map(([key, , label]) => ({
    key,
    label,
    summary: summarizeLatency(timings.map((t) => t[key] as number | null)),
  }));
}

/** One turn as a metrics line: `[turn_metrics turn=3 asr=10 … perceived=1361 caller_wait=1565]`. */
export function turnMetricsLine(
  turn: number,
  t: TurnTimings,
  extra: Record<string, string | number | null | undefined> = {},
): string {
  const parts = [`turn=${turn}`];
  for (const [key, name] of TIMING_FIELDS) {
    const v = t[key];
    if (typeof v === "number") parts.push(`${name}=${v}`);
  }
  parts.push(`speech_end=${t.speechEndReference}`);
  for (const [k, v] of Object.entries(extra)) if (v !== null && v !== undefined && v !== "") parts.push(`${k}=${v}`);
  return `[turn_metrics ${parts.join(" ")}]`;
}

/** Dashboard meta lines: `[latency_median_perceived_ms=…]`, p95 too, for every measured timing. */
export function latencyMetaLines(rows: TurnTimingRow[]): string[] {
  const out: string[] = [];
  for (const { key, summary } of summarizeTurnTimings(rows)) {
    if (!summary) continue;
    const name = TIMING_FIELDS.find(([k]) => k === key)![1];
    out.push(`[latency_median_${name}_ms=${summary.median}]`, `[latency_p95_${name}_ms=${summary.p95}]`);
  }
  return out;
}
