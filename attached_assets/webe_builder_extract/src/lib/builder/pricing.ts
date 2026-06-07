// Builder-only per-minute cost. Retell's published LLM rate plus a flat
// margin, shown only inside the builder so we can size runs against true
// cost. Customer-facing pricing lives elsewhere.
export const BUILDER_LLM_MARKUP_PER_MIN = 0.15;

// Non-LLM infra per minute (voice engine + telephony + overhead). Picked so
// GPT-4.1 totals to $0.36/min, matching the historical flat cost meter.
export const BUILDER_INFRA_PER_MIN = 0.165;

export type ModelInfo = {
  id: string;
  label: string;
  retellPerMin: number;
  costPerMin: number;
};

export const MODELS: ModelInfo[] = [
  // Versatile / highly intelligent
  { id: "gpt-4.1", label: "GPT 4.1", retellPerMin: 0.045, costPerMin: 0.045 + BUILDER_LLM_MARKUP_PER_MIN },
  { id: "gpt-5.1", label: "GPT 5.1", retellPerMin: 0.04, costPerMin: 0.04 + BUILDER_LLM_MARKUP_PER_MIN },
  { id: "gpt-5.5", label: "GPT 5.5", retellPerMin: 0.16, costPerMin: 0.16 + BUILDER_LLM_MARKUP_PER_MIN },
  { id: "gpt-5.4", label: "GPT 5.4", retellPerMin: 0.08, costPerMin: 0.08 + BUILDER_LLM_MARKUP_PER_MIN },
  { id: "gpt-5.2", label: "GPT 5.2", retellPerMin: 0.056, costPerMin: 0.056 + BUILDER_LLM_MARKUP_PER_MIN },
  { id: "gpt-5", label: "GPT 5", retellPerMin: 0.04, costPerMin: 0.04 + BUILDER_LLM_MARKUP_PER_MIN },
  { id: "claude-4.6-sonnet", label: "Claude 4.6 Sonnet", retellPerMin: 0.08, costPerMin: 0.08 + BUILDER_LLM_MARKUP_PER_MIN },
  { id: "claude-4.5-sonnet", label: "Claude 4.5 Sonnet", retellPerMin: 0.08, costPerMin: 0.08 + BUILDER_LLM_MARKUP_PER_MIN },
  { id: "gemini-3.0-flash", label: "Gemini 3.0 Flash", retellPerMin: 0.027, costPerMin: 0.027 + BUILDER_LLM_MARKUP_PER_MIN },
  // Fast and cost-efficient
  { id: "gpt-5.4-mini", label: "GPT 5.4 mini", retellPerMin: 0.036, costPerMin: 0.036 + BUILDER_LLM_MARKUP_PER_MIN },
  { id: "gpt-5.4-nano", label: "GPT 5.4 nano", retellPerMin: 0.010, costPerMin: 0.010 + BUILDER_LLM_MARKUP_PER_MIN },
  { id: "gpt-5-mini", label: "GPT 5 mini", retellPerMin: 0.012, costPerMin: 0.012 + BUILDER_LLM_MARKUP_PER_MIN },
  { id: "gpt-5-nano", label: "GPT 5 nano", retellPerMin: 0.003, costPerMin: 0.003 + BUILDER_LLM_MARKUP_PER_MIN },
  { id: "gpt-4.1-mini", label: "GPT 4.1 mini", retellPerMin: 0.016, costPerMin: 0.016 + BUILDER_LLM_MARKUP_PER_MIN },
  { id: "gpt-4.1-nano", label: "GPT 4.1 nano", retellPerMin: 0.004, costPerMin: 0.004 + BUILDER_LLM_MARKUP_PER_MIN },
  { id: "claude-4.5-haiku", label: "Claude 4.5 Haiku", retellPerMin: 0.025, costPerMin: 0.025 + BUILDER_LLM_MARKUP_PER_MIN },
  { id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash Lite", retellPerMin: 0.014, costPerMin: 0.014 + BUILDER_LLM_MARKUP_PER_MIN },
  { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite", retellPerMin: 0.006, costPerMin: 0.006 + BUILDER_LLM_MARKUP_PER_MIN },
];

// Total per-minute cost for the test-call meter: infra + selected LLM (with
// markup). Falls back to GPT-4.1 if the id is unknown.
export function getTotalCostPerMinute(modelId: string | undefined | null): number {
  const m = MODELS.find((x) => x.id === modelId) ?? MODELS[0];
  return BUILDER_INFRA_PER_MIN + m.costPerMin;
}
