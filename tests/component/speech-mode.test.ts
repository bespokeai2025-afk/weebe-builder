import { describe, expect, it } from "vitest";
import { compileFlow, interpolateDeclaredSpeech } from "@/lib/voice/graph/flow";
import {
  instructionTypeFromMode,
  responseModeFromInstruction,
  retellInstructionType,
} from "@/lib/voice/graph/speech-mode.shared";

describe("declared speech mode", () => {
  it("maps builder instruction types without reading the text", () => {
    expect(responseModeFromInstruction("static_text")).toBe("static");
    expect(responseModeFromInstruction("template")).toBe("template");
    expect(responseModeFromInstruction("prompt")).toBe("llm");
    expect(responseModeFromInstruction(undefined)).toBe("llm");
    expect(instructionTypeFromMode("static")).toBe("static_text");
    expect(retellInstructionType("template")).toBe("static_text");
    expect(retellInstructionType("prompt")).toBe("prompt");
  });

  it("fills template variables without dropping instruction-looking lines", () => {
    expect(
      interpolateDeclaredSpeech(
        "Your appointment is at {{appointment_time}}.\nDo not ask any other questions.",
        { appointment_time: "3:30 PM" },
      ),
    ).toBe("Your appointment is at 3:30 PM.\nDo not ask any other questions.");
  });

  it("compiles response_mode when instruction.type is missing", () => {
    const compiled = compileFlow({
      start_node_id: "welcome",
      nodes: [
        {
          id: "welcome",
          type: "conversation",
          response_mode: "static",
          instruction: { text: "Thanks for calling." },
        },
      ],
    });
    expect(compiled.nodes.get("welcome")?.instruction?.type).toBe("static_text");
  });
});
