/**
 * Build a runnable conversation-graph VM for a call.
 *
 * Bridges storage (an `agents` row) and the VM, and is the one place that decides
 * whether a call can be driven by the graph at all. When an agent has no
 * executable flow this returns null. WEBEE Native then fails the call rather than
 * flattening the graph into a single prompt — that fallback is what made agents
 * skip steps.
 *
 * Relative imports only — this module is reachable from vite.config.ts.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { ConversationVm } from "../graph/vm";
import { createOpenAiVmLlm } from "../graph/llm";
import { createTracedVmLlm } from "../graph/traced-llm";
import { createVmHooks } from "../graph/tools";
import { loadFlowFromAgent, mergeRuntimeVariables } from "../graph/load";
import type { ConversationFlow, VariableValue } from "../graph/types";
import { buildLanguageLockInstruction } from "../language-lock.shared";
import { resolveCallVoiceId } from "../call-voice-profile.shared";
import { resolveWebeeClassifierModel, resolveWebeeLlmProvider, resolveWebeeSpeechModel, resolveWebeeStrongClassifierModel } from "../webee-native.shared";

export interface GraphRuntime {
  vm: ConversationVm;
  voiceId: string;
  /** Text model resolved from agent settings, for cost attribution. */
  model: string;
  warnings: string[];
  /**
   * The stored agent behind this call, when there is one. Null for builder test
   * calls that pass an unsaved flow, which have nothing to report against.
   */
  agent: { id: string; name: string | null; workspaceId: string | null } | null;
  /** Agent settings, so callers can read post-call analysis config. */
  settings: Record<string, unknown>;
}

export interface BuildGraphRuntimeOptions {
  apiKey: string;
  logPrefix: string;
  /** Load the flow from storage. */
  agentId?: string | null;
  supabase?: SupabaseClient | null;
  /** Pre-exported flow, used by builder test calls before the agent is saved. */
  flow?: unknown;
  settings?: Record<string, unknown> | null;
  variables?: Record<string, VariableValue>;
  /** Web test calls override inbound `start_speaker: user` so the agent greets first. */
  startSpeaker?: "agent" | "user";
  sendSms?(message: string, variables: Record<string, VariableValue>): Promise<boolean>;
}

