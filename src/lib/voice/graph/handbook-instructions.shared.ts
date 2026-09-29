/**
 * Agent Handbook — compiled into prompt instructions for the native engine.
 *
 * Retell's own platform applies these nine toggles internally when a `handbook_config` is set on
 * a Retell-deployed agent, so `export-conversation-flow.ts` already emits that field correctly and
 * is left alone here. The native engine has no such internal behaviour to opt into — it only has
 * whatever is in the prompt the LLM actually sees — so a native call ignored all nine toggles even
 * though the builder happily saved them. This turns each enabled toggle into one plain instruction
 * line, appended to the compiled flow's `global_prompt` for native calls only (see `load.ts`); nine
 * separate feature branches implemented once as one generic loop over "toggle on -> line included".
 *
 * Relative imports only — reachable from the voice gateway bundle.
 */

export interface HandbookToggles {
  handbookEchoVerification?: boolean;
  handbookSpeechNormalization?: boolean;
  handbookDefaultPersonality?: boolean;
  handbookScopeBoundaries?: boolean;
  handbookNaturalFillerWords?: boolean;
  handbookNatoPhoneticAlphabet?: boolean;
  handbookHighEmpathy?: boolean;
  handbookAiDisclosure?: boolean;
  handbookSmartMatching?: boolean;
}

const HANDBOOK_LINES: Array<{ key: keyof HandbookToggles; line: string }> = [
  {
    key: "handbookDefaultPersonality",
    line: "Maintain a warm, professional, and approachable conversational tone throughout the call.",
  },
  {
    key: "handbookHighEmpathy",
    line: "Respond with high empathy: briefly acknowledge the caller's situation or feelings before moving the conversation on, so they feel heard.",
  },
  {
    key: "handbookNaturalFillerWords",
    line: 'Use natural conversational filler occasionally (like "okay", "got it", "let me check") so the conversation feels human — without overusing it.',
  },
  {
    key: "handbookScopeBoundaries",
    line: "Stay strictly within the scope of this call's purpose. If the caller asks about something unrelated, politely explain you can't help with that here and steer back to why you're calling.",
  },
  {
    key: "handbookEchoVerification",
    line: "When the caller gives you a critical detail — a name, email address, phone number, or anything spelled out — read it back to confirm you captured it correctly before moving on.",
  },
  {
    key: "handbookNatoPhoneticAlphabet",
    line: 'When you spell something out letter by letter (a name, an email, a code), use the NATO phonetic alphabet — e.g. "A as in Alpha, B as in Bravo" — so it is unambiguous over the phone.',
  },
  {
    key: "handbookSpeechNormalization",
    line: 'Speak numbers, dates, times, and abbreviations the way a person says them aloud (e.g. "twenty twenty-six", not "2026"; "three thirty PM", not "15:30") — never read out raw digits or symbols.',
  },
  {
    key: "handbookSmartMatching",
    line: "When matching what the caller says against a known list of options (names, addresses, products, etc.), be lenient with mishearings, typos, or near-sounding words, and pick the closest reasonable match rather than failing to match at all.",
  },
  {
    key: "handbookAiDisclosure",
    line: "If the caller asks whether you are an AI or a real person, honestly disclose that you are an AI assistant.",
  },
];

/** Every enabled toggle's instruction, one per line, or "" when none are set. */
export function buildHandbookInstructions(
  settings: Record<string, unknown> | null | undefined,
): string {
  if (!settings) return "";
  const lines = HANDBOOK_LINES.filter((entry) => settings[entry.key] === true).map((entry) => entry.line);
  return lines.join("\n");
}

/** Append the handbook block to a global prompt, only when there's anything to add. */
export function appendHandbookInstructions(
  globalPrompt: string,
  settings: Record<string, unknown> | null | undefined,
): string {
  const block = buildHandbookInstructions(settings);
  if (!block) return globalPrompt;
  const base = globalPrompt.trim();
  return base ? `${base}\n\n${block}` : block;
}
