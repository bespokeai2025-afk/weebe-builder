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
import { summarizeCollectedFacts } from "./collected-facts.shared";
import type { FlowEdge, LlmMessage, VariableValue, VmLlm } from "./types";

export interface RouteContext {
  /** Conversation so far, oldest first. */
  history: LlmMessage[];
  variables: Record<string, VariableValue>;
  globalPrompt: string;
  /** Short label for the node being routed from. */
  currentNodeHint?: string;
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

  const choices = conditions.map((c, i) => c || `Continue (option ${i + 1})`);
  const userText = lastUserText(ctx.history);
  const heuristic = tryHeuristicEdgeIndex(conditions, userText);
  if (heuristic !== null) return usable[heuristic];

  let index: number;
  try {
    index = await llm.classify(buildRoutingMessages(ctx), choices);
  } catch {
    // Prefer staying on the current node over jumping to an arbitrary edge.
    const unconditional = usable.findIndex((_, i) => !conditions[i]);
    return unconditional >= 0 ? usable[unconditional] : null;
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

  const userText = lastUserText(ctx.history);
  if (!looksLikeGlobalInterrupt(userText)) return null;

  const NONE = "None of the above — the conversation is continuing normally";
  const choices = [
    ...globals.map((g) => interpolate(g.condition, ctx.variables)),
    NONE,
  ];

  let index: number;
  try {
    index = await llm.classify(buildRoutingMessages(ctx), choices);
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
 * Build the minimal message list a routing decision sees.
 *
 * Routing only needs the current step, a brief agent context slice, and the
 * last couple of exchanges — not the full knowledge base or long history.
 */
function buildRoutingMessages(ctx: RouteContext): LlmMessage[] {
  const parts: string[] = ["Pick the transition that matches the caller's latest reply."];
  if (ctx.currentNodeHint) parts.push(`Current step: ${ctx.currentNodeHint}`);
  if (ctx.globalPrompt) parts.push(`Brief context: ${truncatePrompt(ctx.globalPrompt, 240)}`);

  const known = Object.entries(ctx.variables).filter(
    ([, v]) => v !== null && v !== undefined && v !== "",
  );
  if (known.length > 0 && known.length <= 8) {
    parts.push(
      `Known: ${known.map(([k, v]) => `${k}=${String(v)}`).join(", ")}`,
    );
  }

  const collected = summarizeCollectedFacts(ctx.history);
  if (collected) parts.push(`Already collected: ${collected}`);

  const messages: LlmMessage[] = [{ role: "system", content: parts.join("\n") }];
  messages.push(...ctx.history.slice(-12));
  return messages;
}

function truncatePrompt(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`;
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

/** Edge expects the caller to continue / provide info (not a rejection path). */
function edgeExpectsGenericContinuation(condition: string): boolean {
  return /\b(user answers?|user gives details|any answer|any acknowledgement|provided|caller provides|gives? (?:contact|info|details))\b/.test(
    condition.toLowerCase(),
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

export function looksLikeNameAnswer(userText: string): boolean {
  const t = userText.trim();
  if (!t || looksLikePhoneAnswer(t)) return false;
  const words = t.split(/\s+/).filter(Boolean);
  return words.length <= 4 && t.length >= 2 && /^[\p{L}\s'.-]+$/u.test(t);
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

/**
 * Skip the classifier for obvious yes/no/ok answers — saves ~1–3s per turn on
 * typical qualification flows where most edges are affirmative/negative prompts.
 */
export function tryHeuristicEdgeIndex(conditions: string[], userText: string): number | null {
  const t = userText.trim().toLowerCase().replace(/[.!?,]+$/g, "");
  if (!t) return null;

  const YES =
    /^(yes|yeah|yep|yup|sure|ok|okay|correct|right|absolutely|definitely|of course|please|go ahead|sounds good|that works|mm[\s-]?hm|uh[\s-]?huh|y)$/i;
  const NO = /^(no|nope|nah|not really|negative|pass)$/i;
  const CONTINUE =
    /^(continue|proceed|next|go on|keep going|sure thing|that's fine|fine|alright|all right)$/i;

  for (let i = 0; i < conditions.length; i++) {
    const c = conditions[i]?.toLowerCase() ?? "";
    if (!c) continue;
    if (
      YES.test(t) &&
      /\b(yes|positive|affirm|confirm|correct|agree|available|interested|helpful|proceed|continue)\b/.test(
        c,
      )
    ) {
      return i;
    }
    if (NO.test(t) && /\b(no|negative|declin|reject|not|unavailable|refus)\b/.test(c)) {
      return i;
    }
    if (CONTINUE.test(t) && /\b(continue|proceed|next|move on|go ahead)\b/.test(c)) {
      return i;
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

  // Spelled-out or digit phone numbers when an edge expects contact info.
  if (looksLikePhoneAnswer(userText)) {
    for (let i = 0; i < conditions.length; i++) {
      if (edgeExpectsPhone(conditions[i] ?? "")) return i;
    }
    for (let i = 0; i < conditions.length; i++) {
      if (edgeExpectsGenericContinuation(conditions[i] ?? "")) return i;
    }
  }

  // Numeric / detail answers (price, floor, size, bedrooms).
  if (
    /\d/.test(t) ||
    /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|double|triple|zero|oh|million|thousand|hundred|floor|bhk|b h k|goodbye|bye|thanks|thank you)\b/.test(
      t,
    )
  ) {
    for (let i = 0; i < conditions.length; i++) {
      const c = conditions[i]?.toLowerCase() ?? "";
      if (
        /\b(price|amount|floor|size|bedroom|detail|unit|square|goodbye|end|finish|affirm|yes|continue|proceed|phone|mobile|contact|callback|details)\b/.test(
          c,
        )
      ) {
        return i;
      }
    }
    for (let i = 0; i < conditions.length; i++) {
      if (edgeExpectsGenericContinuation(conditions[i] ?? "")) return i;
    }
  }

  return null;
}
