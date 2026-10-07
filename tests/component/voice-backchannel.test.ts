import { describe, expect, it } from "vitest";
import { BackchannelScheduler, prepareBackchannelClip } from "@/lib/voice/backchannel.shared";

/** Feed `ms` of audio at one level in 50ms frames; return the times a backchannel fired. */
function feed(s: BackchannelScheduler, start: number, ms: number, rms: number, opts: { busy?: boolean; random?: number } = {}) {
  const fired: number[] = [];
  for (let t = 0; t < ms; t += 50) {
    const now = start + t;
    if (s.onFrame({ now, rms, frameMs: 50, agentBusy: Boolean(opts.busy), random: () => opts.random ?? 0 })) fired.push(now);
  }
  return fired;
}

describe("backchannel timing", () => {
  it("fires at a short pause inside a long turn", () => {
    const s = new BackchannelScheduler({ frequency: 1 });
    s.startTalking(0);
    expect(feed(s, 0, 3500, 3000)).toEqual([]);
    expect(feed(s, 3500, 400, 50)).toHaveLength(1);
  });

  it("never fires early in a turn, while the agent is busy, or more than once per pause", () => {
    const early = new BackchannelScheduler({ frequency: 1 });
    early.startTalking(0);
    feed(early, 0, 1000, 3000);
    expect(feed(early, 1000, 600, 50)).toEqual([]);

    const busy = new BackchannelScheduler({ frequency: 1 });
    busy.startTalking(0);
    feed(busy, 0, 4000, 3000);
    expect(feed(busy, 4000, 600, 50, { busy: true })).toEqual([]);

    const once = new BackchannelScheduler({ frequency: 1 });
    once.startTalking(0);
    feed(once, 0, 4000, 3000);
    expect(feed(once, 4000, 1500, 50)).toHaveLength(1);
  });

  it("keeps a gap between backchannels and respects the frequency", () => {
    const s = new BackchannelScheduler({ frequency: 1, minGapMs: 5000 });
    s.startTalking(0);
    feed(s, 0, 4000, 3000);
    expect(feed(s, 4000, 400, 50)).toHaveLength(1);
    feed(s, 4400, 1500, 3000);
    expect(feed(s, 5900, 400, 50)).toEqual([]); // inside the gap

    const rare = new BackchannelScheduler({ frequency: 0.3 });
    rare.startTalking(0);
    feed(rare, 0, 4000, 3000);
    expect(feed(rare, 4000, 400, 50, { random: 0.9 })).toEqual([]);
  });

  it("trims silence and softens the clip", () => {
    const pcm = Buffer.alloc(2 * 10);
    pcm.writeInt16LE(0, 0);
    pcm.writeInt16LE(10000, 4);
    pcm.writeInt16LE(-10000, 6);
    const clip = prepareBackchannelClip(pcm, 0.5);
    expect(clip.byteLength).toBe(4);
    expect(clip.readInt16LE(0)).toBe(5000);
  });
});
