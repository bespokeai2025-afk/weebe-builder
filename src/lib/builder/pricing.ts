// Builder-only per-minute cost. Retell's published LLM rate plus a flat
// margin, shown only inside the builder so we can size runs against true
// cost. Customer-facing pricing lives elsewhere.
export const BUILDER_LLM_MARKUP_PER_MIN = 0.15;

// ── Voice Copilot API cost rates (OpenAI, USD) ──────────────────────────────
// GPT-4o as of 2025: $2.50/1M input tokens, $10.00/1M output tokens.
// Whisper: $0.006/min of audio.
export const VC_GPT4O_INPUT_PER_TOKEN  = 2.50 / 1_000_000;
export const VC_GPT4O_OUTPUT_PER_TOKEN = 10.00 / 1_000_000;
export const VC_WHISPER_PER_SECOND     = 0.006 / 60;

// Webespokeai profit margin on voice copilot usage.
// Raw cost × this multiplier = client-facing price.
// 2.5 = 150% gross margin (we pay $0.01, we charge $0.025).
export const VC_WEBESPOKEAI_MARKUP_MULTIPLIER = 2.5;

export interface VoiceCopilotUsage {
  promptTokens:     number;
  completionTokens: number;
  whisperSeconds:   number;
  rawCostUsd:       number;
  clientCostUsd:    number;
}

export function calcVoiceCopilotCost(
  promptTokens: number,
  completionTokens: number,
  whisperSeconds: number,
): VoiceCopilotUsage {
  const rawCostUsd =
    promptTokens     * VC_GPT4O_INPUT_PER_TOKEN +
    completionTokens * VC_GPT4O_OUTPUT_PER_TOKEN +
    whisperSeconds   * VC_WHISPER_PER_SECOND;
  return {
    promptTokens,
    completionTokens,
    whisperSeconds,
    rawCostUsd,
    clientCostUsd: rawCostUsd * VC_WEBESPOKEAI_MARKUP_MULTIPLIER,
  };
}

// Non-LLM infra per minute (voice engine + telephony + overhead). Picked so
// GPT-4.1 totals to $0.36/min, matching the historical flat cost meter.
export const BUILDER_INFRA_PER_MIN = 0.165;

export type ModelTier = "standard" | "fast";

export type ModelInfo = {
  id: string;
  label: string;
  tier: ModelTier;
  retellPerMin: number;
  costPerMin: number;
  recommended?: boolean;
};

