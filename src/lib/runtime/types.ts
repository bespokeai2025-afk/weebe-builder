/**
 * Deployment modes for the voice runtime infrastructure.
 *
 * RETELL        — OmniVoice engine via Retell AI (default, all existing agents)
 * OPENAI_NATIVE — HyperStream engine via OpenAI Realtime API
 * CLAUDE_NATIVE — Native Anthropic Claude voice runtime (future)
 * GEMINI_NATIVE — Native Google Gemini voice runtime (future)
 */
export type DeploymentMode =
  | "RETELL"
  | "OPENAI_NATIVE"
  | "CLAUDE_NATIVE"
  | "GEMINI_NATIVE";

/** Human-readable metadata for each mode, used in the Builder UI. */
export interface RuntimeDescriptor {
  mode: DeploymentMode;
  label: string;
  sublabel: string;
  /** True when the runtime is production-ready; false = coming soon. */
  available: boolean;
  /** Icon name (maps to a Lucide icon in the consumer component). */
  icon: "radio" | "zap" | "sparkles" | "gem";
}

/** Resolved runtime context passed to execution handlers. */
export interface RuntimeConfig {
  mode: DeploymentMode;
  /** Resolved OpenAI voice name (only meaningful for OPENAI_NATIVE). */
  openaiVoice?: string;
  /** Resolved OpenAI reasoning effort (only meaningful for OPENAI_NATIVE). */
  openaiReasoningEffort?: string;
}

export const ALL_DEPLOYMENT_MODES: RuntimeDescriptor[] = [
  {
    mode: "RETELL",
    label: "OmniVoice Engine",
    sublabel: "Premium Catalog",
    available: true,
    icon: "radio",
  },
  {
    mode: "OPENAI_NATIVE",
    label: "HyperStream Engine",
    sublabel: "Instant Response",
    available: true,
    icon: "zap",
  },
  {
    mode: "CLAUDE_NATIVE",
    label: "Claude Engine",
    sublabel: "Coming Soon",
    available: false,
    icon: "sparkles",
  },
  {
    mode: "GEMINI_NATIVE",
    label: "Gemini Engine",
    sublabel: "Coming Soon",
    available: false,
    icon: "gem",
  },
];
