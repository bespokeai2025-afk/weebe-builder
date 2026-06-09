/**
 * Canonical agent runtime definition — the portable, self-contained
 * representation of an agent that can be executed without Builder access.
 *
 * The Builder is always the system of record. This definition is a read-only
 * projection assembled at export time from the Builder's stored state.
 *
 * Consumers (external runtime services, audit systems, migration tooling)
 * MUST rely solely on this shape and MUST NOT read the Builder database
 * directly. All execution-relevant data is present in this document.
 */

import type { DeploymentMode } from "./types";
import type { BuilderVariable } from "@/lib/builder/types";

// ─── Version constants ────────────────────────────────────────────────────────

/**
 * Incremented when the shape of AgentRuntimeDefinition changes in a
 * backward-incompatible way. Consumers should gate on this.
 */
export const RUNTIME_VERSION = "1.0.0";

/**
 * The current Builder application version. Recorded for audit/provenance.
 * Update this when the Builder ships a breaking change to its data model.
 */
export const BUILDER_VERSION = "2.0.0";

// ─── Sub-shapes ──────────────────────────────────────────────────────────────

export interface RuntimeModelConfig {
  /** Internal model ID used in the Builder UI (e.g. "gpt-4.1", "gpt-4.1-fast"). */
  id: string;
  /** Sampling temperature (0–1). */
  temperature: number;
  /** OpenAI Realtime voice — only set when provider is OPENAI_NATIVE. */
  openaiVoice?: string;
  /** OpenAI Realtime reasoning effort — only set when provider is OPENAI_NATIVE. */
  openaiReasoningEffort?: string;
}

export interface RuntimeWorkflow {
  /** All ReactFlow nodes from the Builder graph (serialised). */
  nodes: unknown[];
  /** All ReactFlow edges from the Builder graph (serialised). */
  edges: unknown[];
  /** ID of the start node (null only if the graph has no nodes). */
  startNodeId: string | null;
  /** Global prompt text set in the Builder. */
  globalPrompt: string;
  /** Opening message spoken by the agent at call start. */
  beginMessage: string;
  /** Who speaks first: "agent" | "user". */
  startSpeaker: string;
}

export interface RuntimeKnowledgeBase {
  /** Retell knowledge base IDs linked to this agent. */
  ids: string[];
  config: {
    /** Number of chunks to retrieve per query. */
    topK: number;
    /** Minimum cosine similarity score for a chunk to be included. */
    filterScore: number;
  };
}

export interface RuntimeVoiceConfig {
  voiceId: string;
  language: string;
  speechLanguages: string[];
  voiceSpeed: number;
  voiceTemperature: number;
  volume: number;
  voiceEmotion: string | null;
  enableBackchannel: boolean;
  backchannelFrequency: number;
  backchannelWords: string[];
  ambientSound: string | null;
  ambientSoundVolume: number;
  sttMode: string;
  vocabSpecialization: string;
  denoisingMode: string;
  normalizeForSpeech: boolean;
  startSpeaker: string;
  beginMessage: string;
  beginAfterUserSilenceMs: number;
  endCallAfterSilenceMs: number;
  responsiveness: number;
  interruptionSensitivity: number;
  maxCallDurationMs: number;
  ringDurationMs: number;
  reminderTriggerMs: number;
  reminderMaxCount: number;
  boostedKeywords: string[];
  pronunciationDictionary: unknown[];
  enableDynamicVoiceSpeed: boolean;
  enableDynamicResponsiveness: boolean;
}

export interface RuntimeProviderConfig {
  /**
   * Retell-specific execution data. Present only when provider is "RETELL".
   * `agentJson` is the full Retell agent JSON as produced by exportAgentJson()
   * and can be pushed directly to the Retell API without further transformation.
   */
  retell?: {
    /** The Retell agent ID if this agent has been deployed; null for draft agents. */
    agentId: string | null;
    webhookUrl: string;
    /** Complete Retell-compatible agent JSON ready for the Retell REST API. */
    agentJson: Record<string, unknown>;
  };
  /**
   * OpenAI Realtime specific data. Present only when provider is "OPENAI_NATIVE".
   * `systemPrompt` is the full compiled instruction string ready for
   * session.update({ instructions: systemPrompt }).
   */
  openai?: {
    voice: string;
    reasoningEffort: string;
    systemPrompt: string;
  };
}

