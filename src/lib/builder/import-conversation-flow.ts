import type { Edge } from "@xyflow/react";
import type { FlowNode } from "./store";
import type { BuilderSettings, BuilderVariable, ExtractVariableItem, FlowNodeData, NodeKind, Transition, TransitionConditionType } from "./types";
import { isEquationCondition } from "../voice/graph/transition-engine.shared";
import {
  parseEquationGroup,
  serializeEquationPrompt,
  type EquationClause,
} from "../voice/graph/equations.shared";
import { allNodeKinds } from "./node-registry";

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyObj = Record<string, any>;

const TYPE_MAP: Record<string, NodeKind> = {
  conversation: "conversation",
  begin: "begin",
  wait: "wait",
  subagent: "subagent",
  function: "function",
  transfer_call: "call_transfer",
  call_transfer: "call_transfer",
  agent_transfer: "agent_transfer",
  agent_swap: "agent_transfer",
  press_digit: "press_digit",
  branch: "logic_split",
  logic_split: "logic_split",
  sms: "sms",
  extract_dynamic_variable: "extract_variable",
  extract_variable: "extract_variable",
  code: "code",
  end: "ending",
  ending: "ending",
  mcp: "mcp",
  http_request: "http_request",
};

const KNOWN_KINDS = new Set<string>(allNodeKinds());

const NODE_OVERRIDE_KEYS = [
  "voice_speed",
  "responsiveness",
  "interruption_sensitivity",
  "allow_dtmf_interruption",
] as const;

/**
 * Reconstruct our internal model ID from Retell's model_choice object.
 * Retell represents Fast Tier as {model: "gpt-4.1", high_priority: true}.
 * In our UI we use a "-fast" suffix (e.g. "gpt-4.1-fast") so the dropdown
 * correctly shows the Fast Tier selection.
 */
function resolveModelId(modelChoice: AnyObj | undefined): string | undefined {
  if (!modelChoice) return undefined;
  const base = modelChoice.model as string | undefined;
  if (!base) return undefined;
  return modelChoice.high_priority ? `${base}-fast` : base;
}

function readNodeSettings(rn: AnyObj): Record<string, unknown> | undefined {
  const settings: Record<string, unknown> = {
    ...((rn.global_node_setting as Record<string, unknown>) ?? {}),
  };
  NODE_OVERRIDE_KEYS.forEach((key) => {
    if (rn[key] !== undefined) settings[key] = rn[key];
  });
  if (rn.model_choice?.model !== undefined) settings.model = resolveModelId(rn.model_choice);
  if (typeof settings.condition === "string" && settings.condition.trim()) {
    settings.conditions = [settings.condition];
  }
  return Object.keys(settings).length ? settings : undefined;
}

/**
 * Collect outgoing edges from a node, handling both `edges: []` (most types)
 * and `edge: {}` (single edge — transfer_call). The dashboard can keep draft edges
 * without a destination_node_id, so preserve them as target-less transitions.
 */
function collectRawEdges(rn: AnyObj): AnyObj[] {
  const out: AnyObj[] = [];
  if (Array.isArray(rn.edges)) out.push(...rn.edges);
  if (rn.edge) out.push(rn.edge);
  if (rn.else_edge) out.push(rn.else_edge);
  return out.filter(Boolean);
}

function readHandoffText(option: AnyObj | undefined): string | undefined {
  if (!option) return undefined;
  return option.prompt ?? option.message ?? option.message_to_agent;
}

function readTransition(e: AnyObj, nodeId: string, i: number): Transition {
  const cond = (e.transition_condition ?? {}) as AnyObj;
  const group = parseEquationGroup(cond);
  const prompt = String(cond.prompt ?? "").trim();
  const rawType = cond.type as TransitionConditionType | undefined;
  const conditionType: TransitionConditionType =
    rawType === "equation" || rawType === "prompt"
      ? rawType
      : group || isEquationCondition(prompt)
        ? "equation"
        : "prompt";
  const condition =
    conditionType === "equation"
      ? prompt || (group ? serializeEquationPrompt(group) : "")
      : prompt;
  return {
    id: e.id ?? `t-${nodeId}-${i}`,
    target: e.destination_node_id ?? null,
    condition,
    conditionType,
    ...(group
      ? {
          equationJoin: group.join,
          equations: group.equations as EquationClause[],
        }
      : {}),
  };
}

