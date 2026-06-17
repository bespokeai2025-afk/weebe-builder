import type { Edge } from "@xyflow/react";
import type { FlowNode } from "./store";
import type { BuilderSettings, BuilderVariable, FlowNodeData } from "./types";

/**
 * Map our builder graph to a full agent JSON with a nested
 * `conversationFlow` block.
 *
 * Round-trip strategy: when the flow was imported from dashboard JSON we
 * captured `rawAgent`, `rawConversationFlow`, and per-node `raw`. On export
 * we START from those raw objects and only OVERLAY the fields the builder
 * actually owns (ids, names, positions, edges, the few settings exposed in
 * the UI). Unknown / unmanaged dashboard fields (tools, kb_config, pii_config,
 * voicemail_option, stt_mode, denoising_mode, user_dtmf_options,
 * global_node_setting, finetune_*_examples, etc.) pass through verbatim.
 *
 * When there is no raw (fresh-built flow) we fall back to sane defaults.
 */
export function exportAgentJson(
  nodes: FlowNode[],
  edges: Edge[],
  settings: BuilderSettings,
  variables: BuilderVariable[] = [],
) {
  const cfId =
    settings.conversationFlowId || `conversation_flow_${Math.random().toString(16).slice(2, 14)}`;

  const exportableNodes = nodes.filter(isExportableNode);
  const exportNodeIds = new Set(exportableNodes.map((n) => n.id));

  const startNode =
    exportableNodes.find((n) => n.data.isStart) ??
    exportableNodes.find((n) => n.data.kind === "conversation") ??
    exportableNodes[0];

  const edgesFromNode = (nodeId: string) => {
    const node = nodes.find((n) => n.id === nodeId);
    const graphEdges = edges.filter((e) => e.source === nodeId && exportNodeIds.has(e.target));
    const transitionEdges = (node?.data.transitions ?? [])
      .filter((t) => !t.target || exportNodeIds.has(t.target))
      .map((t, i) => {
        const graphEdge =
          graphEdges.find((e) => e.sourceHandle === t.id) ??
          graphEdges.find((e) => t.target && e.target === t.target);
        return {
          ...(t.target ? { destination_node_id: t.target } : {}),
          id: graphEdge?.id || t.id || `edge-${nodeId}-${i}`,
          transition_condition: {
            type: "prompt" as const,
            prompt:
              t.condition ||
              (t.target
                ? `Continue to ${labelOf(nodes, t.target)}`
                : "Describe the transition condition"),
          },
        };
      });
    const transitionIds = new Set((node?.data.transitions ?? []).map((t) => t.id));
    const extraGraphEdges = graphEdges
      .filter((e) => !transitionIds.has(String(e.sourceHandle ?? "")))
      .map((e, i) => {
        return {
          destination_node_id: e.target,
          id: e.id || `edge-${nodeId}-${i}`,
          transition_condition: {
            type: "prompt" as const,
            prompt: `Continue to ${labelOf(nodes, e.target)}`,
          },
        };
      });
    return [...transitionEdges, ...extraGraphEdges];
  };

  const flowNodes = exportableNodes.map((n) => mapNode(n, edgesFromNode(n.id)));

  const rawCf = (settings.rawConversationFlow ?? {}) as Record<string, unknown>;
  const hasRawCf = Object.keys(rawCf).length > 0;

  // Defaults only apply for fresh-built flows; if we have rawCf we trust it.
  // Keep this list strictly aligned with the dashboard conversation-flow schema.
  const cfDefaults: Record<string, unknown> = hasRawCf
    ? {}
    : {
        tools: [],
        knowledge_base_ids: [],
        kb_config: { top_k: 3, filter_score: 0.6 },
        model_temperature: 0,
        tool_call_strict_mode: true,
        is_transfer_cf: false,
      };

  // Merge builder-managed KB IDs with any that came from the raw imported flow.
  const rawKbIds = Array.isArray(rawCf.knowledge_base_ids) ? rawCf.knowledge_base_ids as string[] : [];
  const builderKbIds = settings.knowledgeBaseIds ?? [];
  const mergedKbIds = Array.from(new Set([...rawKbIds, ...builderKbIds]));

  // KB config — prefer builder settings, fall back to raw.
  const rawKbConfig = (rawCf.kb_config as { top_k?: number; filter_score?: number } | undefined) ?? {};
  const mergedKbConfig = {
    top_k: settings.kbConfig?.topK ?? rawKbConfig.top_k ?? 3,
    filter_score: settings.kbConfig?.filterScore ?? rawKbConfig.filter_score ?? 0.6,
  };

  const conversationFlow: Record<string, unknown> = {
    ...cfDefaults,
    ...rawCf,
    // Override KB fields with merged builder-managed values when present.
    ...(mergedKbIds.length > 0 ? { knowledge_base_ids: mergedKbIds } : {}),
    ...(mergedKbIds.length > 0 ? { kb_config: mergedKbConfig } : {}),
    conversation_flow_id: cfId,
    version: (rawCf.version as number) ?? 0,
    global_prompt: settings.globalPrompt,
    nodes: flowNodes,
    start_node_id: startNode?.id ?? flowNodes[0]?.id ?? "",
    start_speaker: settings.startSpeaker ?? rawCf.start_speaker ?? "agent",
    model_choice: buildModelChoice(
      settings.model,
      (rawCf.model_choice as Record<string, unknown>) ?? {},
    ),
    begin_tag_display_position: rawCf.begin_tag_display_position ?? {
      x: (startNode?.position.x ?? 0) - 220,
      y: startNode?.position.y ?? 0,
    },
    is_published: rawCf.is_published ?? false,
  };
  delete conversationFlow.__key_order;

  // Only emit flex_mode if user set it or raw had it.
  if (rawCf.flex_mode !== undefined) {
    conversationFlow.flex_mode =
      settings.transitionFlexibility != null
        ? settings.transitionFlexibility === "flex"
        : rawCf.flex_mode;
  }

  if ((settings.beginAfterUserSilenceMs ?? 0) > 0) {
    conversationFlow.begin_after_user_silence_ms = settings.beginAfterUserSilenceMs;
  }
  const orderedConversationFlow = orderLikeRaw(
    conversationFlow,
    rawCf.__key_order as string[] | undefined,
  );

  const rawAgent = (settings.rawAgent ?? {}) as Record<string, unknown>;
  const hasRawAgent = Object.keys(rawAgent).length > 0;

  const agentDefaults: Record<string, unknown> = hasRawAgent
    ? {}
    : {
        channel: "voice",
        data_storage_setting: "everything",
        opt_in_signed_url: false,
        assigned_tags: [],
        post_call_analysis_model: "gpt-4.1-mini",
        pii_config: { mode: "post_call", categories: [] },
        post_call_analysis_data: [],
        ambient_sound: null,
        allow_user_dtmf: false,
        user_dtmf_options: {},
        denoising_mode: "noise-and-background-speech-cancellation",
      };

  const agent: Record<string, unknown> = {
    ...agentDefaults,
    ...rawAgent,
    agent_id: settings.agentId || (rawAgent.agent_id as string) || "",
    last_modification_timestamp:
      (rawAgent.last_modification_timestamp as number | undefined) ?? Date.now(),
    agent_name: settings.agentName,
    response_engine: {
      type: "conversation-flow",
      version:
        ((rawAgent.response_engine as Record<string, unknown> | undefined)?.version as
          | number
          | undefined) ??
        (rawCf.version as number) ??
        0,
      conversation_flow_id: cfId,
    },
    language: (() => {
      const sl = settings.speechLanguages;
      if (!sl || sl.length === 0) return settings.language;
      if (sl[0] === "multi") return "multi";
      if (sl.length === 1) return sl[0];
      return sl; // array → multilingual
    })(),
    version: (rawAgent.version as number) ?? 0,
    is_published: rawAgent.is_published ?? false,
    voice_id: settings.voiceId,
    voice_temperature: settings.voiceTemperature ?? rawAgent.voice_temperature ?? 1,
    voice_speed: settings.voiceSpeed ?? rawAgent.voice_speed ?? 1,
    volume: settings.volume ?? rawAgent.volume ?? 1,
    responsiveness: settings.responsiveness ?? rawAgent.responsiveness ?? 1,
    max_call_duration_ms: settings.maxCallDurationMs ?? rawAgent.max_call_duration_ms ?? 1800000,
    interruption_sensitivity:
      settings.interruptionSensitivity ?? rawAgent.interruption_sensitivity ?? 0.7,
    normalize_for_speech: settings.normalizeForSpeech ?? rawAgent.normalize_for_speech ?? true,
    post_call_analysis_data: buildPostCallAnalysisData(rawAgent.post_call_analysis_data, variables),
    conversationFlow: orderedConversationFlow,
  };
  delete agent.__key_order;

  // Set voice_model for ElevenLabs voices. Retell uses this to select the
  // ElevenLabs model tier (e.g. eleven_turbo_v2, eleven_flash_v2_5). We
  // preserve whatever rawAgent had; for fresh agents we default to turbo v2.
  if (settings.voiceId?.startsWith("11labs-")) {
    agent.voice_model = rawAgent.voice_model ?? "eleven_turbo_v2";
  }

  agent.voice_emotion =
    settings.voiceEmotion === "none"
      ? null
      : (settings.voiceEmotion ?? rawAgent.voice_emotion ?? null);
  agent.enable_backchannel = settings.enableBackchannel ?? rawAgent.enable_backchannel ?? false;
  agent.backchannel_frequency =
    settings.backchannelFrequency ?? rawAgent.backchannel_frequency ?? 0.8;
  agent.backchannel_words = settings.backchannelWords?.length
    ? settings.backchannelWords
    : (rawAgent.backchannel_words ?? null);
  agent.reminder_trigger_ms = settings.reminderTriggerMs ?? rawAgent.reminder_trigger_ms ?? 10000;
  agent.reminder_max_count = settings.reminderMaxCount ?? rawAgent.reminder_max_count ?? 1;
  agent.ambient_sound =
    settings.ambientSound === "none"
      ? null
      : (settings.ambientSound ?? rawAgent.ambient_sound ?? null);
  agent.ambient_sound_volume = settings.ambientSoundVolume ?? rawAgent.ambient_sound_volume ?? 1;
  agent.boosted_keywords = settings.boostedKeywords?.length
    ? settings.boostedKeywords
    : (rawAgent.boosted_keywords ?? null);
  agent.pronunciation_dictionary = settings.pronunciationDictionary?.length
    ? settings.pronunciationDictionary
    : (rawAgent.pronunciation_dictionary ?? null);
  agent.end_call_after_silence_ms =
    settings.endCallAfterSilenceMs ?? rawAgent.end_call_after_silence_ms ?? 600000;
  agent.begin_message_delay_ms =
    settings.beginMessageDelayMs ?? rawAgent.begin_message_delay_ms ?? 0;
  agent.stt_mode = settings.sttMode ?? rawAgent.stt_mode ?? "fast";
  agent.vocab_specialization =
    settings.vocabSpecialization ?? rawAgent.vocab_specialization ?? "general";
  agent.allow_user_dtmf = settings.allowUserDtmf ?? rawAgent.allow_user_dtmf ?? false;
  agent.allow_dtmf_interruption =
    settings.allowDtmfInterruption ?? rawAgent.allow_dtmf_interruption ?? false;
  agent.denoising_mode =
    settings.denoisingMode ?? rawAgent.denoising_mode ?? "noise-and-background-speech-cancellation";

  if (
    rawAgent.enable_dynamic_voice_speed !== undefined ||
    (!hasRawAgent && settings.enableDynamicVoiceSpeed !== undefined)
  ) {
    agent.enable_dynamic_voice_speed =
      settings.enableDynamicVoiceSpeed ?? rawAgent.enable_dynamic_voice_speed;
  }
  if (
    rawAgent.enable_dynamic_responsiveness !== undefined ||
    (!hasRawAgent && settings.enableDynamicResponsiveness !== undefined)
  ) {
    agent.enable_dynamic_responsiveness =
      settings.enableDynamicResponsiveness ?? rawAgent.enable_dynamic_responsiveness;
  }
  if (
    rawAgent.ring_duration_ms !== undefined ||
    (!hasRawAgent && settings.ringDurationMs !== undefined)
  ) {
    agent.ring_duration_ms = settings.ringDurationMs ?? rawAgent.ring_duration_ms;
  }

  // handbook_config is only emitted if raw already had it.
  if (rawAgent.handbook_config) {
    agent.handbook_config = {
      ...(rawAgent.handbook_config as Record<string, unknown>),
      echo_verification: settings.handbookEchoVerification,
      speech_normalization: settings.handbookSpeechNormalization,
      default_personality: settings.handbookDefaultPersonality,
      scope_boundaries: settings.handbookScopeBoundaries,
      natural_filler_words: settings.handbookNaturalFillerWords,
      nato_phonetic_alphabet: settings.handbookNatoPhoneticAlphabet,
      high_empathy: settings.handbookHighEmpathy,
      ai_disclosure: settings.handbookAiDisclosure,
      smart_matching: settings.handbookSmartMatching,
    };
  }

  if (settings.webhookUrl) agent.webhook_url = settings.webhookUrl;

  return orderLikeRaw(agent, rawAgent.__key_order as string[] | undefined);
}

