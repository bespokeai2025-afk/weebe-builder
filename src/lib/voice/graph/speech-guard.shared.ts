/**
 * Stop the speech model closing the call while the graph still has work.
 *
 * Prompt nodes ask an LLM to phrase the current step. When CRM fields are
 * already in context the model often invents "that's all I need" instead of
 * asking the node's actual question. The VM keeps those lines off the phone.
 */

import { looksLikeAgentTask } from "./speech-prompt.shared";

export function looksLikePrematureWrapUp(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  return (
    /\bthat'?s all i need\b/.test(t) ||
    /\bthat'?s all for now\b/.test(t) ||
    /\bthat'?s everything i need\b/.test(t) ||
    /\bnothing else i need\b/.test(t) ||
    /\bif you have any (other )?questions before\b/.test(t) ||
    /\byou'?re all (set|booked)\b/.test(t) ||
    /\bthe appointment is booked\b/.test(t) ||
    /\bhave a (great|good|nice) day\b/.test(t) ||
    /\bgoodbye[.!]?\s*$/.test(t)
  );
}

export function replacePrematureWrapUp(text: string, fallback: string): string {
  const spoken = text.trim();
  const clean = fallback.trim();
  if (!spoken) return clean;
  if (looksLikeAgentTask(spoken) && clean) return clean;
  if (!looksLikePrematureWrapUp(spoken)) return spoken;
  if (clean && !looksLikePrematureWrapUp(clean) && !looksLikeAgentTask(clean)) return clean;
  return spoken;
}

/** Speaker echo of the agent's own line, transcribed as if the caller spoke. */
export function looksLikePlaybackEcho(userText: string, lastAgentText: string): boolean {
  const user = normalizeEchoText(userText);
  const agent = normalizeEchoText(lastAgentText);
  if (user.length < 8 || agent.length < 8) return false;
  if (agent.includes(user)) return true;
  const userHead = user.split(" ").slice(0, 6).join(" ");
  if (userHead.length >= 10 && agent.startsWith(userHead)) return true;
  const agentHead = agent.split(" ").slice(0, 8).join(" ");
  return agentHead.length >= 10 && user.startsWith(agentHead);
}

function normalizeEchoText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstSpeakableBoundary(buf: string): boolean {
  if (buf.length >= 120) return true;
  return /[.!?][\s"'”’]/.test(buf) || /[.!?]$/.test(buf);
}

/** Drop wrap-up speech on non-end nodes, swapping in the node's script. */
export async function* guardPrematureWrapUpStream(
  stream: AsyncIterable<string>,
  fallback: string,
  isEndNode: boolean,
): AsyncGenerator<string> {
  if (isEndNode) {
    for await (const delta of stream) yield delta;
    return;
  }

  let buf = "";
  let released = false;
  for await (const delta of stream) {
    buf += delta;
    if (released) {
      if (looksLikePrematureWrapUp(buf)) return;
      yield delta;
      continue;
    }
    if (!firstSpeakableBoundary(buf)) continue;
    const replacement = replacePrematureWrapUp(buf, fallback);
    released = true;
    if (replacement !== buf) {
      if (replacement) yield replacement;
      return;
    }
    yield buf;
  }
  if (!released) {
    const replacement = replacePrematureWrapUp(buf, fallback);
    if (replacement) yield replacement;
  }
}
