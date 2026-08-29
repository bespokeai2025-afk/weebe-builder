/**
 * Declared speech mode — the graph executor, not the LLM or a text heuristic,
 * decides whether a conversation node goes to TTS or the speech model.
 *
 * Builder `instructionType` / exported `instruction.type` is the source of truth.
 */

export type ResponseMode = "static" | "template" | "llm";

export function responseModeFromInstruction(
  type: string | null | undefined,
): ResponseMode {
  if (type === "static_text" || type === "static") return "static";
  if (type === "template") return "template";
  return "llm";
}

export function instructionTypeFromMode(
  mode: ResponseMode,
): "prompt" | "static_text" | "template" {
  if (mode === "static") return "static_text";
  if (mode === "template") return "template";
  return "prompt";
}

/** Retell only accepts prompt | static_text. */
export function retellInstructionType(
  type: string | null | undefined,
): "prompt" | "static_text" {
  return responseModeFromInstruction(type) === "llm" ? "prompt" : "static_text";
}
