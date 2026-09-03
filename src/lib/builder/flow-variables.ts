/**
 * In-flow variables for the builder.
 *
 * Derived from the existing graph + `variables` store — not a second state
 * engine. Autocomplete and the inspector both read from `collectFlowVariables`.
 */
import { referencedTemplateVars } from "../voice/graph/speech-prompt.shared";
import type { BuilderVariable, FlowNode } from "./types";

export type FlowVariableSource =
  | "system"
  | "extract"
  | "http"
  | "whatsapp"
  | "post_call"
  | "transfer";

export interface FlowVariableRef {
  name: string;
  source: FlowVariableSource;
  description?: string;
  /** Node that defines this variable, when it lives on the canvas. */
  nodeId?: string;
  nodeLabel?: string;
}

export const SYSTEM_FLOW_VARS: readonly FlowVariableRef[] = [
  { name: "user_number", source: "system", description: "Caller phone number" },
  { name: "caller_number", source: "system", description: "Caller phone number" },
  { name: "agent_number", source: "system", description: "Agent / destination number" },
  { name: "current_time", source: "system", description: "Current local time" },
  { name: "current_date", source: "system", description: "Current local date" },
  { name: "call_id", source: "system", description: "This call's id" },
];

const NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export function isFlowVariableName(name: string): boolean {
  return NAME_RE.test(name);
}

function pushUnique(
  out: FlowVariableRef[],
  seen: Map<string, number>,
  ref: FlowVariableRef,
): void {
  const name = ref.name.trim();
  if (!isFlowVariableName(name)) return;
  const existing = seen.get(name);
  if (existing === undefined) {
    seen.set(name, out.length);
    out.push({ ...ref, name });
    return;
  }
  const prev = out[existing]!;
  if (prev.source === "system" && ref.source !== "system") return;
  if (prev.source === "post_call" && ref.source !== "post_call" && ref.source !== "system") {
    out[existing] = { ...ref, name, description: ref.description || prev.description };
  }
}

function namesFromMapping(raw: string | undefined): string[] {
  return String(raw ?? "")
    .split("\n")
    .flatMap((line) => referencedTemplateVars(line));
}

function namesFromSingleBraces(text: string | undefined): string[] {
  const names: string[] = [];
  const re = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;
  const src = String(text ?? "");
  let match: RegExpExecArray | null;
  while ((match = re.exec(src))) {
    const around = src.slice(Math.max(0, match.index - 1), match.index + match[0].length + 1);
    if (around.startsWith("{{") || around.endsWith("}}")) continue;
    names.push(match[1]!);
  }
  return names;
}

export function collectFlowVariables(
  nodes: FlowNode[],
  declared: BuilderVariable[] = [],
): FlowVariableRef[] {
  const out: FlowVariableRef[] = [];
  const seen = new Map<string, number>();

  for (const sys of SYSTEM_FLOW_VARS) pushUnique(out, seen, { ...sys });

  for (const n of nodes) {
    const d = n.data;
    const label = d.label || n.id;

    if (d.kind === "extract_variable") {
      const list = d.extractVariables ?? [];
      if (list.length) {
        for (const item of list) {
          pushUnique(out, seen, {
            name: item.name,
            source: "extract",
            description: item.description || undefined,
            nodeId: n.id,
            nodeLabel: label,
          });
        }
      } else if (d.variableName) {
        pushUnique(out, seen, {
          name: String(d.variableName),
          source: "extract",
          description: d.variableDescription ? String(d.variableDescription) : undefined,
          nodeId: n.id,
          nodeLabel: label,
        });
      }
    }

    if (d.kind === "http_request") {
      for (const name of namesFromMapping(d.httpResponseMapping)) {
        pushUnique(out, seen, {
          name,
          source: "http",
          description: `Mapped from HTTP "${label}"`,
          nodeId: n.id,
          nodeLabel: label,
        });
      }
    }

    if (d.kind === "wa_extract_var" && d.extractVarName) {
      pushUnique(out, seen, {
        name: String(d.extractVarName),
        source: "whatsapp",
        description: d.extractVarPrompt ? String(d.extractVarPrompt) : undefined,
        nodeId: n.id,
        nodeLabel: label,
      });
    }

    if (d.kind === "wa_template") {
      for (const name of namesFromSingleBraces(d.templateBody)) {
        pushUnique(out, seen, {
          name,
          source: "whatsapp",
          description: `Used in template "${label}"`,
          nodeId: n.id,
          nodeLabel: label,
        });
      }
    }

    if (d.kind === "call_transfer" && d.transferMode === "dynamic" && d.transferDynamicVariable) {
      pushUnique(out, seen, {
        name: String(d.transferDynamicVariable).replace(/[{}]/g, ""),
        source: "transfer",
        description: `Dynamic transfer on "${label}"`,
        nodeId: n.id,
        nodeLabel: label,
      });
    }
  }

  for (const v of declared) {
    pushUnique(out, seen, {
      name: v.name,
      source: "post_call",
      description: v.description || undefined,
    });
  }

  return out;
}

