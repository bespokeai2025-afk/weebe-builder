/**
 * Retell-style transition evaluation for WEBEE Native.
 *
 * Evaluation order (cheapest first):
 *   1. Unconditional / empty prompt edges
 *   2. Equation conditions ({{var}} == "value", comparisons)
 *   3. Caller-text heuristics (yes/no, phone, address, …)
 *   4. LLM classifier (ambiguous prompt conditions only)
 *
 * Response generation is separate — this module only picks the next edge/node.
 */

import type { FlowEdge, LlmMessage, VariableValue } from "./types";

export interface TransitionState {
  currentNodeHint?: string;
  globalPrompt?: string;
  variables: Record<string, VariableValue>;
  /** Latest caller utterance only — not the full transcript. */
  latestUserText: string;
  /** Optional one-line agent context (last agent line). */
  lastAgentText?: string;
  /** Short summary of facts already captured in-dialogue. */
  collectedFacts?: string;
}

/** True when the condition looks like a variable equation, not natural language. */
export function isEquationCondition(prompt: string): boolean {
  const p = prompt.trim();
  if (!p) return false;
  if (/^\{\{[^}]+\}\}\s*(==|!=|<=|>=|<|>|=)\s*.+/i.test(p)) return true;
  if (/^\{\{[^}]+\}\}$/.test(p)) return true;
  return false;
}

function parseRhs(raw: string): VariableValue {
  const t = raw.trim();
  if (/^".*"$/.test(t) || /^'.*'$/.test(t)) return t.slice(1, -1);
  if (/^true$/i.test(t)) return true;
  if (/^false$/i.test(t)) return false;
  if (/^null$/i.test(t)) return null;
  const n = Number(t);
  if (!Number.isNaN(n) && t !== "") return n;
  return t;
}

/**
 * Evaluate a Retell-style equation condition against flow variables.
 * Returns null when the prompt is not an equation.
 */
export function evaluateEquationCondition(
  prompt: string,
  variables: Record<string, VariableValue>,
): boolean | null {
  const p = prompt.trim();
  if (!p) return null;

  const bare = p.match(/^\{\{\s*([a-zA-Z0-9_]+)\s*\}\}$/);
  if (bare) {
    const v = variables[bare[1]!];
    return v !== null && v !== undefined && v !== "" && v !== false;
  }

  const m = p.match(
    /^\{\{\s*([a-zA-Z0-9_]+)\s*\}\}\s*(===|!==|==|!=|<=|>=|<|>)\s*(.+)$/i,
  );
  if (!m) return null;

  const left = variables[m[1]!];
  const op = m[2]!.replace("===", "==").replace("!==", "!=");
  const right = parseRhs(m[3]!);

  const ln = typeof left === "number" ? left : Number(left);
  const rn = typeof right === "number" ? right : Number(right);
  const numeric = !Number.isNaN(ln) && !Number.isNaN(rn) && String(left).trim() !== "" && String(right).trim() !== "";

  switch (op) {
    case "==":
      return numeric ? ln === rn : String(left ?? "") === String(right ?? "");
    case "!=":
      return numeric ? ln !== rn : String(left ?? "") !== String(right ?? "");
    case "<":
      return numeric ? ln < rn : false;
    case "<=":
      return numeric ? ln <= rn : false;
    case ">":
      return numeric ? ln > rn : false;
    case ">=":
      return numeric ? ln >= rn : false;
    default:
      return null;
  }
}

/** First edge whose equation condition matches; null if none or no equations. */
export function tryEquationEdge(edges: FlowEdge[], variables: Record<string, VariableValue>): FlowEdge | null {
  for (const edge of edges) {
    if (!edge.destination_node_id) continue;
    const { type, prompt } = edge.transition_condition;
    if (type === "prompt") continue;
    const hit = evaluateEquationCondition(prompt.trim(), variables);
    if (hit === true) return edge;
  }
  return null;
}

/**
 * Minimal routing context for the classifier — last exchange only, not full history.
 * Retell-style: router answers "given current step + latest reply, which edge?"
 */
export function buildCompactRoutingMessages(state: TransitionState): LlmMessage[] {
  const parts: string[] = [
    "You are routing a voice call. Pick exactly one transition for the caller's latest reply.",
  ];
  if (state.currentNodeHint) parts.push(`Current step: ${state.currentNodeHint}`);
  if (state.collectedFacts) parts.push(`Already collected: ${state.collectedFacts}`);
  const known = Object.entries(state.variables).filter(
    ([, v]) => v !== null && v !== undefined && v !== "",
  );
  if (known.length > 0 && known.length <= 10) {
    parts.push(`Variables: ${known.map(([k, v]) => `${k}=${String(v)}`).join(", ")}`);
  }
  if (state.globalPrompt) {
    const brief = state.globalPrompt.trim();
    parts.push(`Agent context: ${brief.length > 200 ? `${brief.slice(0, 200)}…` : brief}`);
  }

  const messages: LlmMessage[] = [{ role: "system", content: parts.join("\n") }];
  if (state.lastAgentText?.trim()) {
    messages.push({ role: "assistant", content: state.lastAgentText.trim() });
  }
  messages.push({ role: "user", content: state.latestUserText.trim() || "(silence)" });
  return messages;
}

/** Keyword fast-path for global interrupt nodes before LLM classification. */
export function tryHeuristicGlobalIndex(conditions: string[], userText: string): number | null {
  const t = userText.trim().toLowerCase();
  if (!t) return null;

  const rules: Array<{ re: RegExp; edgeRe: RegExp }> = [
    { re: /\b(human|real person|someone else|representative|operator|agent|manager|supervisor)\b/, edgeRe: /human|representative|agent|operator|transfer|speak to/i },
    { re: /\b(transfer|connect me|put me through)\b/, edgeRe: /transfer|connect|human/i },
    { re: /\b(not interested|stop calling|don't call|do not call|remove me|opt out)\b/, edgeRe: /not interested|opt out|stop|remove/i },
    { re: /\b(wrong number|who is this|what company)\b/, edgeRe: /wrong number|who is this|company/i },
    { re: /\b(complaint|speak to someone|talk to someone)\b/, edgeRe: /complaint|human|transfer/i },
  ];

  for (const { re, edgeRe } of rules) {
    if (!re.test(t)) continue;
    for (let i = 0; i < conditions.length; i++) {
      if (edgeRe.test(conditions[i] ?? "")) return i;
    }
  }
  return null;
}
