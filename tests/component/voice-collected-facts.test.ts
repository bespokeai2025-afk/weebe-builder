import { describe, expect, it } from "vitest";

import { summarizeCollectedFacts } from "@/lib/voice/graph/collected-facts.shared";

describe("summarizeCollectedFacts", () => {
  it("records property facts already given by the caller", () => {
    const summary = summarizeCollectedFacts([
      { role: "user", content: "It's an apartment." },
      { role: "user", content: "Five thousand square meters and five bedrooms." },
      { role: "user", content: "Twenty-five million dollars." },
    ]);
    expect(summary).toContain("property type: apartment");
    expect(summary).toContain("property size already mentioned");
    expect(summary).toContain("price point already mentioned");
  });

  it("flags address fragments", () => {
    const summary = summarizeCollectedFacts([
      { role: "user", content: "It's Twenty Four Street." },
      { role: "user", content: "Dubai." },
    ]);
    expect(summary).toContain("address or location already mentioned");
  });
});
