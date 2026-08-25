/**
 * Conversation graph VM — edge routing.
 *
 * Every transition Retell exports is a natural-language `transition_condition`
 * prompt, so choosing the next node is a classification problem rather than a
 * boolean evaluation. This module is the only place that decides which edge wins,
 * which keeps the cost of routing (one classifier call per decision) visible and
 * lets the cheap deterministic cases short-circuit before any network call.
 *
 * Relative imports only — this module is reachable from vite.config.ts.
 */

import { interpolate } from "./flow";
import type { FlowEdge, LlmMessage, VariableValue, VmLlm } from "./types";

export interface RouteContext {
  /** Conversation so far, oldest first. */
  history: LlmMessage[];
  variables: Record<string, VariableValue>;
  globalPrompt: string;
  model?: string;
}

const DIGIT_WORDS = new Set([
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "oh", "double", "triple",
]);

/** True for normal digit strings and natural spoken phone-number phrasing. */
export function looksLikePhoneAnswer(answer: string): boolean {
  const normalized = answer.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
  const numericCount = (normalized.match(/\d/g) ?? []).length;
  if (numericCount >= 7) return true;
  const numberWords = normalized.split(/\s+/).filter((word) => DIGIT_WORDS.has(word));
  return numberWords.length >= 5;
}

/**
 * Choose deterministic, unambiguous transitions before paying for a classifier.
 * Returns null whenever the answer does not provide enough signal to route safely.
 */
export function tryHeuristicEdgeIndex(conditions: string[], answer: string): number | null {
  const response = answer.trim().toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ");
  if (!response) return null;
  const find = (pattern: RegExp) => conditions.findIndex((condition) => pattern.test(condition.toLowerCase()));
  const firstAnswer = () => find(/\b(?:user|caller)\s+answers?\b|\b(?:gives?|provides?)\b/);

  if (/^(?:yes|yeah|yep|correct|confirmed?|sure|okay|ok|please)\b/.test(response)) {
    const hit = find(/\byes\b|\bconfirm|\bagree|\baccept|\bpositive\b/);
    return hit >= 0 ? hit : null;
  }
  if (/^(?:no|nope|nah|decline|refuse|negative)\b/.test(response)) {
    const hit = find(/\bno\b|\bdeclin|\brefus|\bnegative\b/);
    return hit >= 0 ? hit : null;
  }
  if (looksLikePhoneAnswer(response)) {
    const hit = find(/\bphone\b|\bnumber\b|\bcontact\b/);
    return hit >= 0 ? hit : firstAnswer() >= 0 ? firstAnswer() : null;
  }

  const words = response.split(" ").filter(Boolean);
  const likelyShortName =
    words.length <= 3 &&
    response.length >= 2 &&
    response.length <= 32 &&
    words.every((word) => /^[\p{L}'-]+$/u.test(word));
  if (likelyShortName) {
    const hit = find(/\bname\b|\b(?:user|caller)\s+answers?\b/);
    return hit >= 0 ? hit : null;
  }
  return null;
}

/**
 * Choose an edge.
 *
 * Returns null when no edge applies, leaving the fallback (an `else_edge`, or
 * staying put for another user turn) to the caller — the VM knows which of those
 * is correct for a given node type, the router does not.
 */
export async function selectEdge(
  edges: FlowEdge[],
  ctx: RouteContext,
  llm: VmLlm,
): Promise<FlowEdge | null> {
  const usable = edges.filter((e) => e.destination_node_id);
  if (usable.length === 0) return null;

  // A lone unconditional edge is a plain "continue"; asking a model to confirm
  // that would add a round-trip per node for no information.
  const conditions = usable.map((e) => interpolate(e.transition_condition.prompt.trim(), ctx.variables));
  if (usable.length === 1 && !conditions[0]) return usable[0];
  const lastUserTurn = [...ctx.history].reverse().find((message) => message.role === "user")?.content;
  const heuristicIndex = lastUserTurn ? tryHeuristicEdgeIndex(conditions, lastUserTurn) : null;
  if (heuristicIndex != null) return usable[heuristicIndex] ?? null;

  const choices = conditions.map((c, i) => c || `Continue (option ${i + 1})`);
  let index: number;
  try {
    index = await llm.classify(buildRoutingMessages(ctx), choices, { model: ctx.model });
  } catch {
    // A classifier outage should not strand the call: prefer the first
    // unconditional edge, else the first edge, so the flow keeps moving.
    const unconditional = usable.findIndex((_, i) => !conditions[i]);
    return usable[unconditional >= 0 ? unconditional : 0];
  }

  if (!Number.isInteger(index) || index < 0 || index >= usable.length) return null;
  return usable[index];
}

/**
 * Check whether any global node should pre-empt normal routing.
 *
 * Global nodes are Retell's interrupt handlers ("if the caller asks for a human,
 * jump here") and are evaluated before the current node's own edges.
 */
export async function selectGlobalNode<T extends { condition: string }>(
  globals: T[],
  ctx: RouteContext,
  llm: VmLlm,
): Promise<T | null> {
  if (globals.length === 0) return null;

  const NONE = "None of the above — the conversation is continuing normally";
  const choices = [
    ...globals.map((g) => interpolate(g.condition, ctx.variables)),
    NONE,
  ];

  let index: number;
  try {
    index = await llm.classify(buildRoutingMessages(ctx), choices, { model: ctx.model });
  } catch {
    // Failing closed keeps the caller on the scripted path rather than
    // teleporting them somewhere unexpected.
    return null;
  }

  if (!Number.isInteger(index) || index < 0 || index >= globals.length) return null;
  return globals[index];
}

/**
 * Route a DTMF digit.
 *
 * Digit conditions are usually written literally ("caller presses 2"), so a
 * textual match is both cheaper and more reliable than a classifier here. The
 * model is only consulted for conditions phrased indirectly.
 */
export async function selectDigitEdge(
  edges: FlowEdge[],
  digit: string,
  ctx: RouteContext,
  llm: VmLlm,
): Promise<FlowEdge | null> {
  const usable = edges.filter((e) => e.destination_node_id);
  if (usable.length === 0) return null;

  const pressed = digit.trim();
  if (pressed) {
    // Match the digit as a standalone token so "press 1" does not also match a
    // condition about pressing 11.
    const literal = new RegExp(`(^|[^0-9*#])${escapeRegExp(pressed)}([^0-9*#]|$)`);
    const hit = usable.find((e) => literal.test(e.transition_condition.prompt));
    if (hit) return hit;
  }

  return selectEdge(usable, { ...ctx, history: [...ctx.history, { role: "user", content: `The caller pressed ${pressed}.` }] }, llm);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build the message list a routing decision sees.
 *
 * The global prompt is included because transition conditions routinely lean on
 * business context defined there ("if the caller is an existing customer").
 */
function buildRoutingMessages(ctx: RouteContext): LlmMessage[] {
  const preamble: string[] = [];
  if (ctx.globalPrompt) preamble.push(`# Agent context\n${ctx.globalPrompt}`);

  const known = Object.entries(ctx.variables).filter(
    ([, v]) => v !== null && v !== undefined && v !== "",
  );
  if (known.length) {
    preamble.push(
      `# Known information\n${known.map(([k, v]) => `- ${k}: ${String(v)}`).join("\n")}`,
    );
  }

  const messages: LlmMessage[] = [];
  if (preamble.length) messages.push({ role: "system", content: preamble.join("\n\n") });
  // Recent turns carry the signal for a transition decision; older history mostly
  // adds tokens and, with it, latency.
  messages.push(...ctx.history.slice(-12));
  return messages;
}
