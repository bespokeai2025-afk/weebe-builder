/**
 * Single source of truth for builder node kinds.
 *
 * Adding a node type should start here: label, channel, palette order, and
 * default `FlowNodeData`. Renderers, export, and the VM still opt in separately
 * so a new kind cannot silently change runtime behaviour.
 */
import type { FlowNodeData, NodeKind } from "./types";

export type NodeChannel = "voice" | "whatsapp" | "both";

export type NodeCategory =
  | "conversation"
  | "logic"
  | "action"
  | "io"
  | "annotation"
  | "whatsapp";

export interface NodeKindDefinition {
  kind: NodeKind;
  label: string;
  channel: NodeChannel;
  category: NodeCategory;
  /** Lower = higher in the voice palette. Omit to hide from voice palette. */
  voicePaletteOrder?: number;
  /** Lower = higher in the WhatsApp palette. Omit to hide from WA palette. */
  waPaletteOrder?: number;
  defaultData?: Partial<FlowNodeData>;
}

const BASE_DATA: Pick<FlowNodeData, "dialogue" | "transitions"> = {
  dialogue: "",
  transitions: [],
};

export const NODE_REGISTRY: readonly NodeKindDefinition[] = [
  {
    kind: "begin",
    label: "Begin",
    channel: "voice",
    category: "conversation",
    voicePaletteOrder: 0,
    defaultData: {
      isStart: true,
      startSpeaker: "agent",
      instructionType: "static_text",
      dialogue: "",
      beginSilenceMs: 0,
    },
  },
  {
    kind: "conversation",
    label: "Conversation",
    channel: "voice",
    category: "conversation",
    voicePaletteOrder: 1,
    defaultData: { instructionType: "prompt" },
  },
  {
    kind: "wait",
    label: "Wait",
    channel: "voice",
    category: "io",
    voicePaletteOrder: 2,
    defaultData: {
      instructionType: "static_text",
      waitMode: "user",
      waitTimeoutMs: 8000,
      waitRetryCount: 1,
      transitions: [{ id: "tr-timeout", condition: "timeout", target: null, conditionType: "prompt" }],
    },
  },
  {
    kind: "subagent",
    label: "Subagent",
    channel: "voice",
    category: "conversation",
    voicePaletteOrder: 3,
    defaultData: { instructionType: "prompt", subagentToolIds: "", subagentKbIds: "" },
  },
  {
    kind: "ending",
    label: "End Call",
    channel: "voice",
    category: "action",
    voicePaletteOrder: 4,
    defaultData: { instructionType: "prompt", endingPrompt: "Politely end the call" },
  },
  {
    kind: "function",
    label: "Function",
    channel: "voice",
    category: "action",
    voicePaletteOrder: 5,
    defaultData: { speakDuringExecution: false, waitForResult: true },
  },
  {
    kind: "call_transfer",
    label: "Call Transfer",
    channel: "voice",
    category: "action",
    voicePaletteOrder: 6,
  },
  {
    kind: "press_digit",
    label: "Press Digit",
    channel: "voice",
    category: "io",
    voicePaletteOrder: 7,
    defaultData: { pauseDetectionMs: 1000, digitTimeoutMs: 5000, digitRetryCount: 2 },
  },
  {
    kind: "logic_split",
    label: "Logic Split",
    channel: "both",
    category: "logic",
    voicePaletteOrder: 8,
    waPaletteOrder: 9,
  },
  {
    kind: "agent_transfer",
    label: "Agent Transfer",
    channel: "voice",
    category: "action",
    voicePaletteOrder: 9,
  },
  {
    kind: "sms",
    label: "In-Call SMS",
    channel: "voice",
    category: "action",
    voicePaletteOrder: 10,
  },
  {
    kind: "extract_variable",
    label: "Extract Variable",
    channel: "both",
    category: "io",
    voicePaletteOrder: 11,
    waPaletteOrder: 10,
  },
  {
    kind: "code",
    label: "Code",
    channel: "both",
    category: "action",
    voicePaletteOrder: 12,
    waPaletteOrder: 11,
  },
  {
    kind: "mcp",
    label: "MCP",
    channel: "voice",
    category: "io",
    voicePaletteOrder: 13,
    defaultData: { mcpTimeoutMs: 10000, mcpToolName: "", mcpServerUrl: "", mcpHeaders: "" },
  },
  {
    kind: "http_request",
    label: "HTTP Request",
    channel: "voice",
    category: "io",
    voicePaletteOrder: 14,
  },
  {
    kind: "note",
    label: "Note",
    channel: "both",
    category: "annotation",
    voicePaletteOrder: 15,
    waPaletteOrder: 12,
  },
  {
    kind: "check_documents",
    label: "Check Documents",
    channel: "voice",
    category: "action",
    voicePaletteOrder: 16,
  },
  {
    kind: "send_upload_link",
    label: "Send Upload Link",
    channel: "voice",
    category: "action",
    voicePaletteOrder: 17,
  },
  {
    kind: "wa_start",
    label: "WA Start",
    channel: "whatsapp",
    category: "whatsapp",
    waPaletteOrder: 0,
  },
  {
    kind: "wa_message",
    label: "WA Message",
    channel: "whatsapp",
    category: "whatsapp",
    waPaletteOrder: 1,
  },
  {
    kind: "wa_media",
    label: "WA Media",
    channel: "whatsapp",
    category: "whatsapp",
    waPaletteOrder: 2,
  },
  {
    kind: "wa_booking",
    label: "WA Booking",
    channel: "whatsapp",
    category: "whatsapp",
    waPaletteOrder: 3,
  },
  {
    kind: "wa_delay",
    label: "WA Delay",
    channel: "whatsapp",
    category: "whatsapp",
    waPaletteOrder: 4,
  },
  {
    kind: "wa_wait_reply",
    label: "WA Wait Reply",
    channel: "whatsapp",
    category: "whatsapp",
    waPaletteOrder: 5,
    defaultData: { dialogue: "" },
  },
  {
    kind: "wa_extract_var",
    label: "WA Extract Var",
    channel: "whatsapp",
    category: "whatsapp",
    waPaletteOrder: 6,
    defaultData: { extractVarName: "", extractVarPrompt: "" },
  },
  {
    kind: "wa_tag",
    label: "WA Tag",
    channel: "whatsapp",
    category: "whatsapp",
    waPaletteOrder: 7,
    defaultData: { tagName: "" },
  },
  {
    kind: "wa_template",
    label: "WA Template",
    channel: "whatsapp",
    category: "whatsapp",
    waPaletteOrder: 8,
    defaultData: { templateBody: "" },
  },
] as const;

const BY_KIND = new Map<NodeKind, NodeKindDefinition>(
  NODE_REGISTRY.map((def) => [def.kind, def]),
);

export function getNodeDef(kind: NodeKind): NodeKindDefinition {
  return BY_KIND.get(kind) ?? BY_KIND.get("conversation")!;
}

export function nodeLabel(kind: NodeKind): string {
  return getNodeDef(kind).label;
}

export function paletteFor(channel: "voice" | "whatsapp"): NodeKindDefinition[] {
  const key = channel === "whatsapp" ? "waPaletteOrder" : "voicePaletteOrder";
  return NODE_REGISTRY.filter((d) => typeof d[key] === "number").sort(
    (a, b) => (a[key] as number) - (b[key] as number),
  );
}

export function defaultNodeData(kind: NodeKind, overrides: Partial<FlowNodeData> = {}): FlowNodeData {
  const def = getNodeDef(kind);
  return {
    kind,
    label: def.label,
    ...BASE_DATA,
    ...def.defaultData,
    ...overrides,
  };
}

export function allNodeKinds(): NodeKind[] {
  return NODE_REGISTRY.map((d) => d.kind);
}
