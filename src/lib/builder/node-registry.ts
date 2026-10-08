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

/**
 * One editable setting on a node, declared in the registry instead of hand-written in the editor.
 * The node editor renders these generically and the validator enforces `required`, so a simple
 * new kind needs a registry entry (plus its export/runtime handling) — not editor or validator code.
 */
export type NodeField =
  | {
      type: "number";
      key: keyof FlowNodeData & string;
      label: string;
      default: number;
      /** Used when the input is cleared or not a number. Defaults to `default`. */
      fallback?: number;
      min?: number;
      max?: number;
      half?: boolean;
    }
  | {
      type: "text" | "variableText";
      key: keyof FlowNodeData & string;
      label: string;
      placeholder?: string;
      required?: { level: "error" | "warn"; message: string };
      half?: boolean;
    }
  | {
      type: "textarea" | "variableTextarea";
      key: keyof FlowNodeData & string;
      label: string;
      rows?: number;
      placeholder?: string;
      mono?: boolean;
      /** Shown under the field. Text in `backticks` renders as code. */
      hint?: string;
      required?: { level: "error" | "warn"; message: string };
    }
  | {
      type: "select";
      key: keyof FlowNodeData & string;
      label: string;
      default: string;
      options: ReadonlyArray<{ value: string; label: string }>;
      half?: boolean;
    }
  | {
      type: "switch";
      key: keyof FlowNodeData & string;
      label: string;
      default: boolean;
      description?: string;
    }
  | { type: "help"; text: string };

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
  /**
   * Node `type` values in imported flow JSON (Retell's names and our own) that become this kind.
   * The importer reads its type table from here, so a new kind declares its own mapping.
   */
  importTypes?: readonly string[];
  /** Editor fields for this kind. Kinds without them keep a hand-written editor section. */
  fields?: readonly NodeField[];
}

const BASE_DATA: Pick<FlowNodeData, "dialogue" | "transitions"> = {
  dialogue: "",
  transitions: [],
};

