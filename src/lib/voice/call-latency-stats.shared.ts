/**
 * Aggregations over `call_turns`.
 *
 * Kept pure and separate from the query so the maths is testable without a
 * database, and so the same shapes can be computed over a single test call or
 * over a week of production traffic.
 */

export const LATENCY_BUDGET_MS = 800;

export type CallTurnRow = {
  call_id: string;
  turn_index: number;
  speech_to_first_audio_ms: number | null;
  endpoint_to_stt_final_ms: number | null;
  stt_to_route_ms: number | null;
  stt_to_first_token_ms: number | null;
  stt_to_first_sentence_ms: number | null;
  stt_to_first_audio_ms: number | null;
  edge_route_method: string | null;
  global_route_method: string | null;
  speculative_hit: boolean | null;
  partial_commit: boolean | null;
  interrupted: boolean | null;
  node_id: string | null;
  created_at: string;
};

export type Percentiles = {
  p50: number;
  p90: number;
  p95: number;
  max: number;
  min: number;
  count: number;
};

/**
 * Nearest-rank percentile.
 *
 * Deliberately not interpolated: with a handful of turns from one test call,
 * an interpolated p95 invents a number no turn actually took, which is exactly
 * the sort of figure that ends up in a status update.
 */
export function percentiles(values: number[]): Percentiles | null {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const at = (q: number) => xs[Math.min(xs.length - 1, Math.max(0, Math.ceil(q * xs.length) - 1))]!;
  return {
    p50: at(0.5),
    p90: at(0.9),
    p95: at(0.95),
    max: xs[xs.length - 1]!,
    min: xs[0]!,
    count: xs.length,
  };
}

const STAGES = [
  ["endpoint_to_stt_final_ms", "Endpoint → STT final"],
  ["stt_to_route_ms", "STT → route resolved"],
  ["stt_to_first_token_ms", "STT → first LLM token"],
  ["stt_to_first_sentence_ms", "STT → first sentence"],
  ["stt_to_first_audio_ms", "STT → first audio"],
  ["speech_to_first_audio_ms", "Speech end → first audio"],
] as const;

export type StageStat = { key: string; label: string; stats: Percentiles | null };

export function stageBreakdown(rows: CallTurnRow[]): StageStat[] {
  return STAGES.map(([key, label]) => ({
    key,
    label,
    stats: percentiles(rows.map((r) => r[key]).filter((v): v is number => typeof v === "number")),
  }));
}

export type LatencyCategory = "endToEnd" | "transcription" | "llm" | "tts";

export type LatencyCategoryStat = { category: LatencyCategory; label: string; stats: Percentiles | null };

/**
 * Retell's own call-detail view shows four latency numbers — End to end, Transcription, LLM, TTS —
 * each isolated to that one stage rather than cumulative from call start. `call_turns` only stores
 * cumulative marks (`stt_to_first_token_ms` includes routing time before the LLM call even starts,
 * `stt_to_first_audio_ms` includes both the LLM's thinking time and TTS), so the LLM/TTS figures
 * here are derived by subtracting the stage before it — the same isolation Retell's own dashboard
 * implies by showing them as separate, roughly-summing numbers.
 *
 * A turn missing either mark of a pair (e.g. no routing happened) is simply excluded from that
 * category's sample rather than guessed at.
 */
