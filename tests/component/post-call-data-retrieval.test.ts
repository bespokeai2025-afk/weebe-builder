/**
 * Post-call data retrieval, Retell-style and general purpose.
 *
 * Three faults stood between the fields in the builder and anything you could see:
 *   1. The schema reader checked a frozen Retell import snapshot first and never read the agent's
 *      `variables` column, so builder edits were ignored — and a builder-only agent had no fields.
 *   2. All custom fields shared one LLM call capped at 900 tokens. Fields that are full prompts in
 *      their own right fought for budget; on a real call 9 of 10 came back empty.
 *   3. Nothing saved the result on the call, so there was nowhere to see it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const gptComplete = vi.fn();
vi.mock("../../src/lib/voice/llm/gpt", () => ({
  gptComplete: (...args: unknown[]) => gptComplete(...args),
  resolveVoiceLlmApiKey: () => "test-key",
}));

const { readAnalysisSchema } = await import("../../src/lib/voice/gateway/telephony-core");
const { extractCustomFields, isNullWord } = await import("../../src/lib/voice/lifecycle/analysis");

describe("readAnalysisSchema — where the fields come from", () => {
  const snapshot = {
    rawAgent: {
      post_call_analysis_data: [
        { name: "old_field", description: "from the import", type: "string" },
      ],
    },
  };

  it("uses the builder's variables column over the Retell import snapshot", () => {
    // The panel edits the column; the snapshot is frozen on import day.
    const schema = readAnalysisSchema(snapshot, [
      { name: "email_address", description: "caller email", type: "string" },
    ]);
    expect(schema.map((f) => f.name)).toEqual(["email_address"]);
  });

  it("extracts fields for an agent built purely in the builder", () => {
    // No snapshot at all: this used to return nothing, so nothing was extracted.
    const schema = readAnalysisSchema({}, [
      { name: "callback_datetime", description: "when to call back", type: "string" },
    ]);
    expect(schema).toHaveLength(1);
  });

  it("falls back to the snapshot only when the builder defines nothing", () => {
    expect(readAnalysisSchema(snapshot, []).map((f) => f.name)).toEqual(["old_field"]);
    expect(readAnalysisSchema(snapshot, null).map((f) => f.name)).toEqual(["old_field"]);
  });

  it("still reads the older settings.variables location", () => {
    const schema = readAnalysisSchema(
      { variables: [{ name: "budget", description: "their budget", type: "number" }] },
      null,
    );
    expect(schema[0]).toMatchObject({ name: "budget", type: "number" });
  });

  it("lets the column win even over the snapshot AND legacy settings together", () => {
    const schema = readAnalysisSchema(
      {
        ...snapshot,
        variables: [{ name: "legacy_field", description: "old location", type: "string" }],
      },
      [{ name: "current_field", description: "what the panel shows", type: "string" }],
    );
    expect(schema.map((f) => f.name)).toEqual(["current_field"]);
  });

  it("keeps the snapshot ahead of the legacy settings location, as before", () => {
    // Only the unread column was the bug; the older order is unchanged.
    const schema = readAnalysisSchema({
      ...snapshot,
      variables: [{ name: "legacy_field", description: "old location", type: "string" }],
    });
    expect(schema.map((f) => f.name)).toEqual(["old_field"]);
  });

  it("still drops a field with no description, which Retell requires", () => {
    // Deliberate existing behaviour — worth knowing when a field seems to vanish.
    expect(readAnalysisSchema({}, [{ name: "email_address", type: "string" }])).toEqual([]);
  });

  it("skips rows with no name", () => {
    expect(readAnalysisSchema({}, [{ name: "  ", description: "x" }])).toEqual([]);
  });
});

describe("extractCustomFields — one call per field", () => {
  beforeEach(() => gptComplete.mockReset());
  const opts = { model: "gpt-4o-mini", apiKey: "k" };

  it("runs each field on its own, the way Retell evaluates them", async () => {
    gptComplete.mockResolvedValue('{"value": "x"}');
    await extractCustomFields(
      "Agent: hi\nUser: hi",
      [
        { name: "a", type: "string", description: "A" },
        { name: "b", type: "string", description: "B" },
        { name: "c", type: "string", description: "C" },
      ],
      opts,
    );
    expect(gptComplete).toHaveBeenCalledTimes(3);
  });

  it("gives each field its own instructions", async () => {
    gptComplete.mockResolvedValue('{"value": null}');
    await extractCustomFields(
      "t",
      [{ name: "email_address", type: "string", description: "Extract the email." }],
      opts,
    );
    const userMsg = gptComplete.mock.calls[0][0][1].content as string;
    expect(userMsg).toContain("Field name: email_address");
    expect(userMsg).toContain("Extract the email.");
  });

  it("keeps a JSON object the model returned without the value wrapper", async () => {
    // structured_json_output's own instructions say "produce a single JSON object".
    gptComplete.mockResolvedValue('{"verified_details": {"name": "Arjo"}}');
    const out = await extractCustomFields(
      "t",
      [{ name: "structured_json_output", type: "string", description: "Return a JSON object." }],
      opts,
    );
    expect(out.structured_json_output).toEqual({ verified_details: { name: "Arjo" } });
  });

  it("returns null for a field the call did not establish", async () => {
    gptComplete.mockResolvedValue('{"value": null}');
    const out = await extractCustomFields("t", [{ name: "calendly_slot", type: "string" }], opts);
    expect(out.calendly_slot).toBeNull();
  });

  it("does not let one failing field blank the others", async () => {
    gptComplete
      .mockResolvedValueOnce('{"value": "arjo@example.com"}')
      .mockRejectedValueOnce(new Error("rate limited"))
      .mockResolvedValueOnce('{"value": "positive"}');
    const out = await extractCustomFields(
      "t",
      [
        { name: "email", type: "string" },
        { name: "broken", type: "string" },
        { name: "mood", type: "string" },
      ],
      opts,
    );
    expect(out).toEqual({ email: "arjo@example.com", broken: null, mood: "positive" });
  });

  it("makes no calls when the agent defines no fields", async () => {
    expect(await extractCustomFields("t", [], opts)).toEqual({});
    expect(gptComplete).not.toHaveBeenCalled();
  });
});

describe("isNullWord", () => {
  it("recognises the words a model writes instead of null", () => {
    // callback_type was stored as the literal text "null".
    for (const w of ["null", "NULL", "None", "n/a", "unknown", "not provided", "not found.", "-"]) {
      expect(isNullWord(w)).toBe(true);
    }
  });

  it("does not swallow real values", () => {
    for (const w of ["no", "yes", "before_legal", "Nullarbor", "0", "2026-09-20 14:00"]) {
      expect(isNullWord(w)).toBe(false);
    }
    expect(isNullWord(null)).toBe(false);
    expect(isNullWord(3)).toBe(false);
  });
});