/**
 * Translate our internal model ID convention into Retell's model_choice shape.
 *
 * In our UI we use a "-fast" suffix to represent Retell's Fast Tier
 * (e.g. "gpt-4.1-fast"). Retell's API does NOT use that suffix — instead it
 * uses the same base model ID with high_priority: true in model_choice.
 * This helper strips the suffix and sets the flag accordingly.
 */
function buildModelChoice(
  modelId: string | undefined,
  rawModelChoice: Record<string, unknown>,
): Record<string, unknown> {
  const isFast = (modelId ?? "").endsWith("-fast");
  const baseModel = isFast ? (modelId ?? "").slice(0, -5) : modelId;
  const highPriority = isFast ? true : (rawModelChoice.high_priority ?? false);
  return {
    type: "cascading",
    ...rawModelChoice,
    model: baseModel,
    high_priority: highPriority,
  };
}

function orderLikeRaw<T extends Record<string, unknown>>(obj: T, keyOrder?: string[]): T {
  if (!keyOrder?.length) return obj;
  const ordered: Record<string, unknown> = {};
  keyOrder.forEach((key) => {
    if (key !== "__key_order" && key in obj) ordered[key] = obj[key];
  });
  Object.entries(obj).forEach(([key, value]) => {
    if (key !== "__key_order" && !(key in ordered)) ordered[key] = value;
  });
  return ordered as T;
}

