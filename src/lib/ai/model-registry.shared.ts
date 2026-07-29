// ── Central AI model registry — shared (client-safe) ─────────────────────────
// Single source of truth for Mind model roles, friendly labels and cost
// estimates. NO secrets and NO env reads here — env-var overrides and
// availability checks live in model-registry.server.ts.
//
// Normal users must never see raw model IDs — use friendlyModelLabel().

export type AiProvider = "openai" | "gemini" | "claude";

/** Every AI role the platform routes through the registry. */
export type ModelRole =
  | "hivemind_chat"
  | "hivemind_executive"
  | "hivemind_background"
  | "growthmind_chat"
  | "growthmind_video_planning"
  | "growthmind_video_render"
  | "growthmind_video_draft";

export type ReasoningEffort = "none" | "low" | "medium" | "high";

export type RoleAssignment = {
  role: ModelRole;
  provider: AiProvider;
  model: string;
  reasoningEffort: ReasoningEffort | null;
  /** Friendly label shown to non-technical users (never a raw model ID). */
  friendlyLabel: string;
  envVar: string;
};

// Verified live against production credentials on 2026-07-29:
//   OpenAI:  gpt-5.6-terra / gpt-5.6-sol / gpt-5.6-luna / gpt-5.5 / gpt-5.4
//   Gemini:  gemini-3.1-pro-preview, veo-3.1-generate-preview,
//            veo-3.1-fast-generate-preview
// NOTE: the Vertex names (veo-3.1-generate-001) are NOT available on this
// key — the Gemini API uses the "-preview" IDs.
export const DEFAULT_ROLE_ASSIGNMENTS: Record<ModelRole, RoleAssignment> = {
  hivemind_chat: {
    role: "hivemind_chat",
    provider: "openai",
    model: "gpt-5.6-terra",
    reasoningEffort: "low",
    friendlyLabel: "HiveMind — Standard intelligence",
    envVar: "HIVEMIND_CHAT_MODEL",
  },
  hivemind_executive: {
    role: "hivemind_executive",
    provider: "openai",
    model: "gpt-5.6-sol",
    reasoningEffort: "medium",
    friendlyLabel: "HiveMind — Advanced reasoning",
    envVar: "HIVEMIND_EXECUTIVE_MODEL",
  },
  hivemind_background: {
    role: "hivemind_background",
    provider: "openai",
    model: "gpt-5.6-luna",
    reasoningEffort: "none",
    friendlyLabel: "HiveMind — Fast background processing",
    envVar: "HIVEMIND_BACKGROUND_MODEL",
  },
  growthmind_chat: {
    role: "growthmind_chat",
    provider: "openai",
    model: "gpt-5.6-terra",
    reasoningEffort: "low",
    friendlyLabel: "GrowthMind — Standard intelligence",
    envVar: "GROWTHMIND_CHAT_MODEL",
  },
  growthmind_video_planning: {
    role: "growthmind_video_planning",
    provider: "gemini",
    model: "gemini-3.1-pro-preview",
    reasoningEffort: null,
    friendlyLabel: "Video planning engine",
    envVar: "GROWTHMIND_VIDEO_PLANNING_MODEL",
  },
  growthmind_video_render: {
    role: "growthmind_video_render",
    provider: "gemini",
    model: "veo-3.1-generate-preview",
    reasoningEffort: null,
    friendlyLabel: "Video quality: Premium",
    envVar: "GROWTHMIND_VIDEO_RENDER_MODEL",
  },
  growthmind_video_draft: {
    role: "growthmind_video_draft",
    provider: "gemini",
    model: "veo-3.1-fast-generate-preview",
    reasoningEffort: null,
    friendlyLabel: "Video quality: Fast draft",
    envVar: "GROWTHMIND_VIDEO_DRAFT_MODEL",
  },
};

/**
 * Approved explicit OpenAI fallback chain. NEVER falls back to gpt-4o.
 * Order: gpt-5.6-terra → gpt-5.5 → gpt-5.4.
 * A fallback must always be recorded in the ai_usage_ledger — never silent.
 */
export const OPENAI_FALLBACK_CHAIN: string[] = ["gpt-5.6-terra", "gpt-5.5", "gpt-5.4"];

// ── Cost estimates (USD per 1M tokens) ────────────────────────────────────────
// These are ESTIMATES used for the internal cost ledger — actual billing is
// whatever the provider invoices. Update here when provider pricing changes.
export type TokenCost = { input: number; cachedInput: number; output: number };

export const AI_TOKEN_COSTS: Record<string, TokenCost> = {
  "gpt-5.6-terra":          { input: 2.0,   cachedInput: 0.5,   output: 12.0 },
  "gpt-5.6-sol":            { input: 5.0,   cachedInput: 1.25,  output: 30.0 },
  "gpt-5.6-luna":           { input: 0.3,   cachedInput: 0.075, output: 1.8  },
  "gpt-5.5":                { input: 1.5,   cachedInput: 0.375, output: 10.0 },
  "gpt-5.4":                { input: 1.0,   cachedInput: 0.25,  output: 8.0  },
  "gpt-4o":                 { input: 2.5,   cachedInput: 1.25,  output: 10.0 },
  "gpt-4o-mini":            { input: 0.15,  cachedInput: 0.075, output: 0.6  },
  "gpt-4.1":                { input: 2.0,   cachedInput: 0.5,   output: 8.0  },
  "gpt-4.1-mini":           { input: 0.4,   cachedInput: 0.1,   output: 1.6  },
  "gemini-3.1-pro-preview": { input: 2.0,   cachedInput: 0.5,   output: 12.0 },
  "gemini-2.5-pro":         { input: 1.25,  cachedInput: 0.31,  output: 10.0 },
  "gemini-2.5-flash":       { input: 0.075, cachedInput: 0.019, output: 0.3  },
  "claude-sonnet-4-5":      { input: 3.0,   cachedInput: 0.3,   output: 15.0 },
};

/** Veo video render cost estimates, USD per second of output video. */
export const VIDEO_SECOND_COSTS: Record<string, number> = {
  "veo-3.1-generate-preview":      0.75,
  "veo-3.1-fast-generate-preview": 0.15,
};

export function estimateAiCostUsd(args: {
  model: string;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  videoSeconds?: number;
}): number {
  const { model } = args;
  let usd = 0;
  const t = AI_TOKEN_COSTS[model];
  if (t) {
    const cached = args.cachedInputTokens ?? 0;
    const freshIn = Math.max((args.inputTokens ?? 0) - cached, 0);
    // Reasoning tokens are billed as output tokens by OpenAI.
    const out = (args.outputTokens ?? 0) + (args.reasoningTokens ?? 0);
    usd += (freshIn / 1_000_000) * t.input + (cached / 1_000_000) * t.cachedInput + (out / 1_000_000) * t.output;
  }
  const vps = VIDEO_SECOND_COSTS[model];
  if (vps && args.videoSeconds) usd += vps * args.videoSeconds;
  return Math.round(usd * 1_000_000) / 1_000_000;
}

/** Map a raw model ID to a user-safe friendly label. */
export function friendlyModelLabel(model: string): string {
  for (const a of Object.values(DEFAULT_ROLE_ASSIGNMENTS)) {
    if (a.model === model) return a.friendlyLabel;
  }
  if (model.startsWith("gpt-5")) return "Advanced AI model";
  if (model.startsWith("veo")) return "Video generation engine";
  if (model.startsWith("gemini")) return "AI content engine";
  return "AI model";
}
