/**
 * Auto Dialer — the rules that decide what gets dialled and how the queue advances.
 *
 * Two failure modes this pins down:
 *  1. A malformed number in the pasted list silently drops a person from the run
 *     instead of being reported, so "I gave you 50 numbers" quietly becomes 47.
 *  2. A normal <Dial> completion fires two Twilio webhooks for the same call leg
 *     (the Dial action, and the outer call's own status callback) — without the
 *     `advanced_at` guard, the queue would dial the next target twice.
 */
import { describe, expect, it } from "vitest";
import {
  isValidE164,
  toE164,
  parseDialerTargetList,
  dedupeDialerTargets,
  validateRouteNumbers,
  buildSimulRingTwiml,
  mapDialResultStatus,
  mapLeadCallStatus,
  isTerminalTargetStatus,
} from "@/lib/telephony/auto-dialer.shared";

describe("isValidE164 / toE164", () => {
  it("accepts a well-formed international number", () => {
    expect(isValidE164("+971501234567")).toBe(true);
  });

  it("rejects a bare local number with no country code", () => {
    expect(isValidE164("0501234567")).toBe(false);
  });

  it("normalises a plain digit string to E.164", () => {
    expect(toE164("971501234567")).toBe("+971501234567");
  });

  it("normalises 00-prefixed international dialling format", () => {
    expect(toE164("00971501234567")).toBe("+971501234567");
  });

  it("strips spaces, dots and brackets before validating", () => {
    expect(toE164("+971 50 123 4567")).toBe("+971501234567");
    expect(toE164("(971) 501-234-567")).toBe("+971501234567");
  });

  it("refuses anything with letters, rather than guessing", () => {
    expect(toE164("call me maybe")).toBe("");
  });

  it("refuses a string too short to be a real number", () => {
    expect(toE164("12345")).toBe("");
  });
});

describe("parseDialerTargetList", () => {
  it("parses 'Name, phone' pairs", () => {
    const { targets, errors } = parseDialerTargetList("Ali, +971501234567\nSara, +971509876543");
    expect(errors).toHaveLength(0);
    expect(targets).toEqual([
      { name: "Ali", phone: "+971501234567" },
      { name: "Sara", phone: "+971509876543" },
    ]);
  });

  it("accepts a bare phone number with no name", () => {
    const { targets, errors } = parseDialerTargetList("+971501234567");
    expect(errors).toHaveLength(0);
    expect(targets).toEqual([{ name: null, phone: "+971501234567" }]);
  });

  it("skips blank lines silently, but reports a bad line with its number", () => {
    const { targets, errors } = parseDialerTargetList(
      "+971501234567\n\n   \nnot a number\n+971509876543",
    );
    expect(targets).toHaveLength(2);
    expect(errors).toEqual([{ line: 4, raw: "not a number", reason: "Not a valid phone number" }]);
  });

  it("never drops an invalid row without reporting it", () => {
    const raw = Array.from({ length: 20 }, (_, i) => (i % 5 === 0 ? "bad-row" : `+97150000000${i}`)).join(
      "\n",
    );
    const { targets, errors } = parseDialerTargetList(raw);
    expect(targets.length + errors.length).toBe(20);
  });
});

describe("dedupeDialerTargets", () => {
  it("keeps the first occurrence of a repeated number", () => {
    const out = dedupeDialerTargets([
      { name: "First", phone: "+971501234567" },
      { name: "Duplicate", phone: "+971501234567" },
      { name: "Other", phone: "+971509876543" },
    ]);
    expect(out).toEqual([
      { name: "First", phone: "+971501234567" },
      { name: "Other", phone: "+971509876543" },
    ]);
  });
});

describe("validateRouteNumbers", () => {
  it("requires exactly 2 numbers", () => {
    expect(validateRouteNumbers(["+971501234567"]).ok).toBe(false);
    expect(validateRouteNumbers(["+971501234567", "+971509876543", "+971501111111"]).ok).toBe(false);
  });

  it("rejects a malformed route number", () => {
    const r = validateRouteNumbers(["+971501234567", "0501234567"]);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/0501234567/);
  });

  it("rejects the same number twice", () => {
    const r = validateRouteNumbers(["+971501234567", "+971501234567"]);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/different/i);
  });

  it("accepts two distinct valid numbers", () => {
    expect(validateRouteNumbers(["+971501234567", "+971509876543"])).toEqual({ ok: true, error: null });
  });
});