function formatQueryLines(params: AnyObj | undefined): string | undefined {
  if (!params || typeof params !== "object") return undefined;
  const lines = Object.entries(params)
    .filter(([, v]) => v != null && String(v).trim() !== "")
    .map(([k, v]) => `${k}=${String(v)}`);
  return lines.length ? lines.join("\n") : undefined;
}

function formatResponseMapping(vars: AnyObj | undefined): string | undefined {
  if (!vars || typeof vars !== "object") return undefined;
  const lines = Object.entries(vars)
    .filter(([k]) => k.trim())
    .map(([k, v]) => (v ? `${v} -> {{${k}}}` : k));
  return lines.length ? lines.join("\n") : undefined;
}

function hydrateFunctionNodes(nodes: FlowNode[], tools: AnyObj[]): void {
  const byId = new Map<string, AnyObj>();
  const byName = new Map<string, AnyObj>();
  for (const tool of tools) {
    const id = String(tool.tool_id ?? tool.id ?? "").trim();
    const name = String(tool.name ?? "").trim();
    if (id) byId.set(id, tool);
    if (name) byName.set(name.toLowerCase(), tool);
  }
  for (const node of nodes) {
    if (node.data.kind !== "function") continue;
    const tool =
      byId.get(String(node.data.toolId ?? "").trim()) ??
      byName.get(String(node.data.label ?? node.data.toolName ?? "").trim().toLowerCase());
    if (!tool) continue;
    const d = node.data;
    if (!d.toolId && tool.tool_id) d.toolId = String(tool.tool_id);
    if (tool.name) d.toolName = String(tool.name);
    if (!d.toolDescription && typeof tool.description === "string") {
      d.toolDescription = tool.description;
    }
    if (!d.httpUrl && typeof tool.url === "string") d.httpUrl = tool.url;
    if (!d.httpMethod && typeof tool.method === "string") {
      const m = String(tool.method).toUpperCase();
      if (["GET", "POST", "PUT", "PATCH", "DELETE"].includes(m)) {
        d.httpMethod = m as FlowNodeData["httpMethod"];
      }
    }
    if (d.httpTimeoutMs == null && typeof tool.timeout_ms === "number") {
      d.httpTimeoutMs = tool.timeout_ms;
    }
    if (!d.httpHeaders && tool.headers && typeof tool.headers === "object") {
      d.httpHeaders = JSON.stringify(tool.headers);
    }
    if (!d.httpQuery) {
      const q = formatQueryLines(tool.query_params as AnyObj | undefined);
      if (q) d.httpQuery = q;
    }
    if (!d.httpResponseMapping) {
      const map = formatResponseMapping(tool.response_variables as AnyObj | undefined);
      if (map) d.httpResponseMapping = map;
    }
    if (!d.httpBody && tool.parameters && typeof tool.parameters === "object") {
      d.httpBody = JSON.stringify(tool.parameters);
    }
    if (d.label === "function" || d.label === "Function" || !d.label) {
      d.label = String(tool.name ?? d.label);
    }
  }
}

/**
 * Parse a Webespoke AI agent JSON (or just a conversation flow) back into
 * builder nodes, edges, and settings.
 */