function buildPostCallAnalysisData(raw: unknown, variables: BuilderVariable[]) {
  if (!variables.length) return Array.isArray(raw) ? raw : [];
  const ALLOWED = new Set(["string", "number", "boolean", "enum", "system-presets"]);
  return variables
    .filter((v) => v.name.trim() && v.description.trim())
    .map((v) => {
      let t = ALLOWED.has(v.type ?? "string") ? (v.type ?? "string") : "string";
      const examples = v.examples?.length ? v.examples : v.defaultValue ? [v.defaultValue] : [];
      const item: Record<string, unknown> = {
        type: t,
        name: v.name.trim(),
        description: v.description,
      };
      if (t === "enum") {
        // Retell's enum variant requires a `choices` array. Fall back to string if none.
        if (examples.length) item.choices = examples;
        else {
          t = "string";
          item.type = "string";
        }
      } else if (t !== "system-presets" && examples.length) {
        item.examples = examples;
      }
      return item;
    });
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  Object.keys(obj).forEach((key) => {
    if (obj[key] === undefined) delete obj[key];
  });
  return obj;
}

/**
 * Normalize a transfer destination to strict E.164 format (e.g. +447412345678).
 *
 * Rules:
 * - Strip spaces and common formatting characters: ( ) - . and unicode dashes
 * - Convert international prefix "00" → "+"
 * - Convert UK national format (leading "0", 10–11 digits) → "+44…"
 * - Already-prefixed "+<digits>" passes through if 8–16 digits
 * - Anything else with a leading digit and 8–15 total digits gets a "+" prepended
 *
 * Returns an empty string for empty input. Returns the original (formatting
 * stripped) string when it cannot be coerced into E.164 — callers must
 * validate with `isE164` before sending to Retell.
 */
