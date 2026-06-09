/**
 * Runtime Export Layer
 *
 * Assembles the canonical AgentRuntimeDefinition from Builder-persisted data.
 * This is the only place that reads agent rows and transforms them into the
 * portable runtime format.
 *
 * Builder responsibilities that remain unchanged:
 *   - Agent creation, node editing, variables, prompts, knowledge bases,
 *     qualification logic, Retell deployment, user dashboard.
 *
 * This module is read-only: it never writes to the database.
 * All Retell execution paths are unchanged — this module only reads the same
 * data that Retell already uses and packages it into the canonical format.
 */

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Edge } from "@xyflow/react";
import type { FlowNode } from "@/lib/builder/store";
import type { BuilderSettings, BuilderVariable } from "@/lib/builder/types";
import { exportAgentJson } from "@/lib/builder/export-conversation-flow";
import { compileRealtimePrompt } from "@/lib/builder/compile-realtime-prompt";
import { resolveDeploymentMode } from "./adapter";
import {
  RUNTIME_VERSION,
  BUILDER_VERSION,
  summariseDefinition,
} from "./definition";
import type { AgentRuntimeDefinition, AgentRuntimeSummary } from "./definition";

// ─── Pure assembly function ───────────────────────────────────────────────────

/**
 * Assemble a fully self-contained AgentRuntimeDefinition from the raw Builder
 * data. This is a pure function — no database access, no side effects.
 *
 * This is also the function used by the API route handlers so they share
 * exactly the same assembly logic as the server function.
 */
export function buildAgentRuntimeDefinition(params: {
  agentId: string;
  retellAgentId: string | null;
  agentName: string;
  updatedAt: string;
  nodes: FlowNode[];
  edges: Edge[];
  settings: BuilderSettings;
  variables: BuilderVariable[];
}): AgentRuntimeDefinition {
  const { agentId, retellAgentId, agentName, nodes, edges, settings, variables } = params;

  // ── Provider / mode ──────────────────────────────────────────────────────
  const provider = resolveDeploymentMode(settings);

  // ── Compiled prompt (provider-agnostic) ─────────────────────────────────
  const compiledPrompt = compileRealtimePrompt(nodes, edges, settings, variables).trim();

  // ── Retell-compatible agent JSON ─────────────────────────────────────────
  // exportAgentJson() is the same function used by the deploy path — the
  // runtimeConfig.retell.agentJson is a push-ready Retell agent payload.
  const retellAgentJson = exportAgentJson(nodes, edges, settings, variables) as Record<string, unknown>;

  // ── Tools + knowledge base (sourced from rawConversationFlow) ────────────
  const rawCf = (settings.rawConversationFlow ?? {}) as Record<string, unknown>;
  const tools = Array.isArray(rawCf.tools) ? (rawCf.tools as unknown[]) : [];
  const kbIds = Array.isArray(rawCf.knowledge_base_ids)
    ? (rawCf.knowledge_base_ids as string[])
    : [];
  const kbConfig = (rawCf.kb_config as { top_k?: number; filter_score?: number } | undefined) ?? {};

  // ── Workflow (raw graph) ─────────────────────────────────────────────────
  const startNode = nodes.find((n) => n.data.isStart) ?? nodes[0] ?? null;
  const workflow = {
    nodes: nodes as unknown[],
    edges: edges as unknown[],
    startNodeId: startNode?.id ?? null,
    globalPrompt: settings.globalPrompt ?? "",
    beginMessage: settings.beginMessage ?? "",
    startSpeaker: settings.startSpeaker ?? "agent",
  };

  // ── Voice config ─────────────────────────────────────────────────────────
  const voiceConfig = {
    voiceId: settings.voiceId ?? "",
    language: settings.language ?? "en-US",
    speechLanguages: settings.speechLanguages ?? ["en-US"],
    voiceSpeed: settings.voiceSpeed ?? 1,
    voiceTemperature: settings.voiceTemperature ?? 1,
    volume: settings.volume ?? 1,
    voiceEmotion: settings.voiceEmotion === "none" ? null : (settings.voiceEmotion ?? null),
    enableBackchannel: settings.enableBackchannel ?? false,
    backchannelFrequency: settings.backchannelFrequency ?? 0.8,
    backchannelWords: settings.backchannelWords ?? [],
    ambientSound: settings.ambientSound === "none" ? null : (settings.ambientSound ?? null),
    ambientSoundVolume: settings.ambientSoundVolume ?? 1,
    sttMode: settings.sttMode ?? "fast",
    vocabSpecialization: settings.vocabSpecialization ?? "general",
    denoisingMode:
      settings.denoisingMode ?? "noise-and-background-speech-cancellation",
    normalizeForSpeech: settings.normalizeForSpeech ?? true,
    startSpeaker: settings.startSpeaker ?? "agent",
    beginMessage: settings.beginMessage ?? "",
    beginAfterUserSilenceMs: settings.beginAfterUserSilenceMs ?? 0,
    endCallAfterSilenceMs: settings.endCallAfterSilenceMs ?? 600000,
    responsiveness: settings.responsiveness ?? 1,
    interruptionSensitivity: settings.interruptionSensitivity ?? 0.7,
    maxCallDurationMs: settings.maxCallDurationMs ?? 1800000,
    ringDurationMs: settings.ringDurationMs ?? 30000,
    reminderTriggerMs: settings.reminderTriggerMs ?? 10000,
    reminderMaxCount: settings.reminderMaxCount ?? 1,
    boostedKeywords: settings.boostedKeywords ?? [],
    pronunciationDictionary: settings.pronunciationDictionary ?? [],
    enableDynamicVoiceSpeed: settings.enableDynamicVoiceSpeed ?? false,
    enableDynamicResponsiveness: settings.enableDynamicResponsiveness ?? false,
  };

  // ── Runtime config (provider-specific execution data) ────────────────────
  const runtimeConfig: AgentRuntimeDefinition["runtimeConfig"] = {};

  if (provider === "RETELL") {
    runtimeConfig.retell = {
      agentId: retellAgentId,
      webhookUrl: settings.webhookUrl ?? "",
      agentJson: retellAgentJson,
    };
  }

  if (provider === "OPENAI_NATIVE") {
    runtimeConfig.openai = {
      voice: settings.openaiVoice ?? "alloy",
      reasoningEffort: settings.openaiReasoningEffort ?? "low",
      systemPrompt: compiledPrompt,
    };
    // Also attach the Retell-format JSON as a reference for migration tooling.
    runtimeConfig.retell = {
      agentId: retellAgentId,
      webhookUrl: settings.webhookUrl ?? "",
      agentJson: retellAgentJson,
    };
  }

  // For future providers (CLAUDE_NATIVE, GEMINI_NATIVE), attach the compiled
  // prompt and Retell JSON so migration tooling has a starting point.
  if (provider === "CLAUDE_NATIVE" || provider === "GEMINI_NATIVE") {
    runtimeConfig.retell = {
      agentId: retellAgentId,
      webhookUrl: settings.webhookUrl ?? "",
      agentJson: retellAgentJson,
    };
  }

  return {
    runtimeVersion: RUNTIME_VERSION,
    builderVersion: BUILDER_VERSION,
    exportedAt: new Date().toISOString(),
    agentId,
    agentName,
    retellAgentId,
    provider,
    model: {
      id: settings.model ?? "gpt-4.1",
      temperature: settings.temperature ?? 0.3,
      openaiVoice: settings.openaiVoice,
      openaiReasoningEffort: settings.openaiReasoningEffort,
    },
    compiledPrompt,
    workflow,
    variables,
    tools,
    knowledgeBase: {
      ids: kbIds,
      config: {
        topK: kbConfig.top_k ?? 3,
        filterScore: kbConfig.filter_score ?? 0.6,
      },
    },
    voiceConfig,
    runtimeConfig,
  };
}

