import { describe, expect, it } from "vitest";
import {
  transcriptFromCall,
  transcriptsFromPostCallJobs,
} from "@/lib/integrations/webespokeEnterprise/wbah-transcript-sources.server";

describe("transcriptFromCall", () => {
  it("uses the transcript text, else builds it from transcript_object", () => {
    expect(transcriptFromCall({ transcript: "Agent: Hi\nUser: Hello" })).toBe("Agent: Hi\nUser: Hello");
    expect(
      transcriptFromCall({
        transcript: "",
        transcript_object: [
          { role: "agent", content: "Hi" },
          { role: "tool_call_invocation", content: "x" },
          { role: "user", content: "Hello" },
        ],
      }),
    ).toBe("agent: Hi\nuser: Hello");
    expect(transcriptFromCall(null)).toBeNull();
  });
});

describe("transcriptsFromPostCallJobs", () => {
  it("returns the newest stored transcript per call", async () => {
    const rows = [
      { retell_call_id: "call_a", call: { transcript: "newest" } },
      { retell_call_id: "call_a", call: { transcript: "older" } },
      { retell_call_id: "call_b", call: { transcript: "" } },
    ];
    const q: any = {
      select: () => q,
      in: () => q,
      order: () => Promise.resolve({ data: rows, error: null }),
    };
    const found = await transcriptsFromPostCallJobs({ from: () => q }, ["call_a", "call_b"]);
    expect(found.get("call_a")).toBe("newest");
    expect(found.has("call_b")).toBe(false);
  });
});