export function normalizeTransferNumber(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (/^sip:/i.test(raw)) return raw;
  // Strip whitespace, parens, dashes (incl. unicode), dots
  let s = raw.replace(/[\s().\u2010-\u2015\-]/g, "");
  if (!s) return "";
  // Treat a lone "+" (or "+" with too few digits to be meaningful) as empty
  // so isExportableNode filters the node out instead of blowing up the export.
  if (s === "+") return "";
  if (s.startsWith("+")) return s;
  if (s.startsWith("00")) return "+" + s.slice(2);
  // UK national format: 0 + 10 digits = 11 chars total
  if (/^0\d{9,10}$/.test(s)) return "+44" + s.slice(1);
  // Bare digits — prepend +
  if (/^\d{8,15}$/.test(s)) return "+" + s;
  return s;
}

export function isE164(value: string): boolean {
  return /^\+\d{8,15}$/.test(value);
}

function normalizeTransferType(value: unknown) {
  if (value === "warm_handoff") return "agentic_warm_transfer";
  if (value === "warm_transfer" || value === "agentic_warm_transfer" || value === "cold_transfer") {
    return value;
  }
  return "cold_transfer";
}

function coerceTransferRingMs(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const raw = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(raw))
    throw new Error(`Call Transfer "${label}" has an invalid ring duration.`);
  const ms = raw <= 120 ? Math.round(raw * 1000) : Math.round(raw);
  if (ms < 5000 || ms > 90000) {
    throw new Error(`Call Transfer "${label}" ring duration must be between 5 and 90 seconds.`);
  }
  return ms;
}

function buildHandoffOption(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const option = value as Record<string, unknown>;
    if (option.type === "prompt" || option.type === "static_message") return option;
    if (typeof option.prompt === "string" && option.prompt.trim()) {
      return { ...option, type: "prompt", prompt: option.prompt.trim() };
    }
    if (typeof option.message === "string" && option.message.trim()) {
      return { ...option, type: "static_message", message: option.message.trim() };
    }
  }
  const prompt = String(value ?? "").trim();
  return prompt ? { type: "prompt", prompt } : undefined;
}

function transferFailedEdge(edges: FlowEdge[], nodeId: string): FlowEdge {
  const uniqueSuffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    ...(edges[0] ?? {}),
    id: edges[0]?.id || `transfer-failed-${nodeId}-${uniqueSuffix}`,
    transition_condition: { type: "prompt", prompt: "Transfer failed" },
  };
}

function cleanSipHeaders(value: unknown, label: string): Record<string, string> {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    const k = key.trim();
    const v = String(val ?? "").trim();
    if (!k || !v) continue;
    if (!/^x-/i.test(k) && !/^user-to-user$/i.test(k)) {
      throw new Error(
        `Call Transfer "${label}" has invalid SIP header "${k}". Header names must start with X- or be User-To-User.`,
      );
    }
    out[k] = v;
  }
  return out;
}

