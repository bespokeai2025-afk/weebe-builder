/**
 * Warm transfer over Twilio.
 *
 * Every transfer used to execute as the same blind `<Dial>{number}</Dial>` redirect regardless of
 * what was configured — a caller landed straight on the destination's phone with no briefing, no
 * ring-timeout fallback, and no way to know whether anyone was actually there. These pin the real
 * mechanics: the caller is parked in a conference (not connected yet), the destination is dialled
 * separately and briefed privately, and the two are bridged only once the destination actually
 * answers — with a timeout that reports failure instead of leaving the caller on hold forever.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resolveWarmTransferAnswered,
  resolveWarmTransferSettled,
  warmTransferCall,
  type WarmTransferParams,
} from "@/lib/voice/gateway/telephony.gateway";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.PUBLIC_BASE_URL = "https://app.example.com";
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function baseParams(overrides: Partial<WarmTransferParams["options"]> = {}): WarmTransferParams {
  return {
    callId: "call-abc",
    callSid: "CA123",
    destination: "+447412345678",
    credentials: { accountSid: "ACxxx", authToken: "tok" },
    ownNumber: "+447900000001",
    callerNumber: "+447900000002",
    options: { ringTimeoutMs: 100, ...overrides },
  };
}

describe("warmTransferCall", () => {
  it("parks the caller in a conference — not connected — before dialling the destination", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    global.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: String(init?.body ?? "") });
      if (calls.length === 1) return { ok: true } as Response;
      return { ok: true } as Response;
    }) as typeof fetch;

    const promise = warmTransferCall(baseParams());
    // Give the two sequential fetches a tick to fire before we resolve/timeout.
    await new Promise((r) => setTimeout(r, 5));
    resolveWarmTransferAnswered("call-abc");
    await promise;

    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toContain("/Calls/CA123.json");
    const holdBody = decodeURIComponent(calls[0]!.body);
    expect(holdBody).toContain('startConferenceOnEnter="false"');
    expect(holdBody).not.toContain("<Dial>+447412345678</Dial>"); // never a direct blind dial
  });

  it("dials the destination with a briefing URL and the configured ring timeout", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    global.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: String(init?.body ?? "") });
      return { ok: true } as Response;
    }) as typeof fetch;

    const promise = warmTransferCall(baseParams({ ringTimeoutMs: 20_000, privateHandoffText: "Refund request." }));
    await new Promise((r) => setTimeout(r, 5));
    resolveWarmTransferAnswered("call-abc");
    await promise;

    const dialCall = calls[1]!;
    expect(dialCall.url).toContain("/Calls.json");
    const params = new URLSearchParams(dialCall.body);
    expect(params.get("To")).toBe("+447412345678");
    expect(params.get("Timeout")).toBe("20");
    expect(params.get("Url")).toContain("/api/public/telephony/warm-transfer-brief/call-abc");
    expect(params.get("Url")).toContain("say=Refund");
    expect(params.get("StatusCallback")).toContain("/api/public/telephony/warm-transfer-status/call-abc");
  });

  it("uses the agent's own number as caller ID by default, not the caller's", async () => {
    global.fetch = (async () => ({ ok: true }) as Response) as typeof fetch;
    const promise = warmTransferCall(baseParams());
    await new Promise((r) => setTimeout(r, 5));
    resolveWarmTransferAnswered("call-abc");
    expect(await promise).toBe(true);
  });

  it("passes the caller's own number through when show_transferee_as_caller is set", async () => {
    const calls: string[] = [];
    global.fetch = (async (_url: string, init?: RequestInit) => {
      calls.push(String(init?.body ?? ""));
      return { ok: true } as Response;
    }) as typeof fetch;

    const promise = warmTransferCall(baseParams({ showTransfereeAsCaller: true }));
    await new Promise((r) => setTimeout(r, 5));
    resolveWarmTransferAnswered("call-abc");
    await promise;

    const dialParams = new URLSearchParams(calls[1]!);
    expect(dialParams.get("From")).toBe("+447900000002"); // callerNumber, not ownNumber
  });

  it("resolves true once the status callback reports the destination answered", async () => {
    global.fetch = (async () => ({ ok: true }) as Response) as typeof fetch;
    const promise = warmTransferCall(baseParams());
    await new Promise((r) => setTimeout(r, 5));
    resolveWarmTransferAnswered("call-abc");
    expect(await promise).toBe(true);
  });

  it("resolves false when the destination leg ends without ever answering", async () => {
    global.fetch = (async () => ({ ok: true }) as Response) as typeof fetch;
    const promise = warmTransferCall(baseParams());
    await new Promise((r) => setTimeout(r, 5));
    resolveWarmTransferSettled("call-abc", "no-answer");
    expect(await promise).toBe(false);
  });

  it("ignores a non-terminal status update rather than settling early", async () => {
    global.fetch = (async () => ({ ok: true }) as Response) as typeof fetch;
    const promise = warmTransferCall(baseParams({ ringTimeoutMs: 60 }));
    await new Promise((r) => setTimeout(r, 5));
    resolveWarmTransferSettled("call-abc", "ringing"); // not terminal — must not resolve the promise
    resolveWarmTransferAnswered("call-abc");
    expect(await promise).toBe(true);
  });

  it("gives up and reports failure if nothing ever answers within the ring window", async () => {
    vi.useFakeTimers();
    global.fetch = (async () => ({ ok: true }) as Response) as typeof fetch;
    const resultPromise = warmTransferCall(baseParams({ ringTimeoutMs: 20_000 }));
    // The implementation waits ringTimeoutMs plus a fixed margin for the brief
    // message to finish before a join would be reported — nothing ever calls
    // resolveWarmTransferAnswered/-Settled here, so only that timeout ends it.
    await vi.advanceTimersByTimeAsync(20_000 + 15_000 + 100);
    expect(await resultPromise).toBe(false);
    vi.useRealTimers();
  });

  it("fails cleanly when Twilio rejects the initial hold redirect", async () => {
    global.fetch = (async () => ({ ok: false, status: 400 }) as Response) as typeof fetch;
    expect(await warmTransferCall(baseParams())).toBe(false);
  });

  it("fails cleanly when Twilio rejects the outbound dial", async () => {
    let call = 0;
    global.fetch = (async () => {
      call++;
      return { ok: call !== 2 } as Response; // hold succeeds, dial-out fails
    }) as typeof fetch;
    expect(await warmTransferCall(baseParams())).toBe(false);
  });

  it("escapes free-text briefing content so it cannot break the TwiML", async () => {
    const calls: string[] = [];
    global.fetch = (async (_url: string, init?: RequestInit) => {
      calls.push(String(init?.body ?? ""));
      return { ok: true } as Response;
    }) as typeof fetch;

    const promise = warmTransferCall(
      baseParams({ publicHandoffText: `Transferring & <hanging up>` }),
    );
    await new Promise((r) => setTimeout(r, 5));
    resolveWarmTransferAnswered("call-abc");
    await promise;

    const holdBody = new URLSearchParams(calls[0]!).get("Twiml") ?? "";
    expect(holdBody).toContain("&amp;");
    expect(holdBody).toContain("&lt;hanging up&gt;");
    expect(holdBody).not.toContain("<hanging up>");
  });
});
