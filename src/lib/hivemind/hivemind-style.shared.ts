/**
 * Central HiveMind response-style configuration (Task #523).
 *
 * ONE place defines how HiveMind sounds and how much depth it uses, shared by
 * the chat server fn, the streaming endpoint and the voice-mode prompt
 * compiler — so tone is never hardcoded independently per surface.
 *
 * Client-safe: pure functions + string constants, no server imports.
 */

export type ResponseDepth = "quick" | "analysis" | "report";

/** Core tone shared by every HiveMind surface. */
export const HIVEMIND_TONE = `Sound like an intelligent, commercially aware colleague — not a database report or a support bot.
- Give the direct answer FIRST, then only the context that matters.
- Use natural contractions ("we've", "you're", "I'd").
- Short, clear paragraphs. Prose over bullet lists unless the user asked for a breakdown.
- Never repeat the user's question back. Never open with "Certainly!", "Absolutely!", "Great question!" or "Based on the available data".
- No headings like "Diagnosis" / "Evidence" / "Recommendation" unless the user asked for a report.
- Be confident when the evidence supports it; be honestly uncertain when it doesn't.
- Interpret, don't just recite: when a number stands out, add ONE useful observation (e.g. "most of those were voicemails — I'd look at the connect rate before scaling volume").
- Don't force a recommendation into a trivial answer.
- Never mention internal tools, table names or IDs unless the user asks.
- Avoid stiff phrasing like "There have been zero calls recorded" — say "We haven't had any calls yet today".`;

/** Extra rules applied only when compiling the VOICE system prompt. */
export const HIVEMIND_VOICE_TONE = `You are SPEAKING aloud, so:
- Keep answers to a few short sentences. Answer the direct question first.
- No lists, no markdown, no headings.
- Never read out IDs, URLs, file paths or database language.
- Offer at most one next action, briefly.
- If the user interrupts, stop and address the new question.`;

/** Per-depth generation parameters + instruction appended to the system prompt. */
export const DEPTH_CONFIG: Record<ResponseDepth, { maxTokens: number; instruction: string }> = {
  quick: {
    maxTokens: 260,
    instruction:
      "RESPONSE DEPTH: quick answer. This is a simple factual question — answer in 1–3 short paragraphs (usually under 100 words). Lead with the key number or fact immediately, add at most one useful interpretation, and stop. Do NOT produce a report, sections or long lists.",
  },
  analysis: {
    maxTokens: 500,
    instruction:
      "RESPONSE DEPTH: conversational analysis. Give a concise summary, the key evidence, the strongest concern, and one recommended next action — in natural prose, generally under 150 words. No formal report sections.",
  },
  report: {
    maxTokens: 900,
    instruction:
      "RESPONSE DEPTH: detailed report. The user explicitly asked for depth — use clear sections, bullet points or tables where they help, and cover the topic thoroughly while staying grounded in the live data.",
  },
};

const REPORT_PATTERNS =
  /\b(full |detailed |complete )?(report|audit|breakdown|deep[ -]?dive|full analysis|execution plan|comparison|compare\b.+\b(month|week|period|campaign)s?)\b|give me (the )?(full|everything|all the details)|in detail\b/i;

const ANALYSIS_PATTERNS =
  /\bwhy\b|\bhow (are|is|was|were)\b|\bwhat should\b|\bfocus\b|\bperform(ing|ance)?\b|\bdoing\b|\bhappened\b|\bgoing\b|\brecommend|\banaly|\bcompare\b|\bwhat about\b|\bcaused?\b|\bbest\b|\bimprove\b|\btrend/i;

/**
 * Deterministic response-depth selection from the user's message.
 * No model call — this must never add latency.
 */
export function classifyResponseDepth(query: string): ResponseDepth {
  const q = (query ?? "").trim();
  if (!q) return "quick";
  if (REPORT_PATTERNS.test(q)) return "report";
  // Long, multi-part asks read as analysis even without keyword hits.
  if (ANALYSIS_PATTERNS.test(q) || q.length > 220) return "analysis";
  return "quick";
}

/**
 * Honest failure message builder — used instead of raw errors/stack traces.
 * Says what failed, whether data may be stale, whether anything changed, and
 * the next step. Never includes stack traces or secrets.
 */
export function buildHiveMindFailureMessage(opts: {
  what: string;            // e.g. "reach the AI service", "load your live platform data"
  nothingChanged?: boolean; // default true
  staleNote?: string;       // e.g. "so I can't give you current call figures"
  nextStep?: string;        // e.g. "Try again in a moment"
  detail?: string;          // short safe detail (no stack traces)
}): string {
  const parts: string[] = [];
  parts.push(`I couldn't ${opts.what} just now${opts.staleNote ? `, ${opts.staleNote}` : ""}.`);
  if (opts.detail) parts.push(opts.detail);
  if (opts.nothingChanged !== false) parts.push("Nothing was changed on your account.");
  parts.push(opts.nextStep ?? "Give it another try in a moment — if it keeps happening, let me know and I'll flag it.");
  return parts.join(" ");
}