// Exact model list and pricing sourced from https://www.retellai.com/pricing
// Fast Tier IDs use the same base name with "-fast" suffix (Retell convention).
// Claude and Gemini models are standard-only.
export const MODELS: ModelInfo[] = [
  // ── Standard tier ──────────────────────────────────────────────────────────
  {
    id: "gpt-5.5",
    label: "GPT 5.5",
    tier: "standard",
    retellPerMin: 0.16,
    costPerMin: 0.16 + BUILDER_LLM_MARKUP_PER_MIN,
  },
  {
    id: "gpt-5.4",
    label: "GPT 5.4",
    tier: "standard",
    retellPerMin: 0.08,
    costPerMin: 0.08 + BUILDER_LLM_MARKUP_PER_MIN,
  },
  {
    id: "gpt-5.2",
    label: "GPT 5.2",
    tier: "standard",
    retellPerMin: 0.056,
    costPerMin: 0.056 + BUILDER_LLM_MARKUP_PER_MIN,
  },
  {
    id: "gpt-5.1",
    label: "GPT 5.1",
    tier: "standard",
    retellPerMin: 0.04,
    costPerMin: 0.04 + BUILDER_LLM_MARKUP_PER_MIN,
  },
  {
    id: "gpt-5",
    label: "GPT 5",
    tier: "standard",
    retellPerMin: 0.04,
    costPerMin: 0.04 + BUILDER_LLM_MARKUP_PER_MIN,
  },
  {
    id: "gpt-5-mini",
    label: "GPT 5 mini",
    tier: "standard",
    retellPerMin: 0.012,
    costPerMin: 0.012 + BUILDER_LLM_MARKUP_PER_MIN,
  },
  {
    id: "gpt-5-nano",
    label: "GPT 5 nano",
    tier: "standard",
    retellPerMin: 0.003,
    costPerMin: 0.003 + BUILDER_LLM_MARKUP_PER_MIN,
  },
  {
    id: "gpt-4.1",
    label: "GPT 4.1",
    tier: "standard",
    recommended: true,
    retellPerMin: 0.045,
    costPerMin: 0.045 + BUILDER_LLM_MARKUP_PER_MIN,
  },
  {
    id: "gpt-4.1-mini",
    label: "GPT 4.1 mini",
    tier: "standard",
    retellPerMin: 0.016,
    costPerMin: 0.016 + BUILDER_LLM_MARKUP_PER_MIN,
  },
  {
    id: "gpt-4.1-nano",
    label: "GPT 4.1 nano",
    tier: "standard",
    retellPerMin: 0.004,
    costPerMin: 0.004 + BUILDER_LLM_MARKUP_PER_MIN,
  },
  {
    id: "claude-4.6-sonnet",
    label: "Claude 4.6 Sonnet",
    tier: "standard",
    retellPerMin: 0.08,
    costPerMin: 0.08 + BUILDER_LLM_MARKUP_PER_MIN,
  },
  {
    id: "claude-4.5-sonnet",
    label: "Claude 4.5 Sonnet",
    tier: "standard",
    retellPerMin: 0.08,
    costPerMin: 0.08 + BUILDER_LLM_MARKUP_PER_MIN,
  },
  {
    id: "claude-4.5-haiku",
    label: "Claude 4.5 Haiku",
    tier: "standard",
    retellPerMin: 0.025,
    costPerMin: 0.025 + BUILDER_LLM_MARKUP_PER_MIN,
  },
  {
    id: "gemini-3.0-flash",
    label: "Gemini 3.0 Flash",
    tier: "standard",
    retellPerMin: 0.027,
    costPerMin: 0.027 + BUILDER_LLM_MARKUP_PER_MIN,
  },
  {
    id: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    tier: "standard",
    retellPerMin: 0.035,
    costPerMin: 0.035 + BUILDER_LLM_MARKUP_PER_MIN,
  },
  {
    id: "gemini-2.5-flash-lite",
    label: "Gemini 2.5 Flash Lite",
    tier: "standard",
    retellPerMin: 0.006,
    costPerMin: 0.006 + BUILDER_LLM_MARKUP_PER_MIN,
  },

  // ── Fast Tier (lower latency, higher cost) ─────────────────────────────────
  {
    id: "gpt-5.5-fast",
    label: "GPT 5.5",
    tier: "fast",
    retellPerMin: 0.32,
    costPerMin: 0.32 + BUILDER_LLM_MARKUP_PER_MIN,
  },
  {
    id: "gpt-5.4-fast",
    label: "GPT 5.4",
    tier: "fast",
    retellPerMin: 0.16,
    costPerMin: 0.16 + BUILDER_LLM_MARKUP_PER_MIN,
  },
  {
    id: "gpt-5.2-fast",
    label: "GPT 5.2",
    tier: "fast",
    retellPerMin: 0.112,
    costPerMin: 0.112 + BUILDER_LLM_MARKUP_PER_MIN,
  },
  {
    id: "gpt-5.1-fast",
    label: "GPT 5.1",
    tier: "fast",
    retellPerMin: 0.08,
    costPerMin: 0.08 + BUILDER_LLM_MARKUP_PER_MIN,
  },
  {
    id: "gpt-5-fast",
    label: "GPT 5",
    tier: "fast",
    retellPerMin: 0.08,
    costPerMin: 0.08 + BUILDER_LLM_MARKUP_PER_MIN,
  },
  {
    id: "gpt-5-mini-fast",
    label: "GPT 5 mini",
    tier: "fast",
    retellPerMin: 0.024,
    costPerMin: 0.024 + BUILDER_LLM_MARKUP_PER_MIN,
  },
  {
    id: "gpt-5-nano-fast",
    label: "GPT 5 nano",
    tier: "fast",
    retellPerMin: 0.006,
    costPerMin: 0.006 + BUILDER_LLM_MARKUP_PER_MIN,
  },
  {
    id: "gpt-4.1-fast",
    label: "GPT 4.1",
    tier: "fast",
    recommended: true,
    retellPerMin: 0.0675,
    costPerMin: 0.0675 + BUILDER_LLM_MARKUP_PER_MIN,
  },
  {
    id: "gpt-4.1-mini-fast",
    label: "GPT 4.1 mini",
    tier: "fast",
    retellPerMin: 0.024,
    costPerMin: 0.024 + BUILDER_LLM_MARKUP_PER_MIN,
  },
  {
    id: "gpt-4.1-nano-fast",
    label: "GPT 4.1 nano",
    tier: "fast",
    retellPerMin: 0.006,
    costPerMin: 0.006 + BUILDER_LLM_MARKUP_PER_MIN,
  },
];

// Total per-minute cost for the test-call meter: infra + selected LLM (with
// markup). Falls back to GPT-4.1 if the id is unknown.
export function getTotalCostPerMinute(modelId: string | undefined | null): number {
  const m = MODELS.find((x) => x.id === modelId) ?? MODELS.find((x) => x.id === "gpt-4.1") ?? MODELS[0];
  return BUILDER_INFRA_PER_MIN + m.costPerMin;
}

// ── HyperStream (OpenAI Realtime) per-minute estimate ───────────────────────
// HyperStream calls bill against OpenAI's Realtime API (gpt-realtime), NOT
// Retell. Pricing is per audio token, not a flat per-minute LLM rate, so the
// Retell model meter above does not apply. OpenAI gpt-realtime (GA) audio
// rates: input $32/1M tokens, output $64/1M tokens. A typical two-way
// conversation runs ~800 audio tokens/min each direction once you account for
// silence, giving roughly:
//   input  ~800 tok/min * $32/1M  ≈ $0.026/min
//   output ~800 tok/min * $64/1M  ≈ $0.051/min
// We round up to a conservative blended estimate so the spend cap never
// undercounts. This is an ESTIMATE — real cost depends on talk ratio.
export const HYPERSTREAM_PER_MIN = 0.09;

export function getHyperStreamCostPerMinute(): number {
  return HYPERSTREAM_PER_MIN;
}
