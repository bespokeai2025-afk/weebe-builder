/**
 * Build a runnable conversation-graph VM for a call.
 *
 * Bridges storage (an `agents` row) and the VM, and is the one place that decides
 * whether a call can be driven by the graph at all. When an agent has no
 * executable flow this returns null so the caller can fall back to the flattened
 * single-prompt path rather than dropping the call.
 *
 * Relative imports only — this module is reachable from vite.config.ts.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { ConversationVm } from "../graph/vm";
import { createOpenAiVmLlm } from "../graph/llm";
import { createTracedVmLlm } from "../graph/traced-llm";
import { createVmHooks } from "../graph/tools";
import { loadFlowFromAgent, seedVariablesFromAgent } from "../graph/load";
import type { ConversationFlow, VariableValue } from "../graph/types";
import { buildLanguageLockInstruction } from "../language-lock.shared";
import { resolveWebeeSpeechModel } from "../webee-native.shared";

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
  sendSms?(message: string, variables: Record<string, VariableValue>): Promise<boolean>;
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

      if (providedFlow) {
        variables = { ...seedVariablesFromAgent(data.flow_data, stored), ...variables };
      } else {
        const loaded = loadFlowFromAgent(data.flow_data, stored, variables);
        warnings.push(...loaded.warnings);
        variables = loaded.variables;
        if (!hasNodes(loaded.flow)) {
          for (const w of loaded.warnings) console.warn(`${logPrefix} ${w}`);
          return null;
        }
        flow = loaded.flow;
      }
    }
  }

  if (!flow) return null;

  const configuredModel = resolveWebeeSpeechModel(settings);
  let vm!: ConversationVm;
  const llm = createTracedVmLlm(
    createOpenAiVmLlm({
      apiKey,
      defaultModel: configuredModel,
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
    languageLock: buildLanguageLockInstruction(
      Array.isArray(settings.speechLanguages)
        ? (settings.speechLanguages as string[])
        : settings.language
          ? [String(settings.language)]
          : undefined,
      String(settings.language ?? "en-US"),
    ),
    hooks: createVmHooks({
      tools: Array.isArray(flow.tools) ? (flow.tools as Array<Record<string, unknown>>) : [],
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
    voiceId: String(settings.webeeVoiceId ?? settings.voice_id ?? settings.voiceId ?? "").trim(),
    model: configuredModel,
    warnings,
    agent,
    settings,
  };
}