// ─── Full definition ──────────────────────────────────────────────────────────

/**
 * Fully self-contained agent runtime definition.
 *
 * This document contains EVERYTHING needed to execute the agent —
 * no additional Builder database access is required.
 */
export interface AgentRuntimeDefinition {
  // ── Versioning ──────────────────────────────────────────────────────────────
  /** Shape version — bump RUNTIME_VERSION when this interface changes. */
  runtimeVersion: string;
  /** Builder application version at export time. */
  builderVersion: string;
  /** ISO 8601 timestamp when this definition was assembled. */
  exportedAt: string;

  // ── Identity ────────────────────────────────────────────────────────────────
  /** Primary key of the agents table row (UUID). */
  agentId: string;
  agentName: string;
  /** Linked Retell agent ID, or null if the agent has never been deployed. */
  retellAgentId: string | null;

  // ── Runtime selector ────────────────────────────────────────────────────────
  /**
   * The deployment mode resolved by the adapter at export time.
   * Consumers use this to choose the correct execution path.
   */
  provider: DeploymentMode;

  // ── Model ───────────────────────────────────────────────────────────────────
  model: RuntimeModelConfig;

  // ── Compiled prompt ─────────────────────────────────────────────────────────
  /**
   * Provider-agnostic flattened text prompt compiled from the Builder graph.
   * This is the OpenAI-Realtime-ready instruction string; Retell consumers
   * should use runtimeConfig.retell.agentJson.conversationFlow instead.
   */
  compiledPrompt: string;

  // ── Conversation graph ───────────────────────────────────────────────────────
  workflow: RuntimeWorkflow;

  // ── Variables ────────────────────────────────────────────────────────────────
  /** Builder variables used for post-call analysis and data extraction. */
  variables: BuilderVariable[];

  // ── Tools ────────────────────────────────────────────────────────────────────
  /**
   * Tool definitions (function calls) configured in the conversation flow.
   * Sourced from rawConversationFlow.tools.
   */
  tools: unknown[];

  // ── Knowledge base ───────────────────────────────────────────────────────────
  knowledgeBase: RuntimeKnowledgeBase;

  // ── Voice configuration ──────────────────────────────────────────────────────
  voiceConfig: RuntimeVoiceConfig;

  // ── Provider-specific execution data ─────────────────────────────────────────
  runtimeConfig: RuntimeProviderConfig;
}

// ─── Summary (lightweight, no workflow payload) ───────────────────────────────

/**
 * Lightweight summary returned by GET /api/runtime/agent/:id.
 * Does not include the full workflow graph, compiled prompt, or provider JSON.
 * Use GET /api/runtime/agent/:id/export for the full definition.
 */
export interface AgentRuntimeSummary {
  runtimeVersion: string;
  builderVersion: string;
  exportedAt: string;
  agentId: string;
  agentName: string;
  retellAgentId: string | null;
  provider: DeploymentMode;
  model: { id: string; temperature: number };
  voiceId: string;
  language: string;
  hasRetellConfig: boolean;
  hasOpenAIConfig: boolean;
  variableCount: number;
  toolCount: number;
  knowledgeBaseIds: string[];
  updatedAt: string;
}

/** Summarise a full definition into a lightweight summary. */
export function summariseDefinition(
  def: AgentRuntimeDefinition,
  updatedAt: string,
): AgentRuntimeSummary {
  return {
    runtimeVersion: def.runtimeVersion,
    builderVersion: def.builderVersion,
    exportedAt: def.exportedAt,
    agentId: def.agentId,
    agentName: def.agentName,
    retellAgentId: def.retellAgentId,
    provider: def.provider,
    model: { id: def.model.id, temperature: def.model.temperature },
    voiceId: def.voiceConfig.voiceId,
    language: def.voiceConfig.language,
    hasRetellConfig: Boolean(def.runtimeConfig.retell),
    hasOpenAIConfig: Boolean(def.runtimeConfig.openai),
    variableCount: def.variables.length,
    toolCount: def.tools.length,
    knowledgeBaseIds: def.knowledgeBase.ids,
    updatedAt,
  };
}
