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

// ── HyperStream (OpenAI Realtime) per-minute estimates ──────────────────────
// HyperStream calls bill against OpenAI's Realtime API directly, NOT Retell.
// Pricing is per audio token; the per-minute figures below are conservative
// blended estimates at a typical ~800 audio tok/min each direction.
//
// gpt-4o-realtime-preview:
//   input  ~800 tok/min * $40/1M  ≈ $0.032/min
//   output ~800 tok/min * $80/1M  ≈ $0.064/min  → $0.09/min (rounded up)
//
// gpt-4o-mini-realtime-preview:
//   input  ~800 tok/min *  $8/1M  ≈ $0.006/min
//   output ~800 tok/min * $16/1M  ≈ $0.013/min  → $0.02/min (rounded up)
//
// All figures are ESTIMATES — actual cost depends on talk ratio and token usage.

export type HyperStreamModelInfo = {
  id: string;
  label: string;
  desc: string;
  costPerMin: number;
  recommended?: boolean;
};

export const HYPERSTREAM_MODELS: HyperStreamModelInfo[] = [
  {
    id: "gpt-4o-realtime-preview",
    label: "GPT-4o Realtime",
    desc: "Full capability — balanced quality & speed",
    costPerMin: 0.09,
    recommended: true,
  },
  {
    id: "gpt-4.1",
    label: "GPT-4.1 Realtime",
    desc: "Latest GPT-4.1 via the realtime engine",
    costPerMin: 0.07,
  },
  {
    id: "gpt-4o-mini-realtime-preview",
    label: "GPT-4o Mini Realtime",
    desc: "Fastest & cheapest — ideal for simple flows",
    costPerMin: 0.02,
  },
];

export const DEFAULT_HYPERSTREAM_MODEL = "gpt-4o-realtime-preview";

/** Legacy flat-rate constant — kept for backward compat with the cost meter. */
export const HYPERSTREAM_PER_MIN = 0.09;

/**
 * Twilio PSTN telephony charge added on top of OpenAI token cost for live
 * HyperStream calls. Covers inbound/outbound per-minute carrier fees.
 * Builder test calls (WebRTC) do NOT incur this charge.
 * ~$0.013–0.017/min blended US rate; $0.015 used as the display estimate.
 */
export const HYPERSTREAM_TELEPHONY_PER_MIN = 0.015;

export function getHyperStreamCostPerMinute(modelId?: string): number {
  return HYPERSTREAM_MODELS.find((m) => m.id === modelId)?.costPerMin ?? HYPERSTREAM_PER_MIN;
}

// ── VoxStream (ElevenLabs Conversational AI) per-minute estimate ─────────────
// ElevenLabs ConvAI pricing: GPT-4o backbone at standard token rates plus
// ElevenLabs Turbo v2.5 voice. Blended estimate at typical talk ratios:
//   GPT-4o input  ~300 tok/min * $2.50/1M  ≈ $0.0008/min
//   GPT-4o output ~150 tok/min * $10.0/1M  ≈ $0.0015/min
//   EL Turbo v2.5 ~3,000 chars/min * $0.015/1k chars ≈ $0.045/min
//   → ~$0.05/min blended. Builder test calls are WebRTC (no telephony charge).
export const ELEVENLABS_PER_MIN = 0.05;

// ── Exact per-token billing rates for HyperStream ──────────────────────────
// Source: https://openai.com/api/pricing/
// OpenAI Realtime API bills audio and text tokens at different rates.
// The response.done event carries input_token_details / output_token_details
// with the exact split — use these for the most accurate cost figure.
//
// gpt-4o-realtime-preview:  audioIn $40/1M  audioOut $80/1M  textIn $5/1M  textOut $20/1M
// gpt-4o-mini-realtime-preview: audioIn $10/1M audioOut $20/1M textIn $1.25/1M textOut $5/1M
// gpt-realtime (gpt-4.1):   same rates as gpt-4o-realtime-preview (same endpoint)

export type HyperStreamTokenRates = {
  textIn:   number;   // USD per token
  audioIn:  number;
  textOut:  number;
  audioOut: number;
};

export const HYPERSTREAM_TOKEN_RATES: Record<string, HyperStreamTokenRates> = {
  "gpt-4o-realtime-preview": {
    textIn:    5.00 / 1_000_000,
    audioIn:  40.00 / 1_000_000,
    textOut:  20.00 / 1_000_000,
    audioOut: 80.00 / 1_000_000,
  },
  "gpt-4o-mini-realtime-preview": {
    textIn:   1.25 / 1_000_000,
    audioIn: 10.00 / 1_000_000,
    textOut:  5.00 / 1_000_000,
    audioOut: 20.00 / 1_000_000,
  },
  "gpt-realtime": {
    textIn:    5.00 / 1_000_000,
    audioIn:  40.00 / 1_000_000,
    textOut:  20.00 / 1_000_000,
    audioOut: 80.00 / 1_000_000,
  },
};

/**
 * Calculate exact USD cost for one response.done turn.
 *
 * Pass `inputDetails` / `outputDetails` from `usage.input_token_details` /
 * `usage.output_token_details` when present (full accuracy).
 * Provide `fallbackInputTokens` / `fallbackOutputTokens` as a safety net for
 * models that don't return the detail breakdown — they're billed at audio rates
 * (conservative worst-case).
 */
export function calcHyperStreamTurnCost(
  realtimeModelId: string,
  inputDetails:  { text_tokens?: number; audio_tokens?: number } | undefined,
  outputDetails: { text_tokens?: number; audio_tokens?: number } | undefined,
  fallbackInputTokens?:  number,
  fallbackOutputTokens?: number,
): number {
  const rates =
    HYPERSTREAM_TOKEN_RATES[realtimeModelId] ??
    HYPERSTREAM_TOKEN_RATES["gpt-4o-realtime-preview"];

  if (inputDetails !== undefined && outputDetails !== undefined) {
    return (
      (inputDetails.text_tokens   ?? 0) * rates.textIn  +
      (inputDetails.audio_tokens  ?? 0) * rates.audioIn +
      (outputDetails.text_tokens  ?? 0) * rates.textOut +
      (outputDetails.audio_tokens ?? 0) * rates.audioOut
    );
  }
  // Fallback: charge all tokens at audio rates (conservative)
  return (
    (fallbackInputTokens  ?? 0) * rates.audioIn +
    (fallbackOutputTokens ?? 0) * rates.audioOut
  );
}