export function importAgentJson(raw: string): {
  nodes: FlowNode[];
  edges: Edge[];
  settings: Partial<BuilderSettings>;
  variables?: BuilderVariable[];
} {
  const data: AnyObj = JSON.parse(raw);
  const cf: AnyObj = data.conversationFlow ?? data.conversation_flow ?? data;
  const rawNodes: AnyObj[] = Array.isArray(cf.nodes) ? cf.nodes : [];

  if (!rawNodes.length) {
    throw new Error("No nodes found in JSON (expected conversationFlow.nodes).");
  }

  // Build nodes
  const nodes: FlowNode[] = rawNodes.map((rn, idx) => {
    const kind: NodeKind = KNOWN_KINDS.has(String(rn.builder_kind ?? ""))
      ? (rn.builder_kind as NodeKind)
      : rn.tool_type === "mcp"
        ? "mcp"
        : rn.tool_type === "webhook"
          ? "http_request"
          : (TYPE_MAP[rn.type] ?? "conversation");
    const pos =
      rn.display_position && typeof rn.display_position.x === "number"
        ? rn.display_position
        : { x: 200 + (idx % 8) * 260, y: 200 + Math.floor(idx / 8) * 200 };

    const rEdges = collectRawEdges(rn);
    const transitions: Transition[] = rEdges.map((e, i) => readTransition(e, rn.id, i));

    const nodeData: FlowNodeData = {
      kind,
      label: rn.name ?? kind,
      dialogue:
        rn.instruction?.text ??
        rn.message ??
        rn.code ??
        rn.variable?.description ??
        rn.agent_id ??
        rn.destination_agent_id ??
        "",
      transitions,
      isStart: rn.id === cf.start_node_id,
      startSpeaker: rn.start_speaker,
      instructionType: rn.instruction?.type,
      instructions: (rn.instruction as { notes?: string } | undefined)?.notes,
      smsMessage: rn.message,
      pauseDetectionMs: rn.pause_detection_ms,
      digitTimeoutMs: rn.digit_timeout_ms,
      digitRetryCount: kind === "press_digit" ? rn.retry_count : undefined,
      transferNumber: rn.transfer_destination?.number,
      transferMode:
        rn.transfer_destination?.type === "dynamic_variable" ||
        rn.transfer_destination?.type === "inferred"
          ? "dynamic"
          : "static",
      transferDynamicVariable:
        rn.transfer_destination?.prompt ?? rn.transfer_destination?.variable_name,
      transferType:
        rn.transfer_option?.type === "warm_handoff"
          ? "agentic_warm_transfer"
          : rn.transfer_option?.type,
      sipTransferMethod: rn.transfer_option?.cold_transfer_mode ?? rn.sip_transfer_method,
      callerIdMode: rn.transfer_option?.show_transferee_as_caller ? "user" : rn.display_caller_id,
      transferRingDurationSec:
        typeof rn.transfer_option?.transfer_ring_duration_ms === "number"
          ? Math.round(rn.transfer_option.transfer_ring_duration_ms / 1000)
          : typeof rn.ring_duration_ms === "number"
            ? Math.round(rn.ring_duration_ms / 1000)
            : undefined,
      transferExtensionNumber: rn.transfer_destination?.extension ?? rn.extension_dial_string,
      ignoreE164Validation: rn.ignore_e164_validation,
      showTransfereeAsCaller: rn.transfer_option?.show_transferee_as_caller,
      customSipHeaders: rn.custom_sip_headers,
      warmHandoffPrompt: readHandoffText(rn.transfer_option?.public_handoff_option),
      privateHandoffPrompt: readHandoffText(rn.transfer_option?.private_handoff_option),
      ivrPrompt: readHandoffText(rn.transfer_option?.ivr_option),
      optOutHumanDetection: rn.transfer_option?.opt_out_human_detection,
      transferAgentId: rn.transfer_option?.agentic_transfer_config?.transfer_agent?.agent_id,
      transferAgentVersion:
        rn.transfer_option?.agentic_transfer_config?.transfer_agent?.agent_version,
      transferTimeoutSec:
        typeof rn.transfer_option?.agentic_transfer_config?.transfer_timeout_ms === "number"
          ? Math.round(rn.transfer_option.agentic_transfer_config.transfer_timeout_ms / 1000)
          : undefined,
      transferTimeoutAction: rn.transfer_option?.agentic_transfer_config?.action_on_timeout,
      speakDuringExecution: rn.speak_during_execution,
      waitForResult: rn.wait_for_result,
      toolId: rn.tool_id
        ? String(rn.tool_id).replace(/_cal$/, "")
        : undefined,
      codeSource: rn.code,
      waitTimeoutMs: rn.silence_timeout_ms,
      waitMaxMs: rn.max_wait_ms,
      waitRetryCount: kind === "wait" ? rn.retry_count : undefined,
      waitMode: kind === "wait" ? (rn.start_speaker === "user" ? "user" : "silence") : undefined,
      beginSilenceMs: rn.begin_after_user_silence_ms,
      subagentToolIds: Array.isArray(rn.subagent_tools) ? rn.subagent_tools.join(", ") : undefined,
      subagentKbIds: Array.isArray(rn.knowledge_base_ids) ? rn.knowledge_base_ids.join(", ") : undefined,
      subagentModel: kind === "subagent" ? resolveModelId(rn.model_choice) : undefined,
      mcpServerUrl: rn.tool_type === "mcp" || kind === "mcp" ? rn.url : undefined,
      mcpToolName: rn.mcp_tool ?? (kind === "mcp" ? rn.name : undefined),
      mcpTimeoutMs: kind === "mcp" ? rn.timeout : undefined,
      mcpHeaders:
        (rn.tool_type === "mcp" || kind === "mcp") && rn.headers && typeof rn.headers === "object"
          ? JSON.stringify(rn.headers)
          : undefined,
      toolName: rn.name,
      toolDescription: typeof rn.description === "string" ? rn.description : undefined,
      httpUrl:
        rn.tool_type === "webhook" || kind === "http_request" || kind === "function"
          ? rn.url
          : undefined,
      httpMethod: rn.method,
      httpTimeoutMs:
        kind === "http_request" || rn.tool_type === "webhook" || kind === "function"
          ? rn.timeout ?? rn.timeout_ms
          : undefined,
      httpToolName: kind === "http_request" || rn.tool_type === "webhook" ? rn.name : undefined,
      httpBody: typeof rn.body === "string" ? rn.body : undefined,
      httpHeaders:
        (kind === "http_request" || rn.tool_type === "webhook") &&
        rn.headers &&
        typeof rn.headers === "object"
          ? JSON.stringify(rn.headers)
          : undefined,
      extractVariables: Array.isArray(rn.variables)
        ? rn.variables.map((v: AnyObj, i: number) => ({
            id: String(v.id ?? `var-${i}`),
            name: String(v.name ?? ""),
            description: String(v.description ?? ""),
            type: (["string", "number", "boolean", "date", "enum", "json"].includes(String(v.type))
              ? v.type
              : String(v.description ?? "").includes("JSON object")
                ? "json"
                : "string") as ExtractVariableItem["type"],
            required: v.required === true,
          }))
        : undefined,
      endingPrompt: kind === "ending" ? rn.instruction?.text : undefined,
      variableName: rn.variable?.name,
      variableDescription: rn.variable?.description,
      isGlobalNode: !!rn.global_node_setting?.condition || rn.is_global,
      globalNodeSetting: readNodeSettings(rn),
      // Preserve the full raw node so dashboard-only fields (finetune_*_examples,
      // tool_type, transfer_option, etc.) round-trip exactly.
      raw: rn,
    };

    // Strip undefined keys so they don't override defaults
    Object.keys(nodeData).forEach((k) => {
      if ((nodeData as AnyObj)[k] === undefined) delete (nodeData as AnyObj)[k];
    });

    return {
      id: String(rn.id ?? `node-${idx}`),
      type: kind,
      position: { x: pos.x, y: pos.y },
      data: nodeData,
    };
  });

  const importedTools: AnyObj[] = Array.isArray(cf.tools) ? cf.tools : [];
  hydrateFunctionNodes(nodes, importedTools);

  const nodeIds = new Set(nodes.map((n) => n.id));

  // Build edges — only keep edges whose target node actually exists
  const edges: Edge[] = [];
  const seenEdgeIds = new Set<string>();
  rawNodes.forEach((rn) => {
    const rEdges = collectRawEdges(rn);
    rEdges.forEach((e, i) => {
      if (!e.destination_node_id || !nodeIds.has(e.destination_node_id)) return;
      let edgeId = e.id ?? `edge-${rn.id}-${i}`;
      // Retell can ship classifier nodes where the same edge id appears in
      // both `edges` and `else_edge` — keep ids unique on import so we don't
      // re-emit duplicates later (Retell rejects with "Duplicate edge id").
      if (seenEdgeIds.has(edgeId)) {
        let suffix = 2;
        while (seenEdgeIds.has(`${edgeId}-${suffix}`)) suffix++;
        edgeId = `${edgeId}-${suffix}`;
      }
      seenEdgeIds.add(edgeId);
      edges.push({
        id: edgeId,
        source: String(rn.id),
        target: String(e.destination_node_id),
        sourceHandle: edgeId,
      });
    });
  });

  const hc: AnyObj = data.handbook_config ?? {};
  // Strip nodes from the raw CF and conversationFlow from the raw agent so we
  // don't double-store the heavy parts. Everything else round-trips verbatim.
  const { nodes: _omitNodes, ...rawConversationFlow } = cf;
  rawConversationFlow.__key_order = Object.keys(cf);
  const { conversationFlow: _omitCf, ...rawAgent } = data;
  rawAgent.__key_order = Object.keys(data);
  const settings: Partial<BuilderSettings> = {
    agentName: data.agent_name ?? cf.agent_name,
    agentId: data.agent_id || undefined,
    conversationFlowId: cf.conversation_flow_id,
    globalPrompt:
      typeof cf.global_prompt === "string" && cf.global_prompt.trim()
        ? cf.global_prompt
        : "You should be polite and humble. Stay on this node's task only. Keep responses concise.",
    model: resolveModelId(cf.model_choice),
    voiceId: data.voice_id,
    language: data.language,
    temperature: cf.model_temperature ?? cf.temperature,
    webhookUrl: data.webhook_url,
    transitionFlexibility: cf.flex_mode === false ? "strict" : "flex",
    startSpeaker: cf.start_speaker,
    beginAfterUserSilenceMs: cf.begin_after_user_silence_ms,
    voiceSpeed: data.voice_speed,
    voiceTemperature: data.voice_temperature,
    volume: data.volume,
    responsiveness: data.responsiveness,
    voiceEmotion: data.voice_emotion ?? "none",
    interruptionSensitivity: data.interruption_sensitivity,
    enableBackchannel: data.enable_backchannel,
    backchannelFrequency: data.backchannel_frequency,
    backchannelWords: data.backchannel_words,
    reminderTriggerMs: data.reminder_trigger_ms,
    reminderMaxCount: data.reminder_max_count,
    ambientSound: data.ambient_sound ?? "none",
    ambientSoundVolume: data.ambient_sound_volume,
    boostedKeywords: data.boosted_keywords,
    pronunciationDictionary: data.pronunciation_dictionary,
    endCallAfterSilenceMs: data.end_call_after_silence_ms,
    beginMessageDelayMs: data.begin_message_delay_ms,
    sttMode: data.stt_mode,
    vocabSpecialization: data.vocab_specialization,
    allowUserDtmf: data.allow_user_dtmf,
    allowDtmfInterruption: data.allow_dtmf_interruption,
    denoisingMode: data.denoising_mode,
    maxCallDurationMs: data.max_call_duration_ms,
    ringDurationMs: data.ring_duration_ms,
    enableDynamicVoiceSpeed: data.enable_dynamic_voice_speed,
    enableDynamicResponsiveness: data.enable_dynamic_responsiveness,
    normalizeForSpeech: data.normalize_for_speech,
    handbookEchoVerification: hc.echo_verification,
    handbookSpeechNormalization: hc.speech_normalization,
    handbookDefaultPersonality: hc.default_personality,
    handbookScopeBoundaries: hc.scope_boundaries,
    handbookNaturalFillerWords: hc.natural_filler_words,
    handbookNatoPhoneticAlphabet: hc.nato_phonetic_alphabet,
    handbookHighEmpathy: hc.high_empathy,
    handbookAiDisclosure: hc.ai_disclosure,
    handbookSmartMatching: hc.smart_matching,
    rawAgent,
    rawConversationFlow,
    flowTools: importedTools,
  };

  const variables: BuilderVariable[] = Array.isArray(data.post_call_analysis_data)
    ? data.post_call_analysis_data.map((v: AnyObj) => ({
        name: v.name ?? "",
        description: v.description ?? "",
        type: v.type ?? "string",
        defaultValue: "",
        examples: Array.isArray(v.examples) ? v.examples : undefined,
      }))
    : [];

  // Strip undefined keys
  Object.keys(settings).forEach((k) => {
    if ((settings as AnyObj)[k] === undefined) delete (settings as AnyObj)[k];
  });

  return { nodes, edges, settings, variables };
}