function validateTransferExtension(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const extension = String(value).trim();
  if (/^\{\{[a-zA-Z_][a-zA-Z0-9_]*\}\}$/.test(extension) || /^[0-9*#]+$/.test(extension)) {
    return extension;
  }
  throw new Error(
    `Call Transfer "${label}" has an invalid extension. Use digits, * or #, for example 123#.`,
  );
}

function isExportableNode(node: FlowNode) {
  if (node.data.kind === "note") return false;
  // call_transfer nodes always export — static mode falls back to a
  // documented example number when empty (see mapNode), and dynamic mode
  // is validated at export time.
  return true;
}

function labelOf(nodes: FlowNode[], id: string) {
  return nodes.find((n) => n.id === id)?.data.label ?? id;
}

type FlowEdge = {
  destination_node_id?: string;
  id: string;
  transition_condition: { type: "prompt"; prompt: string };
};

const NODE_OVERRIDE_KEYS = new Set([
  "voice_speed",
  "responsiveness",
  "interruption_sensitivity",
  "allow_dtmf_interruption",
]);

function splitNodeSettings(settings: Record<string, unknown>) {
  const nodeOverrides: Record<string, unknown> = {};
  const globalNodeSetting: Record<string, unknown> = {};
  let model: unknown;

  for (const [key, value] of Object.entries(settings)) {
    if (value === undefined || value === null || value === "") continue;
    if (key === "conditions") continue;
    if (key === "model") {
      model = value;
      continue;
    }
    if (NODE_OVERRIDE_KEYS.has(key)) nodeOverrides[key] = value;
    else globalNodeSetting[key] = value;
  }

  return { nodeOverrides, globalNodeSetting, model };
}

function mapNode(n: FlowNode, edges: FlowEdge[]): Record<string, unknown> & { id: string } {
  const d = n.data as FlowNodeData;
  const raw = (d.raw ?? {}) as Record<string, unknown>;
  const hasRaw = Object.keys(raw).length > 0;

  // Spread raw FIRST so dashboard-only per-node fields (global_node_setting,
  // finetune_conversation_examples, finetune_transition_examples,
  // custom_sip_headers, ignore_e164_validation, transfer_option, tool_type,
  // skip_response_edge, etc.) survive verbatim. Then overlay managed fields.
  const base: Record<string, unknown> & { id: string } = {
    ...raw,
    id: n.id,
    name: d.label,
    display_position: { x: n.position.x, y: n.position.y },
  };

  // Always re-emit edges from the live graph.
  delete (base as Record<string, unknown>).edges;
  delete (base as Record<string, unknown>).edge;
  delete (base as Record<string, unknown>).else_edge;
  if (!hasRaw) {
    delete (base as Record<string, unknown>).is_global;
    NODE_OVERRIDE_KEYS.forEach((key) => delete base[key]);
    delete base.model_choice;
  }

  const rawNodeSettings: Record<string, unknown> = {
    ...((raw.global_node_setting as Record<string, unknown>) ?? {}),
  };
  NODE_OVERRIDE_KEYS.forEach((key) => {
    if (raw[key] !== undefined) rawNodeSettings[key] = raw[key];
  });
  if ((raw.model_choice as Record<string, unknown> | undefined)?.model !== undefined) {
    rawNodeSettings.model = (raw.model_choice as Record<string, unknown>).model;
  }
  const gnsRaw = splitNodeSettings(rawNodeSettings);
  const gnsUser = splitNodeSettings(d.globalNodeSetting ?? {});
  const nodeOverrides = { ...gnsRaw.nodeOverrides, ...gnsUser.nodeOverrides };
  const globalNodeSetting = { ...gnsRaw.globalNodeSetting, ...gnsUser.globalNodeSetting };
  Object.assign(base, hasRaw ? gnsUser.nodeOverrides : nodeOverrides);
  if (gnsUser.model || (!hasRaw && gnsRaw.model)) {
    base.model_choice = buildModelChoice(
      (gnsUser.model ?? (!hasRaw ? gnsRaw.model : undefined)) as string | undefined,
      (raw.model_choice as Record<string, unknown>) ?? {},
    );
  }
  if (
    d.isGlobalNode &&
    typeof globalNodeSetting.condition === "string" &&
    globalNodeSetting.condition.trim()
  ) {
    base.global_node_setting = globalNodeSetting;
  } else if (!d.isGlobalNode) {
    delete base.global_node_setting;
  }
  const orderNode = <T extends Record<string, unknown>>(obj: T): T =>
    orderLikeRaw(obj, Object.keys(raw));

  switch (d.kind) {
    case "conversation": {
      const rawInstr = raw.instruction as { type?: string; text?: string } | undefined;
      const instruction = {
        type: d.instructionType ?? rawInstr?.type ?? "prompt",
        text: d.dialogue ?? rawInstr?.text ?? "",
      };
      return orderNode({
        ...base,
        type: "conversation",
        ...(d.isStart && d.startSpeaker ? { start_speaker: d.startSpeaker } : {}),
        instruction,
        edges,
      });
    }

    case "function":
      return orderNode({
        ...base,
        type: "function",
        tool_id: d.toolId ?? (raw.tool_id as string) ?? `tool-${n.id}`,
        tool_type: (raw.tool_type as string) ?? "local",
        speak_during_execution:
          d.speakDuringExecution ?? (raw.speak_during_execution as boolean) ?? false,
        wait_for_result: d.waitForResult ?? (raw.wait_for_result as boolean) ?? true,
        edges,
        ...(raw.else_edge !== undefined ? { else_edge: raw.else_edge } : {}),
      });
    case "call_transfer": {
      const rawDest = (raw.transfer_destination as Record<string, unknown> | undefined) ?? {};
      const rawOpt = (raw.transfer_option as Record<string, unknown> | undefined) ?? {};
      const isDynamic =
        (d.transferMode ??
          (rawDest.type === "dynamic_variable" || rawDest.type === "inferred"
            ? "dynamic"
            : "static")) === "dynamic";

      const ignoreE164 = d.ignoreE164Validation ?? (raw.ignore_e164_validation as boolean) ?? false;

      let transfer_destination: Record<string, unknown>;
      if (isDynamic) {
        const v = String(
          d.transferDynamicVariable ?? rawDest.prompt ?? rawDest.variable_name ?? "",
        ).trim();
        if (!v) {
          throw new Error(`Call Transfer "${d.label}" is set to dynamic but has no variable name.`);
        }
        transfer_destination = { type: "inferred", prompt: v };
      } else {
        const DEFAULT_TRANSFER_NUMBER = "+14155551234";
        let num = normalizeTransferNumber(
          d.transferNumber ??
            (rawDest as { number?: string }).number ??
            (rawDest as { mobile_number?: string }).mobile_number ??
            (raw.mobile_number as string | undefined) ??
            "",
        );
        if (!num) {
          // Fallback to a documented example E.164 number so deployment
          // succeeds even if the user forgot to fill it in. They can edit
          // it later in Retell or our UI.
          num = DEFAULT_TRANSFER_NUMBER;
        }
        if (!ignoreE164 && !isE164(num)) {
          throw new Error(
            `Call Transfer "${d.label}" has an invalid phone number "${num}". ` +
              `Use E.164 format like +447412345678. ` +
              `For UK numbers, "07412345678" is auto-converted to "+447412345678".`,
          );
        }
        transfer_destination = stripUndefined({
          type: "predefined",
          number: num,
          extension: validateTransferExtension(
            d.transferExtensionNumber !== undefined
              ? d.transferExtensionNumber
              : (rawDest.extension as string | undefined),
            d.label,
          ),
        });
      }

      const transferType = normalizeTransferType(d.transferType ?? rawOpt.type);
      const showTransfereeAsCaller =
        d.callerIdMode === "user" ||
        d.showTransfereeAsCaller === true ||
        rawOpt.show_transferee_as_caller === true;
      // Only emit ring duration when user explicitly set it or raw had it.
      const ringWasSet =
        d.transferRingDurationSec !== undefined ||
        rawOpt.transfer_ring_duration_ms !== undefined ||
        raw.ring_duration_ms !== undefined;
      const transferRingMs = ringWasSet
        ? coerceTransferRingMs(
            d.transferRingDurationSec ?? rawOpt.transfer_ring_duration_ms ?? raw.ring_duration_ms,
            d.label,
          )
        : undefined;
      const transfer_option: Record<string, unknown> =
        transferType === "cold_transfer"
          ? {
              type: "cold_transfer",
              show_transferee_as_caller: showTransfereeAsCaller,
              ...(transferRingMs ? { transfer_ring_duration_ms: transferRingMs } : {}),
              ...(d.sipTransferMethod || rawOpt.cold_transfer_mode
                ? {
                    cold_transfer_mode:
                      d.sipTransferMethod ?? (rawOpt.cold_transfer_mode as string),
                  }
                : {}),
            }
          : {
              ...rawOpt,
              type: transferType,
              show_transferee_as_caller: showTransfereeAsCaller,
              ...(transferRingMs ? { transfer_ring_duration_ms: transferRingMs } : {}),
            };
      if (transferType === "warm_transfer") {
        transfer_option.agent_detection_timeout_ms =
          rawOpt.agent_detection_timeout_ms ?? transferRingMs ?? 30000;
        transfer_option.on_hold_music = rawOpt.on_hold_music ?? "ringtone";
        transfer_option.opt_out_human_detection =
          d.optOutHumanDetection ?? (rawOpt.opt_out_human_detection as boolean) ?? false;
        transfer_option.enable_bridge_audio_cue = rawOpt.enable_bridge_audio_cue ?? true;
        const publicHandoff = buildHandoffOption(d.warmHandoffPrompt) ??
          buildHandoffOption(rawOpt.public_handoff_option) ?? {
            type: "prompt",
            prompt: "Transferring you to a human agent now.",
          };
        transfer_option.public_handoff_option = publicHandoff;
        const privateHandoff =
          buildHandoffOption(d.privateHandoffPrompt) ??
          buildHandoffOption(rawOpt.private_handoff_option);
        if (privateHandoff) transfer_option.private_handoff_option = privateHandoff;
        const ivrOption = buildHandoffOption(d.ivrPrompt) ?? buildHandoffOption(rawOpt.ivr_option);
        if (ivrOption) transfer_option.ivr_option = ivrOption;
      }
      if (transferType === "agentic_warm_transfer") {
        const rawConfig =
          (rawOpt.agentic_transfer_config as Record<string, unknown> | undefined) ?? {};
        const rawAgent = (rawConfig.transfer_agent as Record<string, unknown> | undefined) ?? {};
        const agentId = String(d.transferAgentId ?? rawAgent.agent_id ?? "").trim();
        if (!agentId) {
          throw new Error(
            `Call Transfer "${d.label}" uses Agentic Warm Transfer but has no transfer agent ID.`,
          );
        }
        transfer_option.on_hold_music = rawOpt.on_hold_music ?? "ringtone";
        transfer_option.public_handoff_option = buildHandoffOption(d.warmHandoffPrompt) ??
          buildHandoffOption(rawOpt.public_handoff_option) ?? {
            type: "prompt",
            prompt: "Transferring you to another agent now.",
          };
        transfer_option.agentic_transfer_config = {
          ...rawConfig,
          transfer_agent: {
            ...rawAgent,
            agent_id: agentId,
            agent_version: d.transferAgentVersion ?? rawAgent.agent_version ?? "latest",
          },
          transfer_timeout_ms:
            (d.transferTimeoutSec ? d.transferTimeoutSec * 1000 : undefined) ??
            rawConfig.transfer_timeout_ms ??
            30000,
          action_on_timeout:
            d.transferTimeoutAction ?? rawConfig.action_on_timeout ?? "cancel_transfer",
        };
      }

      // Retell's conversation-flow schema requires `type: "transfer_call"`.
      // We deliberately IGNORE any preserved `raw.type` here (which could be
      // "call_transfer" from an older import or legacy dashboard export) so
      // the deployed flow always matches the current Retell schema.
      delete base.sip_transfer_method;
      delete base.display_caller_id;
      delete base.ring_duration_ms;
      delete base.extension_dial_string;
      const cleanedSipHeaders = cleanSipHeaders(
        d.customSipHeaders ?? raw.custom_sip_headers,
        d.label,
      );
      // Retell's TransferCallNode schema REQUIRES `edge` (the transfer-failed
      // fallback edge). Always emit one — fall back to a stub edge with no
      // destination_node_id when the builder has no outgoing edge.
      return orderNode(
        stripUndefined({
          ...base,
          type: "transfer_call",
          // Only emit custom_sip_headers when non-empty — Retell's working
          // example omits this key entirely on basic cold transfers.
          ...(Object.keys(cleanedSipHeaders).length
            ? { custom_sip_headers: cleanedSipHeaders }
            : {}),
          transfer_destination,
          ignore_e164_validation: ignoreE164,
          transfer_option,
          speak_during_execution: (raw.speak_during_execution as boolean | undefined) ?? false,
          edge: transferFailedEdge(edges, String(base.id ?? "")),
        }),
      );
    }
    case "agent_transfer": {
      const agentId =
        (raw.agent_id as string) ?? (raw.destination_agent_id as string) ?? d.dialogue ?? "";
      // Retell agent_swap requires `instruction` even when empty.
      const instruction = raw.instruction ?? { type: "prompt", text: "" };
      return orderNode({
        ...base,
        webhook_setting:
          (d.agentSwapWebhookSetting as string | undefined) ??
          (raw.webhook_setting as string) ??
          "only_source_agent",
        agent_version: (raw.agent_version as number | string | undefined) ?? 0,
        post_call_analysis_setting:
          (d.agentSwapPostCallAnalysisSetting as string | undefined) ??
          (raw.post_call_analysis_setting as string) ??
          "only_destination_agent",
        keep_current_voice:
          d.agentSwapKeepCurrentVoice ?? (raw.keep_current_voice as boolean | undefined) ?? false,
        type: "agent_swap",
        keep_current_language:
          d.agentSwapKeepCurrentLanguage ??
          (raw.keep_current_language as boolean | undefined) ??
          false,
        speak_during_execution: (raw.speak_during_execution as boolean | undefined) ?? false,
        ...(agentId ? { agent_id: agentId } : {}),
        instruction,
        ...(edges.length > 0 ? { edge: edges[0] } : {}),
      });
    }
    case "press_digit":
      return orderNode({
        ...base,
        type: "press_digit",
        pause_detection_ms: d.pauseDetectionMs ?? (raw.pause_detection_ms as number) ?? 1000,
        instruction: { type: "prompt", text: d.dialogue },
        edges,
      });
    case "logic_split": {
      // Retell logic-split nodes emit an `else_edge` separately from `edges`.
      // Pick the else branch as: (1) round-tripped raw.else_edge, otherwise
      // (2) a transition whose condition reads "else"/"otherwise"/empty,
      // otherwise (3) the last edge as a fallback. Always emit an else_edge
      // even when there are no transitions, matching Retell's schema.
      let mainEdges = [...edges];
      let elseEdge: FlowEdge | undefined;
      if (raw.else_edge && typeof raw.else_edge === "object") {
        elseEdge = raw.else_edge as FlowEdge;
        // Avoid emitting the else edge twice (and tripping Retell's
        // "Duplicate edge id" check) when it also exists in `edges`.
        if (elseEdge.id) {
          mainEdges = mainEdges.filter((e) => e.id !== elseEdge!.id);
        }
      } else {
        const elseIdx = mainEdges.findIndex((e) => {
          const p = String(e.transition_condition?.prompt ?? "").trim();
          return !p || /^(else|otherwise)$/i.test(p);
        });
        const idx = elseIdx >= 0 ? elseIdx : mainEdges.length - 1;
        if (idx >= 0) {
          const picked = mainEdges[idx];
          mainEdges = mainEdges.filter((_, i) => i !== idx);
          elseEdge = {
            ...picked,
            transition_condition: { type: "prompt", prompt: "Else" },
          };
        }
      }
      if (!elseEdge) {
        elseEdge = {
          id: `edge-${n.id}-else`,
          transition_condition: { type: "prompt", prompt: "Else" },
        };
      }

      return orderNode({
        ...base,
        type: "branch",
        instruction: { type: "prompt", text: d.dialogue },
        edges: mainEdges,
        else_edge: elseEdge,
      });
    }
    case "sms": {
      // Retell SMS nodes use `instruction` + separate success_edge/failed_edge
      // (not an `edges` array). Detect a "failed"/"fail"/"error" condition for
      // failed_edge; everything else becomes success_edge.
      const rawSuccess = raw.success_edge as FlowEdge | undefined;
      const rawFailed = raw.failed_edge as FlowEdge | undefined;
      const failedIdx = edges.findIndex((e) =>
        /fail|error/i.test(String(e.transition_condition?.prompt ?? "")),
      );
      const failedFromEdges = failedIdx >= 0 ? edges[failedIdx] : undefined;
      const successFromEdges = edges.find((_, i) => i !== failedIdx);
      const success_edge: FlowEdge =
        rawSuccess ??
        (successFromEdges
          ? {
              ...successFromEdges,
              transition_condition: { type: "prompt", prompt: "Sent successfully" },
            }
          : {
              id: `success_edge-${n.id}`,
              transition_condition: { type: "prompt", prompt: "Sent successfully" },
            });
      const failed_edge: FlowEdge =
        rawFailed ??
        (failedFromEdges
          ? {
              ...failedFromEdges,
              transition_condition: { type: "prompt", prompt: "Failed to send" },
            }
          : {
              id: `failed_edge-${n.id}`,
              transition_condition: { type: "prompt", prompt: "Failed to send" },
            });
      return orderNode({
        ...base,
        type: "sms",
        instruction: { type: "prompt", text: d.smsMessage ?? d.dialogue ?? "" },
        success_edge,
        failed_edge,
      });
    }
    case "extract_variable": {
      const rawVar = raw.variable as
        | { name?: string; description?: string; type?: string }
        | undefined;
      const rawVars = raw.variables as
        | Array<{ name?: string; description?: string; type?: string }>
        | undefined;
      const extractVars = d.extractVariables as
        | Array<{ id?: string; name: string; description: string; type: string }>
        | undefined;
      const variables =
        extractVars && extractVars.length
          ? extractVars.map((v) => ({
              name: v.name || "var",
              description: v.description ?? "",
              type: v.type ?? "string",
            }))
          : rawVars && rawVars.length
            ? rawVars.map((v) => ({
                name: v.name ?? "var",
                description: v.description ?? "",
                type: v.type ?? "string",
              }))
            : [
                {
                  name: d.variableName ?? rawVar?.name ?? "var",
                  description: d.variableDescription ?? rawVar?.description ?? d.dialogue ?? "",
                  type: rawVar?.type ?? "string",
                },
              ];
      return orderNode({
        ...base,
        type: "extract_dynamic_variables",
        instruction: {
          type: "prompt",
          text:
            (raw.instruction as { text?: string })?.text ??
            d.dialogue ??
            d.variableDescription ??
            "Extract variables from the conversation.",
        },
        variables,
        edges,
      });
    }
    case "check_documents":
      return orderNode({
        ...base,
        type: "function",
        tool_id: "check_documents",
        tool_type: "local",
        speak_during_execution:
          d.speakDuringExecution ?? (raw.speak_during_execution as boolean) ?? true,
        wait_for_result: d.waitForResult ?? (raw.wait_for_result as boolean) ?? true,
        edges,
        ...(raw.else_edge !== undefined ? { else_edge: raw.else_edge } : {}),
      });
    case "send_upload_link":
      return orderNode({
        ...base,
        type: "function",
        tool_id: "send_upload_link",
        tool_type: "local",
        speak_during_execution:
          d.speakDuringExecution ?? (raw.speak_during_execution as boolean) ?? true,
        wait_for_result: d.waitForResult ?? (raw.wait_for_result as boolean) ?? true,
        edges,
        ...(raw.else_edge !== undefined ? { else_edge: raw.else_edge } : {}),
      });
    case "code":
      return orderNode({
        ...base,
        type: "code",
        code: d.codeSource ?? (raw.code as string) ?? "",
        edges,
      });
    case "ending":
      return orderNode({
        ...base,
        type: "end",
        instruction: {
          type: "prompt",
          text:
            d.endingPrompt ??
            (raw.instruction as { text?: string })?.text ??
            d.dialogue ??
            "End the call",
        },
      });

    case "http_request": {
      // HTTP Request nodes export as function nodes with a webhook URL.
      // At runtime, the voice engine calls the URL and maps the response
      // into variables the agent can reference.
      const toolId = `http_${n.id}`;
      return orderNode({
        ...base,
        type: "function",
        tool_id: toolId,
        tool_type: "webhook",
        name: d.httpToolName ?? d.label ?? "http_request",
        description: d.httpToolDescription ?? d.dialogue ?? "Make an HTTP request to an external API",
        url: d.httpUrl ?? "",
        timeout: d.httpTimeoutMs ?? 10000,
        speak_during_execution: d.speakDuringExecution ?? true,
        execution_message_description: d.dialogue || "Making an external API call…",
        parameters: {
          type: "object",
          properties: {
            payload: {
              type: "string",
              description: "Optional JSON payload string to merge into the request body",
            },
          },
          required: [],
        },
        edges,
      });
    }

    default: {
      // Backward-compat: legacy "start" nodes (kind removed) compile as conversation.
      if ((d.kind as string) === "start") {
        return orderNode({
          ...base,
          type: "conversation",
          start_speaker: (d as { startSpeaker?: string }).startSpeaker ?? "agent",
          instruction: {
            type: (d as { instructionType?: string }).instructionType ?? "prompt",
            text: d.dialogue ?? "",
          },
          edges,
        });
      }
      return orderNode(hasRaw ? { ...base, edges } : { ...base, type: d.kind, edges });
    }
  }
}
