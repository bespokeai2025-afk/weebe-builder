import { describe, expect, it } from "vitest";

import { BurstTranscripts, joinBurstTranscripts } from "@/lib/voice/gateway/burst-transcripts";

function deferred() {
  let resolve!: (v: string) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("BurstTranscripts", () => {
  it("joins a paused answer's bursts in the order spoken", async () => {
    const bursts = new BurstTranscripts();
    bursts.request(async () => "24 Main Street.");
    bursts.request(async () => "Dubai.");
    expect(await joinBurstTranscripts(bursts.take())).toBe("24 Main Street. Dubai.");
  });

  it("does not send a burst's request until the one before it has returned", async () => {
    const bursts = new BurstTranscripts();
    const first = deferred();
    let secondStarted = false;
    bursts.request(() => first.promise);
    bursts.request(async () => {
      secondStarted = true;
      return "two";
    });
    await flush();
    expect(secondStarted).toBe(false);
    first.resolve("one");
    expect(await joinBurstTranscripts(bursts.take())).toBe("one two");
    expect(secondStarted).toBe(true);
  });

  it("keeps going after a failed request, and the turn sees the failure", async () => {
    const bursts = new BurstTranscripts();
    bursts.request(async () => {
      throw new Error("socket closed");
    });
    const failed = bursts.take();
    await expect(joinBurstTranscripts(failed)).rejects.toThrow("socket closed");
    bursts.request(async () => "next turn");
    expect(await joinBurstTranscripts(bursts.take())).toBe("next turn");
  });

  it("starts each utterance empty, and drops empty bursts from the text", async () => {
    const bursts = new BurstTranscripts();
    bursts.request(async () => "  ");
    bursts.request(async () => "yes");
    expect(await joinBurstTranscripts(bursts.take())).toBe("yes");
    expect(bursts.take()).toEqual([]);
  });
});
