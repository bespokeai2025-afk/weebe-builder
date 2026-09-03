import { describe, expect, it } from "vitest";
import { compileFlow, interpolateDeclaredSpeech, interpolateForSpeech } from "@/lib/voice/graph/flow";
import {
  instructionTypeFromMode,
  responseModeFromInstruction,
  retellHybridPrompt,
  retellInstructionType,
} from "@/lib/voice/graph/speech-mode.shared";
import {
  fillBracketPlaceholders,
  flattenToolVariables,
  resolveVariables,
} from "@/lib/voice/graph/variables.shared";

describe("declared speech mode", () => {
  it("maps builder instruction types without reading the text", () => {
    expect(responseModeFromInstruction("static_text")).toBe("static");
    expect(responseModeFromInstruction("template")).toBe("static");
    expect(responseModeFromInstruction("hybrid")).toBe("hybrid");
    expect(responseModeFromInstruction("prompt")).toBe("llm");
    expect(responseModeFromInstruction(undefined)).toBe("llm");
    expect(instructionTypeFromMode("static")).toBe("static_text");
    expect(instructionTypeFromMode("hybrid")).toBe("hybrid");
    expect(retellInstructionType("template")).toBe("static_text");
    expect(retellInstructionType("hybrid")).toBe("prompt");
    expect(retellInstructionType("prompt")).toBe("prompt");
  });

  it("folds hybrid into one prompt for Retell", () => {
    expect(retellHybridPrompt("Thanks, Sarah.", "Explain the available options.")).toBe(
      'First say exactly this (do not rephrase): "Thanks, Sarah."\nThen:\nExplain the available options.',
    );
  });

  it("fills exact-text variables without dropping instruction-looking lines", () => {
    expect(
      interpolateDeclaredSpeech(
        "Your appointment is at {{appointment_time}}.\nDo not ask any other questions.",
        { appointment_time: "3:30 PM" },
      ),
    ).toBe("Your appointment is at 3:30 PM.\nDo not ask any other questions.");
  });

  it("resolves dotted tool variables before speech or LLM", () => {
    expect(
      resolveVariables("Slot {{calendar.matched_slot}} ({{calendar.match_status}}).", {
        "calendar.matched_slot": "12 September",
        "calendar.match_status": "exact",
      }),
    ).toBe("Slot 12 September (exact).");
    expect(
      interpolateForSpeech("Hello {{customer_name}}, see you {{appointment_date}}.", {
        customer_name: "sarah",
        appointment_date: "12 September",
      }),
    ).toBe("Hello Sarah, see you 12 September.");
  });

  it("namespaces tool JSON as {{tool.field}}", () => {
    expect(
      flattenToolVariables("Calendar", {
        matched_slot: "2026-09-12T15:30:00",
        match_status: "exact",
      }),
    ).toEqual({
      matched_slot: "2026-09-12T15:30:00",
      match_status: "exact",
      "calendar.matched_slot": "2026-09-12T15:30:00",
      "calendar.match_status": "exact",
    });
  });

  it("fills spoken bracket placeholders from runtime variables", () => {
    expect(
      fillBracketPlaceholders(
        "Just to confirm, the date and time you chose are [chosen date and time], and your email address is [email address].",
        { appointment_date: "12 September", appointment_time: "3:30 PM", email: "a@b.com" },
      ),
    ).toBe(
      "Just to confirm, the date and time you chose are 12 September at 3:30 PM, and your email address is a@b.com.",
    );
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

  it("compiles hybrid prefix + prompt", () => {
    const compiled = compileFlow({
      start_node_id: "opts",
      nodes: [
        {
          id: "opts",
          type: "conversation",
          response_mode: "hybrid",
          instruction: {
            text: "Explain the available appointment options.",
            prefix: "Thanks, {{customer_name}}.",
          },
        },
      ],
    });
    expect(compiled.nodes.get("opts")?.instruction?.type).toBe("hybrid");
    expect(compiled.nodes.get("opts")?.instruction?.prefix).toBe("Thanks, {{customer_name}}.");
  });
});
