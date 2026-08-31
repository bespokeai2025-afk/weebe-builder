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
import {
  looksLikeFloorAnswer,
  looksLikePropertyTypeAnswer,
  looksLikeTenureAnswer,
  userDeniesRented,
} from "./stt-clarification.shared";
import { summarizeCollectedFacts } from "./collected-facts.shared";
import {
  buildCompactRoutingMessages,
  isEquationCondition,
  tryEquationEdge,
  tryHeuristicGlobalIndex,
  type TransitionState,
} from "./transition-engine.shared";
import type { RouteMethod } from "./latency-trace";
import type { FlowEdge, LlmMessage, VariableValue, VmLlm } from "./types";

export type { RouteMethod } from "./latency-trace";

export interface RouteContext {
  /** Conversation so far, oldest first. */
  history: LlmMessage[];
  variables: Record<string, VariableValue>;
  globalPrompt: string;
  /** Short label for the node being routed from. */
  currentNodeHint?: string;
  /** Per-node classifier override (fast vs strong). */
  classifierModel?: string;
}

export interface EdgeRouteDecision {
  edge: FlowEdge | null;
  method: RouteMethod;
}

export interface GlobalRouteDecision<T> {
  hit: T | null;
  method: RouteMethod;
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
): Promise<EdgeRouteDecision> {
  let usable = edges.filter((e) => e.destination_node_id);
  if (usable.length === 0) return { edge: null, method: "none" };

  let conditions = usable.map((e) => interpolate(e.transition_condition.prompt.trim(), ctx.variables));
  const userText = lastUserText(ctx.history);
  const lastAgentText = lastAssistantText(ctx.history);

  // Repair turns ("what?", "pardon?") stay on the current node — Retell does not
  // treat them as a transition.
  if (looksLikeRepairRequest(userText)) return { edge: null, method: "none" };

  const isTimeoutCondition = (c: string) =>
    /^(timeout|silence|no.?input|no.?response)$/i.test(c.trim());

  // Silence / wait-timeout edges fire only when the caller said nothing.
  if (!userText.trim()) {
    const timeoutIdx = conditions.findIndex(isTimeoutCondition);
    if (timeoutIdx >= 0) return { edge: usable[timeoutIdx]!, method: "unconditional" };
  } else {
    usable = usable.filter((_, i) => !isTimeoutCondition(conditions[i]!));
    if (usable.length === 0) return { edge: null, method: "none" };
    conditions = usable.map((e) => interpolate(e.transition_condition.prompt.trim(), ctx.variables));
  }

  // 1. Always edge — Retell skips every other check once the caller has spoken.
  const alwaysIdx = conditions.findIndex((c) => edgeIsAlwaysCondition(c));
  if (alwaysIdx >= 0 && userText.trim()) {
    return { edge: usable[alwaysIdx]!, method: "unconditional" };
  }

  // 2. Lone unconditional edge — no classifier needed.
  if (usable.length === 1 && !conditions[0]) {
    return { edge: usable[0]!, method: "unconditional" };
  }

  // 3. Equation conditions (Retell logic-split style) — deterministic, zero LLM cost.
  const equationHit = tryEquationEdge(usable, ctx.variables);
  if (equationHit) return { edge: equationHit, method: "equation" };

  // 4. Single edge with generic/any-answer/placeholder prompt + substantive caller reply.
  if (usable.length === 1 && userText.trim() && !looksLikeRepairRequest(userText)) {
    const only = conditions[0]?.toLowerCase() ?? "";
    if (
      edgeExpectsGenericContinuation(only) ||
      edgeIsAnyAnswerEdge(only) ||
      edgeIsPlaceholderCondition(only)
    ) {
      return { edge: usable[0]!, method: "generic_single" };
    }
  }

  // 4. If every edge is an equation and none matched, do not fall through to LLM.
  if (conditions.length > 0 && conditions.every(isEquationCondition)) {
    const elseIdx = usable.findIndex((_, i) => /^(else|default|other)$/i.test(conditions[i] ?? ""));
    return {
      edge: elseIdx >= 0 ? usable[elseIdx]! : null,
      method: elseIdx >= 0 ? "equation_else" : "none",
    };
  }

  // 5. Heuristic text matching (yes/no, phrase overlap, interrupt, …).
  const choices = conditions.map((c, i) => c || `Continue (option ${i + 1})`);
  const heuristic = tryHeuristicEdgeIndex(conditions, userText, lastAgentText);
  if (heuristic !== null) return { edge: usable[heuristic]!, method: "heuristic" };

  // 6. Ambiguous prompt conditions only — compact context, per-node classifier.
  let index: number;
  try {
    index = await llm.classify(buildTransitionState(ctx), choices, {
      model: ctx.classifierModel,
    });
  } catch {
    const unconditional = usable.findIndex((_, i) => !conditions[i]);
    return {
      edge: unconditional >= 0 ? usable[unconditional]! : null,
      method: unconditional >= 0 ? "unconditional" : "none",
    };
  }

  if (!Number.isInteger(index) || index < 0 || index >= usable.length) {
    const scored = pickBestScoredEdge(conditions, userText, lastAgentText, 2);
    return {
      edge: scored !== null ? usable[scored]! : null,
      method: scored !== null ? "heuristic" : "none",
    };
  }
  return { edge: usable[index]!, method: "llm" };
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
): Promise<GlobalRouteDecision<T>> {
  if (globals.length === 0) return { hit: null, method: "global_skip" };

  const userText = lastUserText(ctx.history);
  if (!looksLikeGlobalInterrupt(userText)) return { hit: null, method: "global_skip" };

  const conditions = globals.map((g) => interpolate(g.condition, ctx.variables));

  const heuristicGlobal = tryHeuristicGlobalIndex(conditions, userText);
  if (heuristicGlobal !== null) {
    return { hit: globals[heuristicGlobal]!, method: "global_heuristic" };
  }

  const NONE = "None of the above — the conversation is continuing normally";
  const choices = [...conditions, NONE];

  let index: number;
  try {
    index = await llm.classify(buildTransitionState(ctx), choices, {
      model: ctx.classifierModel,
    });
  } catch {
    return { hit: null, method: "none" };
  }

  if (!Number.isInteger(index) || index < 0 || index >= globals.length) {
    return { hit: null, method: "none" };
  }
  return { hit: globals[index]!, method: "global_llm" };
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

  return selectEdge(usable, { ...ctx, history: [...ctx.history, { role: "user", content: `The caller pressed ${pressed}.` }] }, llm).then(
    (d) => d.edge,
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build compact routing state — last user line + variables, not full transcript.
 */
function buildTransitionState(ctx: RouteContext): LlmMessage[] {
  let lastAgentText = "";
  for (let i = ctx.history.length - 1; i >= 0; i--) {
    const msg = ctx.history[i];
    if (msg.role === "assistant") {
      lastAgentText = msg.content;
      break;
    }
  }

  const state: TransitionState = {
    currentNodeHint: ctx.currentNodeHint,
    globalPrompt: ctx.globalPrompt ? truncatePrompt(ctx.globalPrompt, 240) : undefined,
    variables: ctx.variables,
    latestUserText: lastUserText(ctx.history),
    lastAgentText,
    collectedFacts: summarizeCollectedFacts(ctx.history) || undefined,
  };
  return buildCompactRoutingMessages(state);
}

function truncatePrompt(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`;
}

function lastAssistantText(history: LlmMessage[]): string {
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.role === "assistant") return msg.content.trim();
  }
  return "";
}

function lastUserText(history: LlmMessage[]): string {
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.role === "user") return msg.content.trim();
  }
  return "";
}

/** Spelled-out or digit phone numbers — common in voice (e.g. "double nine six…"). */
export function looksLikePhoneAnswer(userText: string): boolean {
  const t = userText.trim();
  if (!t) return false;
  const compact = t.replace(/[\s().-]/g, "");
  if (/\d{4,}/.test(compact)) return true;
  if (/^\+?\d[\d\s().-]{5,}\d$/.test(t)) return true;

  const numberWords =
    t.match(/\b(zero|oh|o|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|double|triple|quadruple)\b/gi) ??
    [];
  return numberWords.length >= 3;
}

function edgeExpectsPhone(condition: string): boolean {
  return /\b(phone|mobile|contact|number|callback|telephone|cell|reach you|call you back|digits)\b/.test(
    condition.toLowerCase(),
  );
}

function edgeExpectsEmail(condition: string): boolean {
  return /\b(e-?mail|mail address|inbox)\b/.test(condition.toLowerCase());
}

/** Spoken or typed email — "name at gmail dot com" or foo@bar.com. */
export function looksLikeEmailAnswer(userText: string): boolean {
  const t = userText.trim();
  if (!t) return false;
  if (/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(t)) return true;
  return /\b\S+\s+at\s+\S+\s+(dot|\.)\s*\S+/i.test(t);
}

function edgeExpectsAddress(condition: string): boolean {
  return /\b(address|postcode|post code|zip|location|property|where (?:do you|are you)|live|street|city|town|suburb)\b/.test(
    condition.toLowerCase(),
  );
}

/** Street / city / postcode answers common in qualification flows. */
export function looksLikeAddressAnswer(userText: string): boolean {
  const t = userText.trim();
  if (!t || t.length < 8 || looksLikePhoneAnswer(t)) return false;
  const hasStreetCue =
    /\b(street|st\.?|road|rd\.?|avenue|ave\.?|lane|ln\.?|drive|dr\.?|court|ct\.?|way|place|pl\.?|boulevard|blvd\.?|close|crescent|terrace|gardens|park|house|flat|apartment|apt\.?)\b/i.test(
      t,
    );
  const hasPostcode = /\b[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}\b/i.test(t);
  const commaParts = t.split(",").filter((p) => p.trim().length > 2);
  if (hasPostcode) return true;
  if (hasStreetCue && commaParts.length >= 1) return true;
  if (commaParts.length >= 2) return true;
  if (hasStreetCue && t.split(/\s+/).length >= 3) return true;
  return false;
}

function startsWithAffirmative(t: string): boolean {
  return /^(yes|yeah|yep|yup|yea|sim|si|sí|sure|ok|okay|correct|right|absolutely|definitely|of course|please|go ahead|sounds good|that works|mm[\s-]?hm|uh[\s-]?huh|y)\b/i.test(
    t,
  );
}

function startsWithNegative(t: string): boolean {
  return /^(no|nope|nah|not really|negative|pass)\b/i.test(t);
}

/** Edge condition that ends the call or opts the caller out — must not match on generic data answers. */
export function edgeIsTerminalOrOptOutCondition(condition: string): boolean {
  const c = condition.toLowerCase();
  return (
    /\b(not interested|opt out|stop calling|end call|hang up|goodbye|good bye|end conversation|finish call|decline|reject call|do not call|wrong number)\b/.test(
      c,
    ) ||
    /\b(user (?:wants to )?(?:end|finish|leave|hang up)|caller (?:wants to )?(?:end|finish|hang up))\b/.test(
      c,
    )
  );
}

export function edgeIsAlwaysCondition(condition: string): boolean {
  const c = condition.trim().toLowerCase();
  return c === "always" || c === "unconditional" || c === "always edge";
}

export function edgeIsElseCondition(condition: string): boolean {
  const c = condition.trim().toLowerCase();
  return c === "else" || c === "otherwise" || c === "fallback";
}

function edgeIsPlaceholderCondition(condition: string): boolean {
  return /^describe the (condition|transition)/i.test(condition.trim());
}

export function edgeIsSkipAheadCondition(condition: string): boolean {
  const c = condition.toLowerCase();
  return /\b(all (?:the )?details|everything (?:is )?collected|appointment|booked|skip (?:to|ahead|rest)|wrap up|close (?:the )?call|end of (?:the )?flow|finished collecting|no more questions|that's all we need|consultant will call|scheduled time|goodbye|good bye)\b/.test(
    c,
  );
}

export function userSignalsCallEnd(userText: string): boolean {
  const t = userText.trim().toLowerCase();
  return /\b(goodbye|bye|not interested|stop calling|hang up|end call|no thanks|don't call|do not call|remove me|opt out)\b/.test(
    t,
  );
}

export function userSignalsDecline(userText: string): boolean {
  const t = userText.trim().toLowerCase();
  return (
    /^(no|nope|nah|not really|negative|pass)$/i.test(t) ||
    /\b(not interested|don't want|do not want|no thanks|not now|not today)\b/.test(t)
  );
}

function heuristicEdgeAllowed(condition: string, userText: string, allowTerminal = false): boolean {
  if (allowTerminal || !edgeIsTerminalOrOptOutCondition(condition)) return true;
  return userSignalsCallEnd(userText) || userSignalsDecline(userText);
}

function pickHeuristicEdge(
  conditions: string[],
  userText: string,
  matches: (condition: string) => boolean,
  options: { allowTerminal?: boolean } = {},
): number | null {
  for (let i = 0; i < conditions.length; i++) {
    const condition = conditions[i] ?? "";
    if (!matches(condition)) continue;
    if (!heuristicEdgeAllowed(condition, userText, options.allowTerminal)) continue;
    return i;
  }
  return null;
}

/** Edge expects the caller to continue / provide info (not a rejection path). */
function edgeExpectsGenericContinuation(condition: string): boolean {
  return /\b(user answers?|user gives details|any answer|any acknowledgement|provided|caller provides|gives? (?:contact|info|details))\b/.test(
    condition.toLowerCase(),
  );
}

function edgeIsAnyAnswerEdge(condition: string): boolean {
  const c = condition.trim().toLowerCase();
  return (
    c === "any answer" ||
    c === "any acknowledgement" ||
    c === "any acknowledgment" ||
    edgeIsPlaceholderCondition(c)
  );
}

/** Affirmative edge — excludes negated prompts like "not interested" / "not available". */
function edgeExpectsAffirmative(condition: string): boolean {
  const c = condition.toLowerCase();
  if (/\bnot (interested|available|sure|really)\b/.test(c)) return false;
  if (/\b(no|negative|declin|reject|refus|unavailable|wrong name|incorrect name)\b/.test(c)) {
    return false;
  }
  return /\b(yes|positive|affirm|confirm(?:s|ed|ing)?|correct|agree|available|interested|helpful|proceed|continue|live in|owner|occupied|rented|vacant|same as|matches|title deed|documents?)\b/.test(
    c,
  );
}

function edgeExpectsPropertyType(condition: string): boolean {
  return /\b(property type|flat|house|bungalow|apartment)\b/.test(condition.toLowerCase());
}

function edgeExpectsTenure(condition: string): boolean {
  return /\b(vacant|rented|tenanted|owner.?occupied|living there|live there)\b/.test(
    condition.toLowerCase(),
  );
}

function edgeExpectsVacant(condition: string): boolean {
  return /\bvacant\b/.test(condition.toLowerCase());
}

function edgeExpectsRented(condition: string): boolean {
  const c = condition.toLowerCase();
  if (/\bnot (rented|tenanted)\b/.test(c)) return false;
  return /\b(rented|tenanted)\b/.test(c);
}

function lastAgentAskedRented(agentText: string): boolean {
  return /\b(rented|tenanted|let out)\b/i.test(agentText);
}

function lastAgentAskedVacantOrRented(agentText: string): boolean {
  const a = agentText.toLowerCase();
  return (
    /\bvacant or (rented|tenanted)\b/.test(a) ||
    (/\bvacant\b/.test(a) && /\b(rented|tenanted)\b/.test(a))
  );
}

function pickNonRentedTenureEdge(conditions: string[], userText: string): number | null {
  if (/\b(live|living|owner.?occupied)\b/i.test(userText)) {
    for (let i = 0; i < conditions.length; i++) {
      if (edgeExpectsOwnerOccupied(conditions[i] ?? "")) return i;
    }
  }
  for (let i = 0; i < conditions.length; i++) {
    if (edgeExpectsVacant(conditions[i] ?? "")) return i;
  }
  for (let i = 0; i < conditions.length; i++) {
    if (edgeExpectsOwnerOccupied(conditions[i] ?? "")) return i;
  }
  for (let i = 0; i < conditions.length; i++) {
    const c = conditions[i] ?? "";
    if (edgeExpectsTenure(c) && !edgeExpectsRented(c)) return i;
  }
  return null;
}

function edgeExpectsOwnerOccupied(condition: string): boolean {
  return /\b(living there|live there|owner.?occupied|im living)\b/.test(condition.toLowerCase());
}

function edgeExpectsPropertyOwner(condition: string): boolean {
  const c = condition.toLowerCase();
  if (/\bon behalf\b/.test(c)) return false;
  return /\b(property owner|are you the owner|owns? the property|you(?:r|'re)? the owner|caller is the owner|user is the owner)\b/.test(
    c,
  ) || (/\bowner\b/.test(c) && !/\bowner.?occupied\b/.test(c) && !/\bliving\b/.test(c));
}

function edgeExpectsOnBehalf(condition: string): boolean {
  return /\bon behalf\b/.test(condition.toLowerCase());
}

function edgeExpectsTitle(condition: string): boolean {
  return /\b(preferred title|title is|mr,?\s*mrs|mister|salutation)\b/.test(condition.toLowerCase());
}

/** "I am the owner" / "calling on behalf" — not vacant vs rented. */
export function looksLikeOwnerAnswer(userText: string): boolean {
  return /\b(i am (the )?owner|i'm (the )?owner|im (the )?owner|i own (it|this|the)|owner of (the |this )?property|calling on behalf|on behalf of)\b/i.test(
    userText,
  );
}

export function looksLikeTitleAnswer(userText: string): boolean {
  return /^(mr|mrs|miss|ms|mister|dr|doctor|mx|sir|madam)\b\.?$/i.test(userText.trim());
}

function edgeExpectsFloor(condition: string): boolean {
  return /\bfloor\b/.test(condition.toLowerCase());
}

function isShortAcknowledgement(t: string): boolean {
  return /^(yes|yeah|yep|yup|yea|sim|si|sí|sure|ok|okay|correct|right|absolutely|definitely|of course|please|go ahead|sounds good|that works|mm[\s-]?hm|uh[\s-]?huh|y)$/i.test(
    t,
  );
}

/** Edge expects the caller to supply their name — not "wrong name" objections. */
function edgeExpectsNameProvided(condition: string): boolean {
  const c = condition.toLowerCase();
  if (/\b(wrong name|incorrect name|not my name|not me|bad name)\b/.test(c)) return false;
  return /\b(correct name|tells us the|tell us the|gives? (?:us )?(?:their |his |her )?name|first name|your name|good name|introduc|spell(?:ing)?|called)\b/.test(
    c,
  );
}

export function looksLikeRepairRequest(userText: string): boolean {
  const t = userText
    .trim()
    .toLowerCase()
    .replace(/[.!?,]+$/g, "");
  return /^(what|huh|pardon|sorry|come again|say that again|say again|repeat(?: that)?|what was that|i didn't (?:catch|hear|get) that|i did not (?:catch|hear|get) that)$/i.test(
    t,
  );
}

export function looksLikeNameAnswer(userText: string): boolean {
  const t = userText.trim().replace(/[.!?]+$/g, "");
  if (!t || looksLikePhoneAnswer(t) || looksLikeRepairRequest(t)) return false;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 4 || t.length < 2) return false;
  if (
    /^(what|why|who|huh|wait|sorry|pardon|ok|okay|yes|yeah|yep|no|nope|hi|hello|hey)$/i.test(t)
  ) {
    return false;
  }
  return /^[\p{L}\s'.-]+$/u.test(t);
}

/**
 * Retell-style fast path: skip the global classifier unless the caller might be
 * triggering an interrupt handler (human, stop, transfer, …).
 */
export function looksLikeGlobalInterrupt(userText: string): boolean {
  const t = userText.trim().toLowerCase();
  if (!t) return false;
  return /\b(human|agent|representative|operator|manager|supervisor|real person|someone else|transfer|stop calling|don't call|do not call|not interested|remove me|opt out|complaint|speak to|talk to a|talk to someone|connect me|wrong number|who is this|what company|are you a bot|are you real)\b/.test(
    t,
  );
}

function collapseRepeatedAck(userText: string): string {
  const tokens = userText
    .trim()
    .toLowerCase()
    .replace(/[.!?,]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return userText.trim().toLowerCase();
  const ack = /^(yes|yeah|yep|yup|sure|ok|okay|correct|right|y)$/i;
  if (tokens.every((w) => ack.test(w))) return tokens[0]!.toLowerCase();
  return userText.trim().toLowerCase().replace(/[.!?,]+$/g, "");
}

function scoreConditionAgainstAgent(condition: string, agentText: string): number {
  if (!agentText.trim()) return 0;
  const agent = agentText.toLowerCase();
  const words = condition
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 3 && !/^(user|caller|says?|said|that|this|with|from|have|been)$/.test(w));
  return words.reduce((score, word) => (agent.includes(word) ? score + 1 : score), 0);
}

function pickYesEdge(
  conditions: string[],
  userText: string,
  lastAgentText: string,
): number | null {
  const hits: number[] = [];
  for (let i = 0; i < conditions.length; i++) {
    const condition = conditions[i] ?? "";
    if (!edgeExpectsAffirmative(condition)) continue;
    if (edgeIsSkipAheadCondition(condition)) continue;
    if (!heuristicEdgeAllowed(condition, userText)) continue;
    hits.push(i);
  }
  if (hits.length === 0) return null;
  if (hits.length === 1) return hits[0]!;
  let best: number | null = null;
  let bestScore = 0;
  for (const i of hits) {
    const score = scoreConditionAgainstAgent(conditions[i] ?? "", lastAgentText);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  if (bestScore >= 1 && best !== null) return best;
  return pickMostDirectYesEdge(hits, conditions);
}

/** Prefer "yes it is" over a long "if variables … and client says yes" prompt. */
function pickMostDirectYesEdge(hits: number[], conditions: string[]): number {
  let best = hits[0]!;
  let bestRank = Number.NEGATIVE_INFINITY;
  for (const i of hits) {
    const rank = yesEdgeDirectness(conditions[i] ?? "");
    if (rank > bestRank) {
      bestRank = rank;
      best = i;
    }
  }
  return best;
}

function yesEdgeDirectness(condition: string): number {
  const c = condition.toLowerCase().replace(/\s+/g, " ").trim();
  let n = 0;
  if (/^yes\b/.test(c)) n += 8;
  if (/^(yes|yeah|yep|sure|ok|okay)\b/.test(c)) n += 3;
  if (/\b(yes it is|yes of course|any acknowledgment|any acknowledgement|positive)\b/.test(c)) {
    n += 3;
  }
  if (looksLikeCallerQuestionCondition(c)) n -= 12;
  if (/\bvariables?\b/.test(c) || /\{\{/.test(condition)) n -= 4;
  n -= Math.min(6, Math.floor(c.split(/\s+/).filter(Boolean).length / 3));
  return n;
}

function looksLikeCallerQuestionCondition(condition: string): boolean {
  const c = condition.toLowerCase();
  return (
    /\?/.test(c) ||
    /\b(how long|how much|what if|why|when will|can i ask|asks? (?:a |the )?question)\b/.test(c)
  );
}

/** When the caller said yes, pick the edge whose wording matches what was just asked. */
function pickBestScoredEdge(
  conditions: string[],
  userText: string,
  lastAgentText: string,
  minScore: number,
): number | null {
  if (!lastAgentText.trim()) return null;
  let best: number | null = null;
  let bestScore = 0;
  for (let i = 0; i < conditions.length; i++) {
    const condition = conditions[i] ?? "";
    if (!condition.trim() || edgeIsElseCondition(condition) || edgeIsAlwaysCondition(condition)) {
      continue;
    }
    if (edgeIsSkipAheadCondition(condition)) continue;
    if (!heuristicEdgeAllowed(condition, userText)) continue;
    const score = scoreConditionAgainstAgent(condition, lastAgentText);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return bestScore >= minScore ? best : null;
}

/**
 * Skip the classifier for obvious yes/no/ok answers — saves ~1–3s per turn on
 * typical qualification flows where most edges are affirmative/negative prompts.
 */
export function tryHeuristicEdgeIndex(
  conditions: string[],
  userText: string,
  lastAgentText = "",
): number | null {
  const t = collapseRepeatedAck(userText);
  if (!t || looksLikeRepairRequest(userText)) return null;

  const YES =
    /^(yes|yeah|yep|yup|yea|sim|si|sí|sure|ok|okay|correct|right|absolutely|definitely|of course|please|go ahead|sounds good|that works|mm[\s-]?hm|uh[\s-]?huh|y)$/i;
  const NO = /^(no|nope|nah|not really|negative|pass)$/i;
  const CONTINUE =
    /^(continue|proceed|next|go on|keep going|sure thing|that's fine|fine|alright|all right)$/i;

  if (YES.test(t) || startsWithAffirmative(t)) {
    const yesHit = pickYesEdge(conditions, userText, lastAgentText);
    if (yesHit !== null) return yesHit;
    // Do not score the agent's monologue against sibling edges ("how long will
    // it take?" matches "take down some details"). A short yes only follows
    // an affirmative / single-continue edge.
    const continueOnly: number[] = [];
    for (let i = 0; i < conditions.length; i++) {
      const c = conditions[i] ?? "";
      if (!c.trim()) continue;
      if (edgeIsSkipAheadCondition(c) || edgeIsTerminalOrOptOutCondition(c)) continue;
      if (edgeIsElseCondition(c)) continue;
      if (looksLikeCallerQuestionCondition(c)) continue;
      const lower = c.toLowerCase();
      if (/\b(no|negative|declin|reject|refus|unavailable)\b/.test(lower) && !edgeExpectsAffirmative(c)) {
        continue;
      }
      continueOnly.push(i);
    }
    if (continueOnly.length === 1) return continueOnly[0]!;
    return null;
  }

  for (let i = 0; i < conditions.length; i++) {
    const c = conditions[i]?.toLowerCase() ?? "";
    if (!c) continue;
    if ((NO.test(t) || startsWithNegative(t)) && /\b(no|negative|declin|reject|not|unavailable|refus)\b/.test(c)) {
      return i;
    }
    if (CONTINUE.test(t) && /\b(continue|proceed|next|move on|go ahead)\b/.test(c)) {
      return i;
    }
  }

  // "No" / "not rented" after a rented question must not take the rented edge.
  if (userDeniesRented(userText) || ((NO.test(t) || startsWithNegative(t)) && lastAgentAskedRented(lastAgentText))) {
    if (lastAgentAskedVacantOrRented(lastAgentText) && NO.test(t) && !userDeniesRented(userText)) {
      return null;
    }
    const nonRented = pickNonRentedTenureEdge(conditions, userText);
    if (nonRented !== null) return nonRented;
    return null;
  }

  if (userSignalsCallEnd(userText) || userSignalsDecline(userText)) {
    const terminal = pickHeuristicEdge(
      conditions,
      userText,
      (condition) => edgeIsTerminalOrOptOutCondition(condition),
      { allowTerminal: true },
    );
    if (terminal !== null) return terminal;
  }

  // Short acks on generic / any-answer edges — skip classifier (~1–2 s).
  if (isShortAcknowledgement(t) || startsWithAffirmative(t)) {
    const ack = pickHeuristicEdge(conditions, userText, (condition) => {
      const c = condition.trim().toLowerCase();
      if (edgeIsSkipAheadCondition(condition)) return false;
      return edgeExpectsGenericContinuation(condition) || edgeIsAnyAnswerEdge(c);
    });
    if (ack !== null) return ack;
  }

  // Property type answers.
  if (looksLikePropertyTypeAnswer(userText)) {
    const property = pickHeuristicEdge(conditions, userText, (condition) =>
      edgeExpectsPropertyType(condition),
    );
    if (property !== null) return property;
  }

  // Vacant / rented / owner-occupied.
  if (looksLikeTenureAnswer(userText) || userDeniesRented(userText)) {
    if (userDeniesRented(userText)) {
      const nonRented = pickNonRentedTenureEdge(conditions, userText);
      if (nonRented !== null) return nonRented;
      return null;
    }
    if (/\b(rented|tenanted|tenant)\b/i.test(userText)) {
      for (let i = 0; i < conditions.length; i++) {
        if (edgeExpectsRented(conditions[i] ?? "")) return i;
      }
    }
    if (/\b(vacant|empty|unoccupied)\b/i.test(userText)) {
      for (let i = 0; i < conditions.length; i++) {
        if (edgeExpectsVacant(conditions[i] ?? "")) return i;
      }
    }
    if (/\b(live|living|owner.?occupied)\b/i.test(userText)) {
      for (let i = 0; i < conditions.length; i++) {
        if (edgeExpectsOwnerOccupied(conditions[i] ?? "")) return i;
      }
    }
    for (let i = 0; i < conditions.length; i++) {
      if (edgeExpectsTenure(conditions[i] ?? "")) return i;
    }
  }

  if (looksLikeOwnerAnswer(userText)) {
    if (/\bon behalf\b/i.test(userText)) {
      const behalf = pickHeuristicEdge(conditions, userText, (c) => edgeExpectsOnBehalf(c));
      if (behalf !== null) return behalf;
    } else {
      const owner = pickHeuristicEdge(conditions, userText, (c) => edgeExpectsPropertyOwner(c));
      if (owner !== null) return owner;
    }
  }

  if (looksLikeTitleAnswer(userText)) {
    const title = pickHeuristicEdge(conditions, userText, (c) => edgeExpectsTitle(c));
    if (title !== null) return title;
    const generic = pickHeuristicEdge(conditions, userText, (c) => edgeExpectsGenericContinuation(c));
    if (generic !== null) return generic;
  }

  // Floor answers (first, second, ground, …).
  if (looksLikeFloorAnswer(userText)) {
    for (let i = 0; i < conditions.length; i++) {
      if (edgeExpectsFloor(conditions[i] ?? "")) return i;
    }
    for (let i = 0; i < conditions.length; i++) {
      const c = conditions[i]?.toLowerCase() ?? "";
      if (/\b(user answers?|detail|floor)\b/.test(c)) return i;
    }
  }

  // Short name-like answers — must not match "wrong name" edges by substring.
  if (looksLikeNameAnswer(userText)) {
    for (let i = 0; i < conditions.length; i++) {
      if (edgeExpectsNameProvided(conditions[i] ?? "")) return i;
    }
    for (let i = 0; i < conditions.length; i++) {
      const c = conditions[i]?.toLowerCase() ?? "";
      if (/\buser answers?\b/.test(c)) return i;
    }
  }

  if (looksLikeEmailAnswer(userText)) {
    const email = pickHeuristicEdge(conditions, userText, (condition) =>
      edgeExpectsEmail(condition),
    );
    if (email !== null) return email;
    if (!conditions.some((condition) => edgeExpectsEmail(condition))) {
      const generic = pickHeuristicEdge(conditions, userText, (condition) =>
        edgeExpectsGenericContinuation(condition),
      );
      if (generic !== null) return generic;
    }
  }

  // Spelled-out or digit phone numbers when an edge expects contact info.
  if (looksLikePhoneAnswer(userText)) {
    const phone = pickHeuristicEdge(conditions, userText, (condition) =>
      edgeExpectsPhone(condition),
    );
    if (phone !== null) return phone;
    // No dedicated phone edge — fall back to generic continuation (e.g. start node).
    if (!conditions.some((condition) => edgeExpectsPhone(condition))) {
      const generic = pickHeuristicEdge(conditions, userText, (condition) =>
        edgeExpectsGenericContinuation(condition),
      );
      if (generic !== null) return generic;
    }
  }

  if (looksLikeAddressAnswer(userText)) {
    const address = pickHeuristicEdge(conditions, userText, (condition) =>
      edgeExpectsAddress(condition),
    );
    if (address !== null) return address;
    const addressDetail = pickHeuristicEdge(conditions, userText, (condition) =>
      /\b(address|property|location|postcode|post code|detail|confirm|provided|information|where)\b/.test(
        condition.toLowerCase(),
      ),
    );
    if (addressDetail !== null) return addressDetail;
    if (!conditions.some((condition) => edgeExpectsAddress(condition))) {
      const generic = pickHeuristicEdge(conditions, userText, (condition) =>
        edgeExpectsGenericContinuation(condition),
      );
      if (generic !== null) return generic;
    }
  }

  // Owner-occupied / tenancy one-liners ("I live in it", "it's rented").
  if (
    looksLikeTenureAnswer(userText) ||
    /\b(i live in|we live in|owner.?occupied|it's rented|it is rented|tenant|vacant|empty property)\b/i.test(
      userText,
    )
  ) {
    if (userDeniesRented(userText)) {
      const nonRented = pickNonRentedTenureEdge(conditions, userText);
      if (nonRented !== null) return nonRented;
      return null;
    }
    for (let i = 0; i < conditions.length; i++) {
      const c = conditions[i]?.toLowerCase() ?? "";
      if (/\b(owner|occupied|rent|tenant|vacant|live|tenure|property)\b/.test(c)) return i;
    }
  }

  // Numeric / detail answers (price, floor, size, bedrooms) — never jump to hang-up edges.
  if (
    /\d/.test(t) ||
    /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|double|triple|zero|oh|million|thousand|hundred|floor|bhk|b h k)\b/.test(
      t,
    )
  ) {
    const numeric = pickHeuristicEdge(conditions, userText, (condition) =>
      /\b(price|amount|floor|size|bedroom|unit|square|phone|mobile|contact|callback|bedrooms|sqft|square feet)\b/.test(
        condition.toLowerCase(),
      ),
    );
    if (numeric !== null) return numeric;
  }

  const phrase = pickBestPhraseEdge(conditions, userText);
  if (phrase !== null) return phrase;

  if (looksLikeCallerQuestion(userText) || looksLikeMidFlowInterrupt(userText)) {
    const interrupt = pickHeuristicEdge(conditions, userText, edgeExpectsInterrupt);
    if (interrupt !== null) return interrupt;
  }

  return null;
}

const PHRASE_STOP = new Set([
  "the",
  "a",
  "an",
  "it",
  "is",
  "user",
  "caller",
  "says",
  "said",
  "that",
  "this",
  "they",
  "and",
  "or",
  "to",
  "for",
  "of",
  "if",
  "in",
  "on",
  "with",
  "was",
  "are",
  "will",
  "just",
]);

function tokenizePhrase(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/\{\{[^}]+\}\}/g, " ")
    .replace(/[^a-z0-9'\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !PHRASE_STOP.has(w));
}

/** "not a good time" → "it isn't a good time"; "already sold" → "it is already sold". */
export function pickBestPhraseEdge(conditions: string[], userText: string): number | null {
  const userTokens = tokenizePhrase(userText);
  if (userTokens.length < 2) return null;
  let best: number | null = null;
  let bestScore = 0;
  let second = 0;
  for (let i = 0; i < conditions.length; i++) {
    const condition = conditions[i] ?? "";
    if (
      !condition.trim() ||
      edgeIsElseCondition(condition) ||
      edgeIsAlwaysCondition(condition) ||
      edgeIsSkipAheadCondition(condition)
    ) {
      continue;
    }
    const condTokens = tokenizePhrase(condition);
    if (condTokens.length === 0) continue;
    const overlap = condTokens.filter((w) => userTokens.includes(w));
    let score = overlap.length;
    const condPhrase = condTokens.join(" ");
    const userPhrase = userTokens.join(" ");
    if (userPhrase.includes(condPhrase) || condPhrase.includes(userPhrase)) score += 3;
    if (score > bestScore) {
      second = bestScore;
      bestScore = score;
      best = i;
    } else if (score > second) {
      second = score;
    }
  }
  if (best === null || bestScore < 2) return null;
  if (bestScore === second) return null;
  return best;
}

export function edgeExpectsInterrupt(condition: string): boolean {
  return /\b(interrupt|interrupts|user asks|caller asks|asks a question|off.?script|change (?:the )?subject|unrelated question)\b/i.test(
    condition,
  );
}

export function looksLikeCallerQuestion(userText: string): boolean {
  const t = userText.trim();
  if (!t) return false;
  if (/[?]/.test(t)) return true;
  return /^(what|why|how|when|where|who|which|can you|could you|would you|wait)\b/i.test(t);
}

export function looksLikeMidFlowInterrupt(userText: string): boolean {
  return /\b(hold on|hang on|wait a (?:minute|sec|second)|before (?:you|we)|actually|one (?:thing|question))\b/i.test(
    userText,
  );
}
