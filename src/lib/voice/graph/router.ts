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
  /**
   * When false, skip loose heuristics (generic-single / scored fallback) so a
   * transition only fires on a real match — Retell `flex_mode: false`.
   */
  flex?: boolean;
  /** True when the transport reported silence, even if history still has a prior user line. */
  silenceTimeout?: boolean;
  /**
   * False when the call may be in a language other than English. Every step that matches the
   * caller's words against English lists (repair, yes/no, question detection, phrase overlap, the
   * global-interrupt keyword gate) is skipped and the classifier — which reads any language —
   * decides. Defaults to true.
   */
  englishRules?: boolean;
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
  const userText = ctx.silenceTimeout ? "" : lastUserText(ctx.history);
  const lastAgentText = lastAssistantText(ctx.history);
  const english = ctx.englishRules !== false;

  // Repair turns ("what?", "pardon?") stay on the current node — Retell does not
  // treat them as a transition.
  if (english && looksLikeRepairRequest(userText)) return { edge: null, method: "none" };

  const isTimeoutCondition = (c: string) =>
    /^(timeout|silence|no.?input|no.?response)$/i.test(c.trim());

  // Silence / wait-timeout edges fire only when the caller said nothing.
  if (ctx.silenceTimeout || !userText.trim()) {
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

  // 2b. Several edges, all with a blank condition, all pointing at the SAME destination — a
  // duplicate draw in the builder canvas (the same connection made 2-3 times), not a real branch.
  // There is nothing for a classifier to decide between identical blank options pointing at the
  // same place, so this used to pay for a full LLM round trip to "choose" among copies of the
  // same answer. Collapse it the same way a lone unconditional edge already is. Edges with
  // genuinely different blank-condition destinations are left alone — that IS an unresolved
  // ambiguity (the flow author needs a real condition to tell them apart), and guessing one over
  // the other would silently make a routing decision no one actually authored.
  if (usable.length > 1 && conditions.every((c) => !c)) {
    const destinations = new Set(usable.map((e) => e.destination_node_id));
    if (destinations.size === 1) {
      return { edge: usable[0]!, method: "unconditional" };
    }
  }

  // 3. Equation conditions (Retell logic-split style) — deterministic, zero LLM cost.
  const equationHit = tryEquationEdge(usable, ctx.variables);
  if (equationHit) return { edge: equationHit, method: "equation" };

  // 4. Single edge with generic/any-answer/placeholder prompt + substantive caller reply.
  //
  // Runs in strict mode (`flex_mode: false`) too, which it previously did not. Strict mode means
  // "only fire a transition on a real match" — but a condition that literally reads "any answer"
  // IS a real match for any answer; there is nothing being guessed. Measured on a live strict-mode
  // flow, 29 of its 85 nodes have exactly one such edge, and every turn through them was paying a
  // ~1.5s classifier call to confirm a tautology (46% of all turns were on the classifier path at
  // a 1551ms median). The one thing strict mode should still withhold is advancing past a caller
  // who asked a question instead of answering — there the classifier's "none of these" verdict
  // keeps the agent on the node to answer it, so questions are excluded below rather than absorbed.
  if (usable.length === 1 && userText.trim() && !(english && looksLikeRepairRequest(userText))) {
    const only = conditions[0]?.toLowerCase() ?? "";
    const generic =
      edgeExpectsGenericContinuation(only) ||
      edgeIsAnyAnswerEdge(only) ||
      edgeIsGenericCatchAll(only) ||
      edgeIsPlaceholderCondition(only);
    // Strict mode must not absorb a caller's question; that check is English-only, so other
    // languages let the classifier decide instead of guessing.
    if (generic && (ctx.flex !== false || (english && !looksLikeCallerQuestion(userText)))) {
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
  const heuristic = english ? tryHeuristicEdgeIndex(conditions, userText, lastAgentText) : null;
  if (heuristic !== null) return { edge: usable[heuristic]!, method: "heuristic" };

  // 6. Ambiguous prompt conditions only — compact context, per-node classifier.
  //
  // A genuine "neither of these" is a real, common outcome here — a caller cut off mid-sentence
  // ("and you know what…"), a non-answer, a stray remark — and belongs as its own choice, not
  // something the model has to force onto whichever of the real options looks least wrong.
  // Without it, a 2-option yes/no confirmation node has no way to say "that wasn't actually an
  // answer", so the model reliably picks a side on input that resembles neither, and the flow
  // transitions as if the caller had actually confirmed something they never addressed.
  // `selectGlobalNode` already does this (its `NONE` choice below); edges never had the same
  // escape hatch.
  const NONE_OF_THESE = "None of these — the caller hasn't actually answered any of them yet";
  const choices = [...conditions.map((c, i) => c || `Continue (option ${i + 1})`), NONE_OF_THESE];
  const noneIndex = choices.length - 1;

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

  // A deliberate "none of these" is a real decision, not a malformed response — stay on the node
  // rather than falling back to a scored guess the model already declined to make.
  if (index === noneIndex) return { edge: null, method: "none" };

  if (!Number.isInteger(index) || index < 0 || index >= usable.length) {
    if (ctx.flex === false) return { edge: null, method: "none" };
    const scored = english ? pickBestScoredEdge(conditions, userText, lastAgentText, 2) : null;
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
  const english = ctx.englishRules !== false;
  // The keyword gate saves a classifier call on ordinary English turns; without it (other
  // languages) every turn is checked, or global nodes could never fire for those callers.
  if (english && !looksLikeGlobalInterrupt(userText)) return { hit: null, method: "global_skip" };
  if (!userText.trim()) return { hit: null, method: "global_skip" };

  const conditions = globals.map((g) => interpolate(g.condition, ctx.variables));

  const heuristicGlobal = english ? tryHeuristicGlobalIndex(conditions, userText) : null;
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
  return /\b(address|postcode|post code|zip|location|where (?:do you|are you)|street|city|town|suburb)\b/.test(
    condition.toLowerCase(),
  );
}

/** Street / city / postcode answers common in qualification flows. */
export function looksLikeAddressAnswer(userText: string): boolean {
  const t = userText.trim();
  if (!t || t.length < 8 || looksLikePhoneAnswer(t)) return false;
  const hasStreetCue =
    /\b(street|st\.?|road|rd\.?|avenue|ave\.?|lane|ln\.?|drive|dr\.?|court|ct\.?|way|place|pl\.?|boulevard|blvd\.?|close|crescent|terrace|gardens)\b/i.test(
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
  return /^(yes|yeah|yep|yup|yea|sim|si|sí|sure|ok|okay|correct|right|absolutely|definitely|of course|please|go ahead|sounds good|that works|mm?[\s-]?hm|uh[\s-]?huh|y)\b/i.test(
    t,
  );
}

function startsWithNegative(t: string): boolean {
  return /^(no|nope|nah|not really|negative|pass)\b/i.test(t);
}

/**
 * Whole-utterance confirmations that lead with no affirmative word, so neither
 * `startsWithAffirmative` nor token overlap with a "correct"-style condition can
 * catch them — they fell through to the LLM classifier every time. Both the
 * apostrophe and bare spellings are listed because speech-to-text output varies.
 */
const AFFIRMATIVE_PHRASES = new Set([
  "it's right",
  "its right",
  "it's correct",
  "its correct",
  // Deliberately absent: "that's it" / "that's all". After "Is that correct?"
  // they mean yes, but after "Anything else?" they mean no — context-free
  // matching gets it wrong half the time, so these stay with the classifier.
  "sounds right",
  "looks right",
  "i think so",
  "i guess so",
  "i believe so",
  "spot on",
  "exactly right",
]);

/** Negative twins of {@link AFFIRMATIVE_PHRASES}. */
const NEGATIVE_PHRASES = new Set([
  "it's wrong",
  "its wrong",
  "that's wrong",
  "thats wrong",
  "it's not right",
  "its not right",
  "that's not right",
  "thats not right",
  "i don't think so",
  "i dont think so",
  "not quite",
  "not exactly",
]);

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
    /\b(not interested|don't want|do not want|no thanks|not now|not today|call me later|call me after|call me afterwards)\b/.test(t)
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

/** Negates the act of answering — "user doesn't give details" is the failure path, not a catch-all. */
const CATCH_ALL_NEGATION =
  /\b(does ?n[o']?t|do ?n[o']?t|did ?n[o']?t|wo ?n[o']?t|can ?n[o']?t|cannot|refuses?|declines?|fails? to|unable to)\b/i;

/**
 * Condition the flow author wrote to mean "whatever they said, move on" — "any answer",
 * "any acknowledgement, or any response", "user gives details requested".
 *
 * Broader than `edgeIsAnyAnswerEdge` (exact strings) and `edgeExpectsGenericContinuation` (a fixed
 * phrase list) because real flows phrase this dozens of ways. Measured on a live 86-node flow,
 * those two predicates missed most of them, so 1.5s classifier calls were being spent asking a
 * model whether a reply counts as "any answer" — which it does by construction.
 *
 * Deliberately anchored on explicit "any …answer/response" phrasing and the
 * gives/provides-the-information family only. A condition naming a specific value to discriminate
 * on ("if its freehold", "when user answers property type as flat or apartment") is NOT a catch-all
 * and must keep reaching the classifier, so no attempt is made to generalise past those two shapes.
 */
function edgeIsGenericCatchAll(condition: string): boolean {
  const c = condition.trim().toLowerCase();
  if (!c) return false;
  if (CATCH_ALL_NEGATION.test(c)) return false;
  if (/\bany\b[^.]{0,24}\b(answer|acknowledge?ment|response|reply)\b/.test(c)) return true;
  if (/\b(gives?|provides?|supplies)\b[^.]{0,16}\b(detail|details|info|information)\b/.test(c)) {
    return true;
  }
  if (/^(?:the )?(?:user|caller|customer) (?:answers?|responds?|replies)$/.test(c)) return true;
  return false;
}

/**
 * A reply carrying real content — not filler, not a repair request, not the caller asking their
 * own question (which deserves an answer, not a transition).
 */
function isSubstantiveReply(userText: string): boolean {
  const t = userText.trim();
  if (t.length < 2) return false;
  if (looksLikeRepairRequest(t) || looksLikeCallerQuestion(t)) return false;
  if (/^(um+|uh+|er+|hmm+|mm+|ah+|oh+|well|so|like)[.,!?]*$/i.test(t)) return false;
  return /[a-z0-9]/i.test(t);
}

/** Affirmative edge — excludes negated prompts like "not interested" / "not available". */
function edgeExpectsAffirmative(condition: string): boolean {
  const c = condition.toLowerCase();
  if (/\bnot (interested|available|sure|really)\b/.test(c)) return false;
  if (/\b(no|negative|declin|reject|refus|unavailable|wrong name|incorrect name)\b/.test(c)) {
    return false;
  }
  return /\b(yes|positive|affirm|confirm(?:s|ed|ing)?|correct|agree|available|interested|helpful|proceed|continue)\b/.test(
    c,
  );
}

function isShortAcknowledgement(t: string): boolean {
  return /^(yes|yeah|yep|yup|yea|sim|si|sí|sure|ok|okay|correct|right|absolutely|definitely|of course|please|go ahead|sounds good|that works|mm?[\s-]?hm|uh[\s-]?huh|y)$/i.test(
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
    /^(yes|yeah|yep|yup|yea|sim|si|sí|sure|ok|okay|correct|right|absolutely|definitely|of course|please|go ahead|sounds good|that works|mm?[\s-]?hm|uh[\s-]?huh|y)$/i;
  const NO = /^(no|nope|nah|not really|negative|pass)$/i;
  const CONTINUE =
    /^(continue|proceed|next|go on|keep going|sure thing|that's fine|fine|alright|all right)$/i;

  if (YES.test(t) || startsWithAffirmative(t) || AFFIRMATIVE_PHRASES.has(t)) {
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
    if (
      (NO.test(t) || startsWithNegative(t) || NEGATIVE_PHRASES.has(t)) &&
      /\b(no|negative|declin|reject|not|unavailable|refus)\b/.test(c)
    ) {
      return i;
    }
    if (CONTINUE.test(t) && /\b(continue|proceed|next|move on|go ahead)\b/.test(c)) {
      return i;
    }
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
    if (!conditions.some((condition) => edgeExpectsAddress(condition))) {
      const generic = pickHeuristicEdge(conditions, userText, (condition) =>
        edgeExpectsGenericContinuation(condition),
      );
      if (generic !== null) return generic;
    }
  }

  const phrase = pickBestPhraseEdge(conditions, userText);
  if (phrase !== null) return phrase;

  // Lone catch-all edge ("any answer", "user gives details requested") against a reply that has
  // real content in it. Deliberately second-to-last: every specific heuristic above gets first
  // refusal, so a real branch never loses a turn to the catch-all. Requires EXACTLY one catch-all
  // among the node's edges — two of them is a genuine ambiguity only the classifier can settle.
  //
  // Before this, the catch-all path only triggered on a short "yes"/"ok" (see the acknowledgement
  // block above), so a substantive answer — "Myself", "It's not occupied.", "Six bedrooms" — fell
  // through to a ~1.5s classifier call on an edge that was always going to accept it.
  if (isSubstantiveReply(userText)) {
    const catchAll: number[] = [];
    for (let i = 0; i < conditions.length; i++) {
      const c = conditions[i] ?? "";
      if (!c.trim() || !edgeIsGenericCatchAll(c)) continue;
      if (edgeIsSkipAheadCondition(c) || edgeIsTerminalOrOptOutCondition(c)) continue;
      // "any acknowledgement thats positive" must not swallow a decline.
      if (
        edgeExpectsAffirmative(c) &&
        (NO.test(t) || startsWithNegative(t) || userSignalsDecline(userText))
      ) {
        continue;
      }
      catchAll.push(i);
    }
    if (catchAll.length === 1) return catchAll[0]!;
  }

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
    // Collapse apostrophes rather than keeping them, so a caller's "that's"
    // and a condition written "thats" produce the same token. Keeping them
    // meant the two forms scored zero overlap and fell through to the LLM.
    // Covers the curly apostrophe some speech-to-text providers emit.
    .replace(/['’ʼ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
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