describe("buildSimulRingTwiml", () => {
  const twiml = buildSimulRingTwiml({
    routeNumbers: ["+971501234567", "+971509876543"],
    timeoutSecs: 20,
    actionUrl: "https://app.example.com/api/public/telephony/dialer-result/abc-123",
    legAnsweredUrls: [
      "https://app.example.com/api/public/telephony/dialer-leg-answered/abc-123/0",
      "https://app.example.com/api/public/telephony/dialer-leg-answered/abc-123/1",
    ],
    callerId: "+971500000000",
  });

  it("rings both numbers inside a single <Dial>, not sequentially", () => {
    expect(twiml).toContain("<Number");
    expect((twiml.match(/<Number/g) ?? []).length).toBe(2);
    expect(twiml).toContain("+971501234567");
    expect(twiml).toContain("+971509876543");
  });

  it("bridges to whichever answers first — no <Dial> nesting or sequencing", () => {
    // A single <Dial> wrapping multiple <Number> nouns is what makes this
    // simultaneous; two separate <Dial> blocks would ring them one after another.
    expect((twiml.match(/<Dial/g) ?? []).length).toBe(1);
  });

  it("points the action at the per-target result webhook", () => {
    expect(twiml).toContain('action="https://app.example.com/api/public/telephony/dialer-result/abc-123"');
  });

  it("clamps an out-of-range ring timeout instead of sending it to Twilio raw", () => {
    const short = buildSimulRingTwiml({
      routeNumbers: ["+971501234567", "+971509876543"],
      timeoutSecs: 2,
      actionUrl: "https://x/action",
      legAnsweredUrls: ["https://x/0", "https://x/1"],
      callerId: "+971500000000",
    });
    expect(short).toContain('timeout="5"');
  });

  it("escapes XML-significant characters in a number or URL", () => {
    const t = buildSimulRingTwiml({
      routeNumbers: ["+971501234567", "+971509876543"],
      timeoutSecs: 20,
      actionUrl: "https://x/action?a=1&b=2",
      legAnsweredUrls: ["https://x/0", "https://x/1"],
      callerId: "+971500000000",
    });
    expect(t).toContain("&amp;");
    expect(t).not.toContain("?a=1&b=2");
  });
});

describe("mapDialResultStatus", () => {
  it("maps a normal bridge to 'bridged'", () => {
    expect(mapDialResultStatus("completed")).toBe("bridged");
  });

  it("maps no-answer and busy to their own states, not a generic failure", () => {
    expect(mapDialResultStatus("no-answer")).toBe("no_answer");
    expect(mapDialResultStatus("busy")).toBe("busy");
  });

  it("falls back to 'failed' for an unrecognised status rather than throwing", () => {
    expect(mapDialResultStatus("something-new-twilio-added")).toBe("failed");
  });
});

describe("mapLeadCallStatus", () => {
  it("reports no-answer/busy/failed on the target's own leg — the case <Dial> never sees", () => {
    expect(mapLeadCallStatus("no-answer")).toBe("no_answer");
    expect(mapLeadCallStatus("busy")).toBe("busy");
    expect(mapLeadCallStatus("failed")).toBe("failed");
  });

  it("does not report an outcome while the call is still being set up", () => {
    expect(mapLeadCallStatus("queued")).toBeNull();
    expect(mapLeadCallStatus("initiated")).toBeNull();
  });

  it("does not report an outcome once <Dial> has taken over — the action callback owns it", () => {
    expect(mapLeadCallStatus("in-progress")).toBeNull();
  });

  it("still reports the ambiguous terminal 'completed', for the caller's own de-duplication to handle", () => {
    expect(mapLeadCallStatus("completed")).toBe("completed");
  });
});

describe("isTerminalTargetStatus", () => {
  it("treats bridged/no_answer/busy/failed/completed as terminal", () => {
    for (const s of ["bridged", "no_answer", "busy", "failed", "completed"]) {
      expect(isTerminalTargetStatus(s)).toBe(true);
    }
  });

  it("treats pending/dialing/ringing as not terminal", () => {
    for (const s of ["pending", "dialing", "ringing"]) {
      expect(isTerminalTargetStatus(s)).toBe(false);
    }
  });
});
