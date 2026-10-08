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

/**
 * Complete sentences at the front of `buf` (each with its trailing space) and what is left.
 * A sentence ends at . ! or ? followed by whitespace or a closing quote.
 */
function takeSentences(buf: string): { sentences: string[]; rest: string } {
  const sentences: string[] = [];
  const re = /[.!?]+["'”’)]*\s+/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(buf))) {
    sentences.push(buf.slice(last, m.index + m[0].length));
    last = m.index + m[0].length;
  }
  return { sentences, rest: buf.slice(last) };
}

/**
 * Drop wrap-up speech on non-end nodes, swapping in the node's script.
 *
 * After the first sentence this used to watch the whole accumulated reply and stop the stream the
 * moment a wrap-up phrase appeared anywhere — so "Perfect, thank you. You're all set on the
 * details, so what's your timeframe?" reached the caller as "Perfect, thank you." and the node's
 * actual question was never spoken. It now works sentence by sentence: a sentence that is a
 * premature goodbye is dropped, and every other sentence — including the question — is kept.
 */
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
  let pending = "";
  for await (const delta of stream) {
    if (released) {
      pending += delta;
      const { sentences, rest } = takeSentences(pending);
      pending = rest;
      for (const sentence of sentences) {
        if (!isDroppableWrapUp(sentence)) yield sentence;
        // Keep the separator a dropped sentence carried, so the next one is not glued on.
        else if (/^\s/.test(sentence)) yield " ";
      }
      continue;
    }
    buf += delta;
    if (!firstSpeakableBoundary(buf)) continue;
    const replacement = replacePrematureWrapUp(buf, fallback);
    released = true;
    // Compare trimmed: `replacePrematureWrapUp` trims, so a first sentence that merely ended in a
    // space or newline (a token like ". " or "?\n") used to count as "replaced" — and the stream
    // stopped after the first sentence, silently cutting off the rest of the reply.
    if (replacement.trim() !== buf.trim()) {
      if (replacement) yield replacement;
      return;
    }
    yield buf;
  }
  if (!released) {
    const replacement = replacePrematureWrapUp(buf, fallback);
    if (replacement) yield replacement;
    return;
  }
  if (pending.trim() && !isDroppableWrapUp(pending)) yield pending;
}

/** A goodbye sentence worth dropping — never one that also asks the caller something. */
function isDroppableWrapUp(sentence: string): boolean {
  return looksLikePrematureWrapUp(sentence) && !sentence.includes("?");
}