export function definedVariableNames(vars: FlowVariableRef[]): Set<string> {
  return new Set(vars.map((v) => v.name));
}

/** Template fields on a node that the runtime interpolates. */
export function nodeTemplateTexts(node: FlowNode): string[] {
  const d = node.data;
  return [
    d.dialogue,
    d.speechPrefix,
    d.endingPrompt,
    d.smsMessage,
    d.httpUrl,
    d.httpQuery,
    d.httpPathParams,
    d.httpBody,
    d.httpHeaders,
    d.httpAuthValue,
    d.mcpHeaders,
    d.mcpServerUrl,
    d.templateBody,
    ...(d.transitions ?? []).flatMap((t) => [
      t.condition,
      ...(t.equations ?? []).map((c) => `${c.left} ${c.right ?? ""}`),
    ]),
  ]
    .map((v) => String(v ?? ""))
    .filter(Boolean);
}

export function unknownTemplateVars(
  nodes: FlowNode[],
  declared: BuilderVariable[] = [],
): Array<{ name: string; nodeId: string; nodeLabel: string }> {
  const known = definedVariableNames(collectFlowVariables(nodes, declared));
  const hits: Array<{ name: string; nodeId: string; nodeLabel: string }> = [];
  const seen = new Set<string>();
  for (const n of nodes) {
    const names = nodeTemplateTexts(n).flatMap((t) => referencedTemplateVars(t));
    for (const name of names) {
      if (known.has(name)) continue;
      const key = `${n.id}:${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({ name, nodeId: n.id, nodeLabel: n.data.label || n.id });
    }
  }
  return hits;
}

export interface IncompleteVariableToken {
  start: number;
  query: string;
}

/** `{{query` at the cursor that has not been closed with `}}`. */
export function incompleteVariableToken(
  text: string,
  cursor: number,
): IncompleteVariableToken | null {
  const pos = Math.max(0, Math.min(cursor, text.length));
  const before = text.slice(0, pos);
  const idx = before.lastIndexOf("{{");
  if (idx < 0) return null;
  const afterOpen = before.slice(idx + 2);
  if (afterOpen.includes("}}") || afterOpen.includes("\n")) return null;
  if (!/^[a-zA-Z0-9_.]*$/.test(afterOpen)) return null;
  return { start: idx, query: afterOpen };
}

export function filterFlowVariables(
  vars: FlowVariableRef[],
  query: string,
): FlowVariableRef[] {
  const q = query.trim().toLowerCase();
  if (!q) return vars;
  return vars.filter(
    (v) =>
      v.name.toLowerCase().includes(q) ||
      (v.description ?? "").toLowerCase().includes(q) ||
      (v.nodeLabel ?? "").toLowerCase().includes(q),
  );
}

export function insertVariableToken(
  text: string,
  cursor: number,
  name: string,
): { text: string; cursor: number } {
  const token = incompleteVariableToken(text, cursor);
  const insert = `{{${name}}}`;
  if (!token) {
    const next = text.slice(0, cursor) + insert + text.slice(cursor);
    return { text: next, cursor: cursor + insert.length };
  }
  const next = text.slice(0, token.start) + insert + text.slice(cursor);
  return { text: next, cursor: token.start + insert.length };
}

export function sourceLabel(source: FlowVariableSource): string {
  switch (source) {
    case "system":
      return "System";
    case "extract":
      return "Extract";
    case "http":
      return "HTTP";
    case "whatsapp":
      return "WhatsApp";
    case "post_call":
      return "Post-call";
    case "transfer":
      return "Transfer";
  }
}

export interface TestCallField {
  name: string;
  description?: string;
  source: FlowVariableSource | "template";
  suggested: string;
  group: "caller" | "booking" | "flow" | "system";
}

/** Clock / identity values the runtime interpolates if the tester leaves them blank. */
export function suggestTestCallValue(name: string, now: Date = new Date()): string {
  if (name === "current_date") {
    return now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  }
  if (name === "current_time") {
    return now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  }
  if (/^current_time_/i.test(name)) {
    const tz = name.replace(/^current_time_/, "").replace(/_/g, "/");
    try {
      return now.toLocaleString("en-GB", {
        timeZone: tz,
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return now.toLocaleString("en-GB");
    }
  }
  if (name === "user_number") return "web:test";
  return "";
}

const ANALYSIS_ONLY_VARS = new Set([
  "structured_json_output",
  "detailed_call_summary",
  "call_summary",
  "call_successful",
  "user_sentiment",
  "in_voicemail",
  "custom_analysis",
  "email_address",
]);

function isAnalysisPrompt(text: string | undefined): boolean {
  const t = String(text ?? "");
  return (
    t.length > 140 ||
    /you are an expert|output only valid json|call-analysis|extraction,? mapping|analyze the given call/i.test(
      t,
    )
  );
}

function testCallGroup(name: string, source: TestCallField["source"]): TestCallField["group"] {
  if (source === "system" || name === "current_date" || name === "current_time" || /^current_time_/i.test(name)) {
    return "system";
  }
  if (
    /^(first_name|last_name|First_name|email|mobile|phone|user_number|contact_address|postcode_contact)$/i.test(
      name,
    )
  ) {
    return "caller";
  }
  if (/slot|booking|appointment|calendly|callback/i.test(name)) return "booking";
  return "flow";
}

function shortFieldHint(field: {
  description?: string;
  nodeLabel?: string;
  source: TestCallField["source"];
}): string {
  if (field.nodeLabel) return `Used on ${field.nodeLabel}`;
  if (field.description && !isAnalysisPrompt(field.description)) {
    return field.description.length > 72 ? `${field.description.slice(0, 69)}…` : field.description;
  }
  return sourceLabel(field.source === "template" ? "extract" : field.source);
}

/** Fields shown on the test-call form — runtime {{vars}} only, not post-call analysis. */
export function collectTestCallFields(
  nodes: FlowNode[],
  declared: BuilderVariable[] = [],
  now: Date = new Date(),
): TestCallField[] {
  const spokenNames = new Set<string>();
  const usedOn = new Map<string, string>();
  for (const n of nodes) {
    const label = n.data.label || n.id;
    for (const text of nodeTemplateTexts(n)) {
      for (const name of referencedTemplateVars(text)) {
        spokenNames.add(name);
        if (!usedOn.has(name)) usedOn.set(name, label);
      }
    }
  }

  const refs = collectFlowVariables(nodes, declared);
  const extras = unknownTemplateVars(nodes, declared);
  const byName = new Map<string, TestCallField>();
  const declaredByName = new Map(declared.map((v) => [v.name.trim(), v]));

  const include = (name: string, source: TestCallField["source"], description?: string) => {
    if (!name || ANALYSIS_ONLY_VARS.has(name)) return;
    if (name === "call_id" || name === "agent_number") return;
    if (source === "post_call" && !spokenNames.has(name)) return;
    if (isAnalysisPrompt(description) && !spokenNames.has(name)) return;
    const row = declaredByName.get(name);
    const example = String(row?.defaultValue ?? row?.examples?.[0] ?? "").trim();
    const suggested = suggestTestCallValue(name, now) || (isAnalysisPrompt(example) ? "" : example);
    byName.set(name, {
      name,
      description: shortFieldHint({
        description,
        nodeLabel: usedOn.get(name),
        source,
      }),
      source,
      suggested,
      group: testCallGroup(name, source),
    });
  };

  for (const ref of refs) {
    include(ref.name, ref.source, ref.description);
  }
  for (const extra of extras) {
    if (byName.has(extra.name)) continue;
    include(extra.name, "template", extra.nodeLabel ? `Used on ${extra.nodeLabel}` : undefined);
  }

  const groupOrder: Record<TestCallField["group"], number> = {
    caller: 0,
    flow: 1,
    booking: 2,
    system: 3,
  };
  return [...byName.values()].sort((a, b) => {
    const g = groupOrder[a.group] - groupOrder[b.group];
    return g !== 0 ? g : a.name.localeCompare(b.name);
  });
}

export function testCallValuesStorageKey(agentId: string): string {
  return `webee.test-call-vars.${agentId}`;
}
