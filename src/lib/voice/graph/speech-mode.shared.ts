/**
 * Declared speech mode — the graph executor, not the LLM or a text heuristic,
 * decides whether a conversation node goes to TTS or the speech model.
 *
 * Builder `instructionType` / exported `instruction.type` is the source of truth.
 *
 *   Exact  (static_text) — interpolate {{vars}} → TTS. Never LLM.
 *   AI     (prompt)      — interpolate {{vars}} → LLM → TTS.
 *
 * There are exactly two modes, matching Retell. A third "hybrid" mode (exact
 * prefix, then AI) used to exist here; Retell has no such concept, so it was
 * folded into a single prompt on export and behaved differently on native than
 * it did once deployed. Legacy `hybrid` data is still accepted and normalized
 * to `prompt` with the prefix folded into the prompt text, so saved flows keep
 * working — but nothing downstream has a third path to get wrong.
 *
 * Legacy `template` is Exact with variables (same path as static_text).
 */

export type ResponseMode = "static" | "llm";
export type BuilderSpeechMode = "prompt" | "static_text";

export function normalizeBuilderSpeechMode(
  type: string | null | undefined,
): BuilderSpeechMode {
  if (type === "static_text" || type === "static" || type === "template") return "static_text";
  return "prompt";
}

export function responseModeFromInstruction(
  type: string | null | undefined,
): ResponseMode {
  return normalizeBuilderSpeechMode(type) === "static_text" ? "static" : "llm";
}

export function instructionTypeFromMode(mode: ResponseMode): BuilderSpeechMode {
  return mode === "static" ? "static_text" : "prompt";
}

/** Retell accepts prompt | static_text — the same two modes we now run natively. */
export function retellInstructionType(
  type: string | null | undefined,
): "prompt" | "static_text" {
  return responseModeFromInstruction(type) === "static" ? "static_text" : "prompt";
}

/**
 * Fold a legacy hybrid node's exact prefix into its prompt, so the one
 * remaining prompt path reproduces "say this, then continue" faithfully.
 */
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
  const declared = String(input.type || input.fallback || "").trim();
  const type = normalizeBuilderSpeechMode(declared);
  const prefix = String(input.prefix ?? "").trim();
  const notes = String(input.notes ?? "").trim();
  // Legacy hybrid: fold the exact prefix into the prompt so the single prompt
  // path still says it first, instead of silently dropping the prefix when the
  // third mode went away.
  const text =
    declared === "hybrid" && prefix
      ? retellHybridPrompt(prefix, String(input.text ?? ""))
      : String(input.text ?? "");
  return {
    type,
    text,
    ...(notes ? { notes } : {}),
  };
}
