/**
 * Declared speech mode — the graph executor, not the LLM or a text heuristic,
 * decides whether a conversation node goes to TTS, the speech model, or both.
 *
 * Builder `instructionType` / exported `instruction.type` is the source of truth.
 *
 *   Exact  (static_text) — interpolate {{vars}} → TTS. Never LLM.
 *   AI     (prompt)      — interpolate {{vars}} → LLM → TTS.
 *   Hybrid               — exact prefix → TTS, then prompt → LLM → TTS.
 *
 * Legacy `template` is Exact with variables (same path as static_text).
 */

export type ResponseMode = "static" | "llm" | "hybrid";
export type BuilderSpeechMode = "prompt" | "static_text" | "hybrid";

export function normalizeBuilderSpeechMode(
  type: string | null | undefined,
): BuilderSpeechMode {
  if (type === "static_text" || type === "static" || type === "template") return "static_text";
  if (type === "hybrid") return "hybrid";
  return "prompt";
}

export function responseModeFromInstruction(
  type: string | null | undefined,
): ResponseMode {
  const mode = normalizeBuilderSpeechMode(type);
  if (mode === "static_text") return "static";
  if (mode === "hybrid") return "hybrid";
  return "llm";
}

export function instructionTypeFromMode(mode: ResponseMode): BuilderSpeechMode {
  if (mode === "static") return "static_text";
  if (mode === "hybrid") return "hybrid";
  return "prompt";
}

/** Retell only accepts prompt | static_text. Hybrid is exported as a prompt. */
export function retellInstructionType(
  type: string | null | undefined,
): "prompt" | "static_text" {
  return responseModeFromInstruction(type) === "static" ? "static_text" : "prompt";
}

/** Retell cannot speak a prefix then generate — fold hybrid into one prompt. */
export function retellHybridPrompt(prefix: string, prompt: string): string {
  const exact = prefix.trim();
  const rest = prompt.trim();
  if (exact && rest) {
    return `First say exactly this (do not rephrase): "${exact}"\nThen:\n${rest}`;
  }
  return rest || exact;
}

export function compileSpeechInstruction(input: {
  type?: string | null;
  text?: string | null;
  prefix?: string | null;
  notes?: string | null;
  fallback?: string | null;
}): {
  type: BuilderSpeechMode;
  text: string;
  prefix?: string;
  notes?: string;
} {
  const type = normalizeBuilderSpeechMode(input.type || input.fallback);
  const text = String(input.text ?? "");
  const prefix = String(input.prefix ?? "").trim();
  const notes = String(input.notes ?? "").trim();
  return {
    type,
    text,
    ...(type === "hybrid" && prefix ? { prefix } : {}),
    ...(notes ? { notes } : {}),
  };
}
