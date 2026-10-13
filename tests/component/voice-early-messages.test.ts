import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { holdEarlyMessages } from "@/lib/voice/gateway/early-messages";

describe("holdEarlyMessages", () => {
  it("replays frames that arrived before the handler, in order, then passes new ones straight through", () => {
    const ws = new EventEmitter();
    const release = holdEarlyMessages(ws as never);
    // Twilio sends these the moment the socket opens, while the call is still being looked up.
    ws.emit("message", Buffer.from('{"event":"connected"}'), false);
    ws.emit("message", Buffer.from('{"event":"start"}'), false);

    const seen: string[] = [];
    ws.on("message", (raw: Buffer) => seen.push(JSON.parse(raw.toString()).event));
    expect(seen).toEqual([]);
    release();
    expect(seen).toEqual(["connected", "start"]);

    ws.emit("message", Buffer.from('{"event":"media"}'), false);
    expect(seen).toEqual(["connected", "start", "media"]);
    release(); // second call is a no-op
    expect(seen).toHaveLength(3);
  });
});
