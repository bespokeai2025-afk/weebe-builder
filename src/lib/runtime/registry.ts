/**
 * Runtime Registry — stub handlers for each deployment mode.
 *
 * Each entry declares the shape of what a fully-implemented runtime must
 * provide. RETELL is intentionally absent: it is managed by its own
 * dedicated module (retell.functions.ts) and is never routed through here.
 *
 * To add a new runtime:
 *   1. Add its DeploymentMode value to types.ts
 *   2. Implement NativeRuntimeHandler for it below
 *   3. Register it in RUNTIME_REGISTRY
 *
 * Nothing in this file ever touches Retell code.
 */

import type { DeploymentMode, RuntimeConfig } from "./types";

export interface NativeRuntimeHandler {
  mode: DeploymentMode;
  /**
   * Create a session and return connection parameters the browser needs
   * to open a realtime voice session (e.g. a client secret or WS URL).
   */
  createSession: (config: RuntimeConfig & { agentRowId: string; compiledPrompt: string }) => Promise<{
    clientSecret?: string;
    wsUrl?: string;
    sessionId?: string;
  }>;
  /** Human-readable status — used in UI to indicate readiness. */
  status: "available" | "coming_soon";
}

const openAINativeHandler: NativeRuntimeHandler = {
  mode: "OPENAI_NATIVE",
  status: "available",
  createSession: async () => {
    throw new Error(
      "createSession for OPENAI_NATIVE is handled by createOpenAIRealtimeSession server function. " +
        "Do not call the registry directly for this mode.",
    );
  },
};

const claudeNativeHandler: NativeRuntimeHandler = {
  mode: "CLAUDE_NATIVE",
  status: "coming_soon",
  createSession: async () => {
    throw new Error("Claude Native runtime is not yet implemented.");
  },
};

const geminiNativeHandler: NativeRuntimeHandler = {
  mode: "GEMINI_NATIVE",
  status: "coming_soon",
  createSession: async () => {
    throw new Error("Gemini Native runtime is not yet implemented.");
  },
};

export const RUNTIME_REGISTRY: Record<Exclude<DeploymentMode, "RETELL">, NativeRuntimeHandler> = {
  OPENAI_NATIVE: openAINativeHandler,
  CLAUDE_NATIVE: claudeNativeHandler,
  GEMINI_NATIVE: geminiNativeHandler,
};

export function getHandler(mode: DeploymentMode): NativeRuntimeHandler | null {
  if (mode === "RETELL") return null;
  return RUNTIME_REGISTRY[mode] ?? null;
}