export function retellLatencyCategories(rows: CallTurnRow[]): LatencyCategoryStat[] {
  const diff = (a: number | null, b: number | null): number | null =>
    typeof a === "number" && typeof b === "number" && a >= b ? a - b : null;

  const transcription = rows
    .map((r) => r.endpoint_to_stt_final_ms)
    .filter((v): v is number => typeof v === "number");
  const llm = rows
    .map((r) => diff(r.stt_to_first_token_ms, r.stt_to_route_ms ?? 0))
    .filter((v): v is number => typeof v === "number");
  // This bucket is first token -> first audio, which is NOT synthesis time alone.
  // `guardPrematureWrapUpStream` withholds every chunk until the LLM completes a first
  // sentence (or hits 120 chars), and `llm_speech_first_token` is marked upstream of that
  // guard — so the LLM finishing its sentence is billed here too.
  //
  // `stt_to_first_sentence_ms` (llm_speech_first_sentence) splits the two. It was long dead
  // on the assumption that only a batch-into-sentences TTS path could mark it and Fish, the
  // default provider, streams continuously with no sentence checkpoint. That was wrong: the
  // guard is a real checkpoint on every prompt node regardless of provider, and the mark now
  // fires there. Rows written before that change still have it null.
  const tts = rows
    .map((r) => diff(r.stt_to_first_audio_ms, r.stt_to_first_token_ms))
    .filter((v): v is number => typeof v === "number");
  const endToEnd = rows
    .map((r) => r.speech_to_first_audio_ms)
    .filter((v): v is number => typeof v === "number");

  return [
    { category: "endToEnd", label: "End to end latency", stats: percentiles(endToEnd) },
    { category: "transcription", label: "Transcription latency", stats: percentiles(transcription) },
    { category: "llm", label: "LLM latency", stats: percentiles(llm) },
    { category: "tts", label: "TTS latency", stats: percentiles(tts) },
  ];
}

export type MethodShare = { method: string; turns: number; share: number; medianMs: number | null };

/**
 * How often each routing path was taken, and what it cost.
 *
 * This is the number that decides whether the LLM classifier is worth
 * attacking: `method: "llm"` means a full model round trip sat on the critical
 * path of that turn. Median is reported per method so a rare-but-slow path
 * cannot hide behind a low share.
 */
export function routeMethodShare(rows: CallTurnRow[], scope: "edge" | "global"): MethodShare[] {
  const field = scope === "edge" ? "edge_route_method" : "global_route_method";
  const buckets = new Map<string, number[]>();
  for (const r of rows) {
    const method = r[field] ?? "none";
    const arr = buckets.get(method) ?? [];
    if (typeof r.stt_to_first_audio_ms === "number") arr.push(r.stt_to_first_audio_ms);
    buckets.set(method, arr);
  }
  const counts = new Map<string, number>();
  for (const r of rows) {
    const method = r[field] ?? "none";
    counts.set(method, (counts.get(method) ?? 0) + 1);
  }
  const total = rows.length || 1;
  return [...counts.entries()]
    .map(([method, turns]) => ({
      method,
      turns,
      share: turns / total,
      medianMs: percentiles(buckets.get(method) ?? [])?.p50 ?? null,
    }))
    .sort((a, b) => b.turns - a.turns);
}

export type SpeculationStat = {
  turns: number;
  hits: number;
  hitRate: number;
  medianWithHitMs: number | null;
  medianWithoutHitMs: number | null;
  /** Positive means speculation is earning its keep. */
  savedMs: number | null;
};

/**
 * Whether speculative speech is paying for itself.
 *
 * A hit rate on its own says nothing — speculation costs tokens on every
 * partial, so the question is whether turns that hit were actually faster.
 * `savedMs` is that comparison, and it is null until both groups have turns.
 */
export function speculationStat(rows: CallTurnRow[]): SpeculationStat {
  const withHit: number[] = [];
  const withoutHit: number[] = [];
  let hits = 0;
  for (const r of rows) {
    if (r.speculative_hit) hits++;
    const v = r.speech_to_first_audio_ms ?? r.stt_to_first_audio_ms;
    if (typeof v !== "number") continue;
    (r.speculative_hit ? withHit : withoutHit).push(v);
  }
  const a = percentiles(withHit)?.p50 ?? null;
  const b = percentiles(withoutHit)?.p50 ?? null;
  return {
    turns: rows.length,
    hits,
    hitRate: rows.length ? hits / rows.length : 0,
    medianWithHitMs: a,
    medianWithoutHitMs: b,
    savedMs: a !== null && b !== null ? b - a : null,
  };
}

/** Share of turns at or under the budget — the headline "are we Retell-fast" number. */
export function withinBudget(rows: CallTurnRow[], budgetMs = LATENCY_BUDGET_MS) {
  const vals = rows
    .map((r) => r.speech_to_first_audio_ms ?? r.stt_to_first_audio_ms)
    .filter((v): v is number => typeof v === "number");
  if (vals.length === 0) return { measured: 0, within: 0, share: 0, budgetMs };
  const within = vals.filter((v) => v <= budgetMs).length;
  return { measured: vals.length, within, share: within / vals.length, budgetMs };
}
