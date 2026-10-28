import { describe, expect, it } from "vitest";
import {
  CALL_OUTCOME_FIELD_NAME,
  CALL_OUTCOMES,
  normalizeCallOutcome,
  standardCallOutcomeField,
  withStandardCallOutcome,
} from "@/lib/voice/call-outcome.shared";
import { readCallAnalysisSchema } from "@/lib/voice/gateway/telephony-core";
import { exportAgentJson } from "@/lib/builder/export-conversation-flow";

describe("standard call outcome field", () => {
  it("is an enum of the standard outcomes, listed in priority order", () => {
    const f = standardCallOutcomeField();
    expect(f.name).toBe(CALL_OUTCOME_FIELD_NAME);
    expect(f.type).toBe("enum");
    expect([...f.choices].sort()).toEqual([...CALL_OUTCOMES].sort());
    // Safeguarding and do-not-contact outrank a booking or a callback.
    expect(f.choices.indexOf("vulnerable")).toBeLessThan(f.choices.indexOf("booked"));
    expect(f.choices.indexOf("do_not_contact")).toBeLessThan(f.choices.indexOf("callback_requested"));
    expect(f.description).toMatch(/Pick the FIRST value/);
  });

  it("is added once, and an agent's own call_outcome definition wins", () => {
    const added = withStandardCallOutcome([{ name: "email_address" }]);
    expect(added.map((f) => f.name)).toEqual(["email_address", "call_outcome"]);
    const own = { name: "Call_Outcome", description: "custom", type: "string" };
    expect(withStandardCallOutcome([own])).toEqual([own]);
  });

  it("normalises the model's answer", () => {
    expect(normalizeCallOutcome("Booked")).toBe("booked");
    expect(normalizeCallOutcome("call back")).toBe("callback_requested");
    expect(normalizeCallOutcome("voicemail")).toBe("no_conversation");
    expect(normalizeCallOutcome("do-not-contact")).toBe("do_not_contact");
    expect(normalizeCallOutcome("maybe later?")).toBeNull();
    expect(normalizeCallOutcome("")).toBeNull();
  });
});

describe("every agent reports it", () => {
  it("WEBEE Native: the extraction schema includes it alongside the agent's fields", () => {
    const schema = readCallAnalysisSchema({}, [{ name: "email_address", description: "Email", type: "string" }]);
    expect(schema.map((f) => f.name)).toEqual(["email_address", "call_outcome"]);
    expect(readCallAnalysisSchema({}, []).map((f) => f.name)).toEqual(["call_outcome"]);
  });

  it("Retell export: post_call_analysis_data includes it", () => {
    const exported = exportAgentJson(
      [],
      [],
      {
        agentName: "Outcome test",
        companyName: "",
        globalPrompt: "",
        beginMessage: "",
        model: "gpt-4.1",
        voiceId: "",
        language: "en-GB",
        temperature: 0.3,
      } as never,
      [],
    ) as Record<string, unknown>;
    const fields = JSON.stringify(exported);
    expect(fields).toContain('"name":"call_outcome"');
  });
});
