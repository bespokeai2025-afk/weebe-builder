/**
 * Catch-all edge routing without the classifier.
 *
 * Each "no classifier" case below is a real (node, utterance) pair taken from a live call's logs
 * where a ~1.2-2.4s `classify()` call was spent deciding whether a reply satisfied an edge whose
 * condition already said it accepted anything. The fake LLM throws, so any case that still reaches
 * the classifier fails loudly rather than silently regressing to the slow path.
 */
import { describe, expect, it } from "vitest";
import { selectEdge } from "@/lib/voice/graph/router";

/**
 * Counts classifier calls rather than throwing on them: `selectEdge` catches a classifier
 * rejection and quietly degrades to a fallback edge, so a throw cannot distinguish
 * "the heuristic handled it" from "the classifier ran and failed".
 */
function countingLlm() {
  const spy = { calls: 0 };
  const llm = {
    classify: async () => {
      spy.calls += 1;
      return 0;
    },
    generate: async () => "",
    extract: async () => ({}),
  } as never;
  return { llm, spy };
}

function edges(...conds: string[]) {
  return conds.map((prompt, i) => ({
    id: `e${i}`,
    destination_node_id: `d${i}`,
    transition_condition: { type: "prompt" as const, prompt },
  }));
}

/** `flex: false` is strict mode — the setting the live flow runs under. */
function ctx(userText: string, flex: boolean) {
  return {
    history: [{ role: "user" as const, content: userText }],
    variables: {},
    globalPrompt: "",
    flex,
  } as never;
}

const FAST_METHODS = ["generic_single", "heuristic", "unconditional"];

describe("catch-all edges resolve without the classifier, in strict mode", () => {
  const cases: Array<[utterance: string, conditions: string[]]> = [
    ["Myself", ["any answer"]],
    ["It's not occupied.", ["any acknowledgement "]],
    ["No. No.", ["any acknowledgement "]],
    ["Six. Six six bedrooms.", ["any answer"]],
    ["as fast as possible.", ["any answer"]],
    ["Sounds great.", ["any answer or acknowledgement"]],
    ["Okay.", ["ok thankyou, or any response"]],
    ["Empty. It's empty", ["any acknowledgement, or any response"]],
    ["11 Clowns Street, London.", ["user gives details requested", "user doesnt give details"]],
  ];

  for (const [utterance, conditions] of cases) {
    it(`"${utterance}" → ${conditions[0]}`, async () => {
      const { llm, spy } = countingLlm();
      const result = await selectEdge(edges(...conditions), ctx(utterance, false), llm);
      expect(spy.calls).toBe(0);
      expect(result.edge).not.toBeNull();
      expect(FAST_METHODS).toContain(result.method);
    });
  }
});

describe("guards that must keep reaching the classifier", () => {
  const guards: Array<[name: string, utterance: string, conditions: string[]]> = [
    ["a caller's own question is not absorbed in strict mode", "What does that mean?", ["any answer"]],
    [
      "a negated condition is never a catch-all",
      "Six bedrooms",
      ["user doesnt give details", "if its freehold"],
    ],
    [
      "conditions naming a specific value still need semantic matching",
      "It's a free wall.",
      ["if its freehold", "if its leasehold"],
    ],
    [
      "a decline does not take a catch-all that asked for a positive answer",
      "No, not interested at all.",
      ["any acknowledgment thats positive", "if its freehold"],
    ],
    [
      "two catch-alls on one node is a real ambiguity",
      "Six bedrooms",
      ["any answer", "any other response", "if its freehold"],
    ],
  ];

  for (const [name, utterance, conditions] of guards) {
    it(name, async () => {
      const { llm, spy } = countingLlm();
      await selectEdge(edges(...conditions), ctx(utterance, false), llm);
      expect(spy.calls).toBe(1);
    });
  }
});

describe("flex mode keeps its existing behaviour", () => {
  it("still absorbs a question on a lone generic edge", async () => {
    const { llm, spy } = countingLlm();
    const result = await selectEdge(edges("any answer"), ctx("What does that mean?", true), llm);
    expect(spy.calls).toBe(0);
    expect(result.method).toBe("generic_single");
  });
});

/**
 * "It's a house." was being read as an address (any 3+ word reply containing "house") and then
 * routed to the first edge whose wording mentioned "property" — which in a real flow was the
 * "flat or apartment" branch. That sent houses into the floor question. The agent then ignored the
 * floor node's instruction and asked something else, which looked like it had gone off-script.
 */
describe("a building-type answer is not an address", () => {
  const conds = [
    "if property is a flat or apartment",
    "no thats not correct",
    "if its a house, or detached house, or semi detached house",
  ];

  it("routes 'It's a house.' to the house edge, not the first edge mentioning property", async () => {
    const { llm } = countingLlm();
    const result = await selectEdge(edges(...conds), ctx("It's a house.", false), llm);
    expect(result.edge?.destination_node_id).not.toBe("d0");
  });

  it("still recognises a real street address", async () => {
    const { looksLikeAddressAnswer } = await import("@/lib/voice/graph/router");
    expect(looksLikeAddressAnswer("12 Shadar Street Manchester City MP4 0WC")).toBe(true);
    expect(looksLikeAddressAnswer("It's a house.")).toBe(false);
  });
});
