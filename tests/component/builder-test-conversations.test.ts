/** Builder test conversations and live-version rollback. */
import { describe, expect, it } from "vitest";
import {
  callerLinesFromTranscript,
  evaluateTestConversation,
  normalizeTestConversations,
  type TestConversation,
} from "@/lib/builder/test-conversations.shared";
import { appendPublishLog, previousPublishedVersion } from "@/lib/builder/flow-history";

const test: TestConversation = {
  id: "t1",
  name: "Books a slot",
  callerTurns: ["yes", "Tuesday works"],
  expect: { reachesNodeId: "book", endsCall: true, mustSay: ["Tuesday"], mustNotSay: ["I'm sorry"] },
};

describe("evaluateTestConversation", () => {
  it("passes when every check holds", () => {
    const r = evaluateTestConversation(test, {
      agentLines: ["Hi!", "Great, booked for TUESDAY at 2."],
      nodePath: ["greet", "book", "end"],
      endReason: "agent_hangup",
      errors: [],
    });
    expect(r.passed).toBe(true);
    expect(r.checks).toHaveLength(4);
  });

  it("names what failed, with the path taken", () => {
    const r = evaluateTestConversation(
      test,
      { agentLines: ["I'm sorry, I didn't catch that"], nodePath: ["greet"], endReason: null, errors: [] },
      (id) => (id === "book" ? "Book slot" : id === "greet" ? "Greeting" : id),
    );
    expect(r.passed).toBe(false);
    expect(r.checks.filter((c) => !c.ok).map((c) => c.label)).toEqual([
      "Reaches “Book slot”",
      "Ends the call",
      "Says “Tuesday”",
      "Never says “I'm sorry”",
    ]);
    expect(r.checks[0]!.detail).toBe("Path: Greeting");
  });

  it("a replay error always fails", () => {
    const r = evaluateTestConversation(
      { ...test, expect: {} },
      { agentLines: [], nodePath: [], endReason: null, errors: ["model timeout"] },
    );
    expect(r.passed).toBe(false);
    expect(r.error).toBe("model timeout");
  });
});

describe("normalizeTestConversations", () => {
  it("drops tests with no caller lines and trims blanks", () => {
    const out = normalizeTestConversations([
      { id: "a", name: "", callerTurns: ["  hi ", "", "ok"], expect: {} },
      { id: "b", name: "Empty", callerTurns: ["  "], expect: {} },
      "junk",
    ]);
    expect(out).toEqual([{ id: "a", name: "Untitled test", callerTurns: ["hi", "ok"], expect: {} }]);
  });
});

describe("callerLinesFromTranscript", () => {
  it("keeps the caller's lines from a pasted transcript", () => {
    expect(callerLinesFromTranscript("Agent: Hello\nUser: Yes it's me\nAgent: Great\nUser:  Tuesday  ")).toEqual([
      "Yes it's me",
      "Tuesday",
    ]);
    expect(callerLinesFromTranscript("hello\n\nbye")).toEqual(["hello", "bye"]);
  });
});

describe("previousPublishedVersion", () => {
  const history = [3, 5, 8, 9].map((version) => ({ version, label: "Saved", createdAt: "" }));

  it("steps back to the version live before the current one", () => {
    const log = [{ version: 3, at: "" }, { version: 5, at: "" }, { version: 8, at: "" }];
    expect(previousPublishedVersion(8, log, history)).toBe(5);
  });

  it("after a rollback, the next one goes further back", () => {
    let log = [{ version: 3, at: "" }, { version: 5, at: "" }, { version: 8, at: "" }];
    log = appendPublishLog(log, { version: 5, at: "", rolledBackFrom: 8 });
    expect(previousPublishedVersion(5, log, history)).toBe(3);
  });

  it("skips versions no longer in history; nothing earlier → null", () => {
    expect(previousPublishedVersion(8, [{ version: 4, at: "" }, { version: 8, at: "" }], history)).toBeNull();
  });

  it("falls back to history entries labelled Published for older agents", () => {
    const h = [
      { version: 2, label: "Published", createdAt: "" },
      { version: 6, label: "Saved", createdAt: "" },
    ];
    expect(previousPublishedVersion(6, undefined, h)).toBe(2);
  });
});