// ─── Row → params helper ──────────────────────────────────────────────────────

/**
 * Unpack a raw agent database row into the typed params required by
 * buildAgentRuntimeDefinition. Shared between the server function and the
 * API route handlers so the parsing logic is not duplicated.
 */
export function unpackAgentRow(row: {
  id: string;
  retell_agent_id: string | null;
  name: string;
  flow_data: unknown;
  settings: unknown;
  variables: unknown;
  updated_at: string;
}): Parameters<typeof buildAgentRuntimeDefinition>[0] {
  const flowData = (row.flow_data ?? {}) as Record<string, unknown>;
  const settings = (row.settings ?? {}) as BuilderSettings;
  const variables = (
    Array.isArray(row.variables)
      ? row.variables
      : Array.isArray((settings as Record<string, unknown>).variables)
        ? (settings as Record<string, unknown>).variables
        : Array.isArray(flowData.variables)
          ? flowData.variables
          : []
  ) as BuilderVariable[];

  return {
    agentId: row.id,
    retellAgentId: row.retell_agent_id,
    agentName: row.name,
    updatedAt: row.updated_at,
    nodes: ((flowData.nodes ?? []) as FlowNode[]),
    edges: ((flowData.edges ?? []) as Edge[]),
    settings,
    variables,
  };
}

// ─── Server function (for Builder-internal use) ───────────────────────────────

/**
 * Server function that loads an agent by ID and returns its full runtime
 * definition. Requires Supabase auth — only the owning user can export.
 *
 * Intended for Builder-internal use (e.g. from a UI "Export" button).
 * The API route handlers at /api/runtime/agent/:id/export perform the same
 * work using the same helpers but with inline auth (route handler context).
 */
export const exportAgentRuntimeDefinition = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const { data: row, error } = await supabase
      .from("agents")
      .select("id, retell_agent_id, name, flow_data, settings, variables, updated_at")
      .eq("id", data.id)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!row) throw new Error("Agent not found");

    const params = unpackAgentRow(row as Parameters<typeof unpackAgentRow>[0]);
    return buildAgentRuntimeDefinition(params);
  });

/**
 * Server function that returns a lightweight summary of an agent's runtime
 * definition (no workflow graph or compiled prompt). Useful for listing
 * metadata without the full payload.
 */
export const getAgentRuntimeSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ context, data }): Promise<AgentRuntimeSummary> => {
    const { supabase } = context;
    const { data: row, error } = await supabase
      .from("agents")
      .select("id, retell_agent_id, name, flow_data, settings, variables, updated_at")
      .eq("id", data.id)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!row) throw new Error("Agent not found");

    const typedRow = row as Parameters<typeof unpackAgentRow>[0];
    const params = unpackAgentRow(typedRow);
    const definition = buildAgentRuntimeDefinition(params);
    return summariseDefinition(definition, typedRow.updated_at);
  });
