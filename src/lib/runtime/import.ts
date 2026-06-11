/**
 * Runtime Import Adapter
 *
 * The Runtime's typed entry point for consuming an AgentRuntimeDefinition.
 *
 * RULES enforced here:
 *   - Runtime never generates prompts  →  extractors read fields, never call Builder functions
 *   - Builder never manages sessions   →  nothing in this file creates sessions or calls
 *   - Providers interchangeable        →  each extractor asserts its expected provider
 *   - Retell path untouched            →  extractRetellParams reads runtimeConfig.retell
 *                                         without calling or modifying any Retell code
 *
 * Usage pattern for a Runtime service:
 *
 *   import { parseIncomingDefinition, extractRetellParams } from "@/lib/runtime/import";
 *
 *   const def = parseIncomingDefinition(incomingJson);   // validates + throws on bad input
 *   const params = extractRetellParams(def);             // typed Retell execution params
 *   // → push params.agentJson to Retell API, or use params.agentId for an existing agent
 */

import {
  AgentRuntimeDefinitionSchema,
  SUPPORTED_RUNTIME_VERSIONS,
  validateRuntimeDefinition,
} from "./schema";
import type {
  AgentRuntimeDefinition,
  RetellRuntimeConfig,
  OpenAIRuntimeConfig,
  ValidationResult,
} from "./schema";

export type { AgentRuntimeDefinition, ValidationResult };

// ─── Ingestion ────────────────────────────────────────────────────────────────

/**
 * Validate and parse an incoming JSON value as an AgentRuntimeDefinition.
 * Throws a descriptive ZodError if the input is invalid or the runtimeVersion
 * is not supported by this build.
 *
 * Call this at the Runtime's ingestion boundary — before any execution logic.
 */
export function parseIncomingDefinition(raw: unknown): AgentRuntimeDefinition {
  const def = AgentRuntimeDefinitionSchema.parse(raw);
  assertSupportedVersion(def.runtimeVersion);
  return def;
}

/**
 * Same as parseIncomingDefinition but returns a Result instead of throwing.
 * Useful when the Runtime needs to surface a user-friendly error rather than
 * propagate an exception (e.g. in a webhook handler).
 */
export function safeParseIncomingDefinition(raw: unknown): ValidationResult {
  const result = validateRuntimeDefinition(raw);
  if (!result.ok) return result;

  try {
    assertSupportedVersion(result.data.runtimeVersion);
  } catch (err) {
    return {
      ok: false,
      errors: [String(err instanceof Error ? err.message : err)],
    };
  }

  return result;
}

// ─── Retell execution params ──────────────────────────────────────────────────

/**
 * Typed Retell execution parameters extracted from a runtime definition.
 * agentJson is push-ready — it can be sent directly to the Retell agent API
 * without any further transformation.
 */
export interface RetellExecutionParams {
  provider: "RETELL";
  agentId: string | null;
  webhookUrl: string;
  /**
   * Complete Retell agent JSON. Push to:
   *   PUT https://api.retellai.com/update-agent/{agentId}   (existing agent)
   *   POST https://api.retellai.com/create-agent             (new agent)
   */
  agentJson: Record<string, unknown>;
  /** Convenience: the agentName from the top-level definition. */
  agentName: string;
  /** Voice config for any Retell-level voice overrides. */
  voiceId: string;
  language: string;
}

/**
 * Extract Retell execution parameters from a definition.
 * Throws if the definition's provider is not "RETELL" or if retell config
 * is absent (should never happen for a valid RETELL definition).
 */