function applyStartSpeaker(
  flow: ConversationFlow,
  speaker?: "agent" | "user",
): ConversationFlow {
  if (speaker !== "agent" && speaker !== "user") return flow;
  const startId = String(flow.start_node_id ?? "").trim();
  const nodes = Array.isArray(flow.nodes) ? flow.nodes : [];
  return {
    ...flow,
    start_speaker: speaker,
    nodes: nodes.map((node, index) => {
      const id = String((node as { id?: string }).id ?? "");
      const isStart = (startId && id === startId) || (!startId && index === 0);
      return isStart ? { ...node, start_speaker: speaker } : node;
    }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasNodes(flow: unknown): flow is ConversationFlow {
  return isRecord(flow) && Array.isArray(flow.nodes) && flow.nodes.length > 0;
}

/**
 * Assemble the VM for a call, or null when there is no graph to run.
 */
export async function buildGraphRuntime(
  options: BuildGraphRuntimeOptions,
): Promise<GraphRuntime | null> {
  const { apiKey, logPrefix } = options;
  const warnings: string[] = [];

  const providedFlow: ConversationFlow | null = hasNodes(options.flow) ? options.flow : null;
  let flow: ConversationFlow | null = providedFlow;
  let settings: Record<string, unknown> = isRecord(options.settings) ? options.settings : {};
  let variables: Record<string, VariableValue> = { ...(options.variables ?? {}) };
  let agent: GraphRuntime["agent"] = null;

  let variableNames: string[] = [];

  // The agent row is loaded whenever there is one, even when the caller supplied
  // its own flow: a builder test call wants to run the flow currently on screen
  // but still be reported against the saved agent. Skipping the read there would
  // silently disable transcript persistence and post-call analysis for exactly
  // the calls being used to validate them.
  if (options.agentId && options.supabase) {
    const { data, error } = await options.supabase
      .from("agents")
      .select("flow_data, settings, name, workspace_id")
      .eq("id", options.agentId)
      .maybeSingle();
    if (error) {
      console.warn(`${logPrefix} could not load agent ${options.agentId}: ${error.message}`);
      if (!providedFlow) return null;
    } else if (!data) {
      if (!providedFlow) return null;
    } else {
      agent = {
        id: options.agentId,
        name: (data.name as string | null) ?? null,
        workspaceId: (data.workspace_id as string | null) ?? null,
      };
      const stored = isRecord(data.settings) ? (data.settings as Record<string, unknown>) : {};
      // An explicitly passed settings object wins, so a test call can preview
      // unsaved voice or model changes.
      settings = isRecord(options.settings) ? options.settings : stored;

      if (!providedFlow) {
        const loaded = loadFlowFromAgent(data.flow_data, stored, variables);
        warnings.push(...loaded.warnings);
        variables = loaded.variables;
        variableNames = loaded.variableNames;
        if (!hasNodes(loaded.flow)) {
          for (const w of loaded.warnings) console.warn(`${logPrefix} ${w}`);
          return null;
        }
        flow = loaded.flow;
      } else {
        const flowData = isRecord(data.flow_data) ? data.flow_data : {};
        const fromFlow = Array.isArray(flowData.variables) ? flowData.variables : [];
        const fromSettings = Array.isArray(stored.variables) ? stored.variables : [];
        variableNames = [...fromFlow, ...fromSettings]
          .map((item) => (isRecord(item) ? String(item.name ?? "").trim() : ""))
          .filter(Boolean);
      }
    }
  }

  if (!flow) return null;
  flow = applyStartSpeaker(flow, options.startSpeaker);

  if (!options.agentId && providedFlow) {
    const declared = Array.isArray((options.flow as { variables?: unknown[] })?.variables)
      ? ((options.flow as { variables: unknown[] }).variables ?? [])
      : Array.isArray(settings.variables)
        ? (settings.variables as unknown[])
        : [];
    variables = { ...mergeRuntimeVariables(declared, variables), ...variables };
    variableNames = declared
      .map((item) =>
        typeof item === "object" && item && "name" in item
          ? String((item as { name?: unknown }).name ?? "").trim()
          : "",
      )
      .filter(Boolean);
  }

  const rawCf = isRecord(settings.rawConversationFlow) ? settings.rawConversationFlow : {};
  const tools: Array<Record<string, unknown>> = [
    ...(Array.isArray(flow.tools) ? (flow.tools as Array<Record<string, unknown>>) : []),
  ];
  if (tools.length === 0 && Array.isArray(rawCf.tools)) {
    tools.push(...(rawCf.tools as Array<Record<string, unknown>>));
  }
  if (tools.length > 0 && (!Array.isArray(flow.tools) || flow.tools.length === 0)) {
    flow = { ...flow, tools };
  }

  const variableKeys = Object.keys(variables);
  console.info(
    `${logPrefix} graph variables: ${variableKeys.length ? variableKeys.join(", ") : "(none)"}` +
      (options.startSpeaker ? ` start_speaker=${options.startSpeaker}` : ""),
  );

  const configuredModel = resolveWebeeSpeechModel(settings);
  const classifierModel = resolveWebeeClassifierModel(settings);
  const strongClassifierModel = resolveWebeeStrongClassifierModel(settings);
  const llmProvider = resolveWebeeLlmProvider(settings);
  console.info(`${logPrefix} graph LLM provider=${llmProvider} speech=${configuredModel} classifier=${classifierModel}`);
  let vm!: ConversationVm;
  const llm = createTracedVmLlm(
    createOpenAiVmLlm({
      apiKey,
      provider: llmProvider,
      defaultModel: configuredModel,
      classifierModel,
      temperature:
        typeof flow.model_temperature === "number" ? flow.model_temperature : undefined,
    }),
    () => vm.getTurnTrace(),
  );

  vm = new ConversationVm({
    flow,
    llm,
    variables,
    model: configuredModel,
    classifierModel,
    strongClassifierModel,
    languageLock: buildLanguageLockInstruction(
      Array.isArray(settings.speechLanguages)
        ? (settings.speechLanguages as string[])
        : settings.language
          ? [String(settings.language)]
          : undefined,
      String(settings.language ?? "en-US"),
    ),
    variableNames,
    hooks: createVmHooks({
      tools,
      sendSms: options.sendSms,
      log: (message, meta) => console.warn(`${logPrefix} ${message}`, meta ?? ""),
    }),
  });

  warnings.push(...vm.getWarnings());
  return {
    vm,
    // webeeVoiceId is a Fish Audio model id; voice_id/voiceId are OmniVoice ids
    // like "11labs-Adrian", which Fish would reject. Prefer the native field and
    // let the TTS provider fall back to its own default when it is unset.
    voiceId: resolveCallVoiceId({ settings }),
    model: configuredModel,
    warnings,
    agent,
    settings,
  };
}