export const NODE_REGISTRY: readonly NodeKindDefinition[] = [
  {
    kind: "begin",
    importTypes: ["begin"],
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
    importTypes: ["conversation"],
    label: "Conversation",
    channel: "voice",
    category: "conversation",
    voicePaletteOrder: 1,
    defaultData: { instructionType: "prompt" },
  },
  {
    kind: "wait",
    importTypes: ["wait"],
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
    fields: [
      {
        type: "select",
        key: "waitMode",
        label: "Wait for",
        default: "user",
        options: [
          { value: "user", label: "User to speak" },
          { value: "silence", label: "Silence / pause" },
        ],
      },
      { type: "number", key: "waitTimeoutMs", label: "Timeout (ms)", default: 8000, min: 500, half: true },
      { type: "number", key: "waitRetryCount", label: "Retries", default: 1, fallback: 0, min: 0, max: 5, half: true },
      { type: "help", text: "Connect a transition labeled `timeout` for the silence path." },
    ],
  },
  {
    kind: "subagent",
    importTypes: ["subagent"],
    label: "Subagent",
    channel: "voice",
    category: "conversation",
    voicePaletteOrder: 3,
    defaultData: { instructionType: "prompt", subagentToolIds: "", subagentKbIds: "" },
    fields: [
      { type: "text", key: "subagentToolIds", label: "Tools (comma-separated names)", placeholder: "check_availability, book_appointment" },
      { type: "text", key: "subagentKbIds", label: "Knowledge bases", placeholder: "kb ids or names" },
      { type: "text", key: "subagentModel", label: "Model override", placeholder: "Leave blank to use agent model" },
      {
        type: "help",
        text: "Exit using the transitions below (prompt or equation). This stays one conversation node at runtime so existing flows keep working.",
      },
    ],
  },
  {
    kind: "ending",
    importTypes: ["end", "ending"],
    label: "End Call",
    channel: "voice",
    category: "action",
    voicePaletteOrder: 4,
    defaultData: { instructionType: "prompt", endingPrompt: "Politely end the call" },
  },
  {
    kind: "function",
    importTypes: ["function"],
    label: "Function",
    channel: "voice",
    category: "action",
    voicePaletteOrder: 5,
    defaultData: { speakDuringExecution: false, waitForResult: true },
  },
  {
    kind: "call_transfer",
    importTypes: ["transfer_call", "call_transfer"],
    label: "Call Transfer",
    channel: "voice",
    category: "action",
    voicePaletteOrder: 6,
  },
  {
    kind: "press_digit",
    importTypes: ["press_digit"],
    label: "Press Digit",
    channel: "voice",
    category: "io",
    voicePaletteOrder: 7,
    defaultData: { pauseDetectionMs: 1000, digitTimeoutMs: 5000, digitRetryCount: 2 },
    fields: [
      { type: "number", key: "pauseDetectionMs", label: "Pause detection (ms)", default: 1000, fallback: 0 },
      { type: "number", key: "digitTimeoutMs", label: "Digit timeout (ms)", default: 5000, min: 500, half: true },
      { type: "number", key: "digitRetryCount", label: "Retries", default: 2, fallback: 0, min: 0, max: 5, half: true },
      {
        type: "textarea",
        key: "dialogue",
        label: "Instruction",
        rows: 3,
        hint: "Add a transition named `timeout` or `invalid` for those paths.",
      },
    ],
  },
  {
    kind: "logic_split",
    importTypes: ["branch", "logic_split"],
    label: "Logic Split",
    channel: "both",
    category: "logic",
    voicePaletteOrder: 8,
    waPaletteOrder: 9,
    fields: [
      {
        type: "variableTextarea",
        key: "dialogue",
        label: "Logic prompt",
        rows: 4,
        placeholder: "Describe how to choose between branches…",
        hint: "Use Equation transitions below — If any / If all with =, ≠, contains, does not contain, exists. Leave one branch empty or named Else as the fallback.",
      },
    ],
  },
  {
    kind: "agent_transfer",
    importTypes: ["agent_transfer", "agent_swap"],
    label: "Agent Transfer",
    channel: "voice",
    category: "action",
    voicePaletteOrder: 9,
  },
  {
    kind: "sms",
    importTypes: ["sms"],
    label: "In-Call SMS",
    channel: "voice",
    category: "action",
    voicePaletteOrder: 10,
    fields: [{ type: "variableTextarea", key: "smsMessage", label: "Message", rows: 3 }],
  },
  {
    kind: "extract_variable",
    importTypes: ["extract_dynamic_variable", "extract_variable"],
    label: "Extract Variable",
    channel: "both",
    category: "io",
    voicePaletteOrder: 11,
    waPaletteOrder: 10,
  },
  {
    kind: "code",
    importTypes: ["code"],
    label: "Code",
    channel: "both",
    category: "action",
    voicePaletteOrder: 12,
    waPaletteOrder: 11,
  },
  {
    kind: "mcp",
    importTypes: ["mcp"],
    label: "MCP",
    channel: "voice",
    category: "io",
    voicePaletteOrder: 13,
    defaultData: { mcpTimeoutMs: 10000, mcpToolName: "", mcpServerUrl: "", mcpHeaders: "" },
    fields: [
      {
        type: "variableText",
        key: "mcpServerUrl",
        label: "MCP server URL",
        placeholder: "https://mcp.example.com/sse",
        required: { level: "error", message: "has no server URL" },
      },
      {
        type: "text",
        key: "mcpToolName",
        label: "Tool name",
        placeholder: "tool name from the MCP server",
        required: { level: "warn", message: "has no tool name selected" },
      },
      {
        type: "variableTextarea",
        key: "mcpHeaders",
        label: "Headers (JSON)",
        rows: 2,
        mono: true,
        placeholder: '{"Authorization": "Bearer {{token}}"}',
        hint: "Use variable placeholders. Do not paste live API keys into the canvas.",
      },
      { type: "number", key: "mcpTimeoutMs", label: "Timeout (ms)", default: 10000, min: 1000 },
    ],
  },
  {
    kind: "http_request",
    importTypes: ["http_request"],
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

/** Imported node `type` → builder kind, built from each definition's `importTypes`. */
export function importTypeMap(): Record<string, NodeKind> {
  const out: Record<string, NodeKind> = {};
  for (const def of NODE_REGISTRY) {
    for (const type of def.importTypes ?? []) out[type] = def.kind;
  }
  return out;
}

/** Validation messages for unmet `required` fields. */
export function missingRequiredFields(
  fields: readonly NodeField[] | undefined,
  data: FlowNodeData,
): Array<{ level: "error" | "warn"; message: string }> {
  const out: Array<{ level: "error" | "warn"; message: string }> = [];
  for (const f of fields ?? []) {
    if (!("required" in f) || !f.required) continue;
    const value = String((data as Record<string, unknown>)[f.key] ?? "").trim();
    if (!value) out.push(f.required);
  }
  return out;
}