export function extractRetellParams(def: AgentRuntimeDefinition): RetellExecutionParams {
  if (def.provider !== "RETELL") {
    throw new Error(
      `extractRetellParams called on a ${def.provider} definition. ` +
        `Use the correct extractor for this provider.`,
    );
  }
  if (!def.runtimeConfig.retell) {
    throw new Error(
      `AgentRuntimeDefinition for agent "${def.agentId}" has provider=RETELL ` +
        `but runtimeConfig.retell is absent. This is a Builder assembly bug.`,
    );
  }
  const retell = def.runtimeConfig.retell as RetellRuntimeConfig;
  return {
    provider: "RETELL",
    agentId: retell.agentId,
    webhookUrl: retell.webhookUrl,
    agentJson: retell.agentJson,
    agentName: def.agentName,
    voiceId: def.voiceConfig.voiceId,
    language: def.voiceConfig.language,
  };
}

// ─── OpenAI Realtime execution params ─────────────────────────────────────────

/**
 * Typed OpenAI Realtime execution parameters extracted from a runtime definition.
 * systemPrompt is ready for session.update({ instructions: systemPrompt }).
 * The Runtime MUST NOT re-compile or modify the prompt — it is authoritative.
 */
export interface OpenAIExecutionParams {
  provider: "OPENAI_NATIVE";
  voice: string;
  reasoningEffort: string;
  /**
   * Full system prompt ready for session.update({ instructions }).
   * Do not regenerate this — it was compiled by the Builder from the graph.
   */
  systemPrompt: string;
  /** Convenience copy of agentName for session metadata. */
  agentName: string;
  /** OpenAI Realtime model identifier. */
  model: string;
}

/**
 * Extract OpenAI Realtime execution parameters from a definition.
 * Throws if the definition's provider is not "OPENAI_NATIVE".
 */
export function extractOpenAIParams(def: AgentRuntimeDefinition): OpenAIExecutionParams {
  if (def.provider !== "OPENAI_NATIVE") {
    throw new Error(
      `extractOpenAIParams called on a ${def.provider} definition. ` +
        `Use the correct extractor for this provider.`,
    );
  }
  if (!def.runtimeConfig.openai) {
    throw new Error(
      `AgentRuntimeDefinition for agent "${def.agentId}" has provider=OPENAI_NATIVE ` +
        `but runtimeConfig.openai is absent. This is a Builder assembly bug.`,
    );
  }
  const openai = def.runtimeConfig.openai as OpenAIRuntimeConfig;
  return {
    provider: "OPENAI_NATIVE",
    voice: openai.voice,
    reasoningEffort: openai.reasoningEffort,
    systemPrompt: openai.systemPrompt,
    agentName: def.agentName,
    model: "gpt-realtime",
  };
}

// ─── Generic provider dispatch ────────────────────────────────────────────────

/**
 * Extract execution params for whichever provider the definition declares.
 * Returns a discriminated union that callers can switch on.
 *
 * Useful when the Runtime handles multiple providers in a single code path.
 */
export type AnyExecutionParams =
  | RetellExecutionParams
  | OpenAIExecutionParams
  | { provider: "CLAUDE_NATIVE"; agentId: string; agentName: string }
  | { provider: "GEMINI_NATIVE"; agentId: string; agentName: string };

export function extractExecutionParams(def: AgentRuntimeDefinition): AnyExecutionParams {
  switch (def.provider) {
    case "RETELL":
      return extractRetellParams(def);
    case "OPENAI_NATIVE":
      return extractOpenAIParams(def);
    case "CLAUDE_NATIVE":
      return { provider: "CLAUDE_NATIVE", agentId: def.agentId, agentName: def.agentName };
    case "GEMINI_NATIVE":
      return { provider: "GEMINI_NATIVE", agentId: def.agentId, agentName: def.agentName };
  }
}

// ─── Version guard ────────────────────────────────────────────────────────────

function assertSupportedVersion(version: string): void {
  const supported = SUPPORTED_RUNTIME_VERSIONS as readonly string[];
  if (!supported.includes(version)) {
    throw new Error(
      `Unsupported runtimeVersion "${version}". ` +
        `This Runtime build supports: ${supported.join(", ")}. ` +
        `Export a fresh definition from the Builder, or use migrate.ts to upgrade.`,
    );
  }
}
