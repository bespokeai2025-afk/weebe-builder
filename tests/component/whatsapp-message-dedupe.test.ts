import { describe, expect, it } from "vitest";

import {
  findRedundantOptimisticMessageIds,
  isSyntheticWatiMessageId,
} from "@/lib/whatsapp/whatsapp-message-dedupe.server";

const BASE = Date.parse("2026-08-13T09:35:25.000Z");
const at = (offsetMs: number) => new Date(BASE + offsetMs).toISOString();

/** The row the send handler writes before WATI reports the real message id. */
function optimistic(id: string, body: string, offsetMs: number) {
  return {
    id,
    external_id: `wati_session_${BASE + offsetMs}`,
    whatsapp_message_id: null,
    sent_at: at(offsetMs),
    body,
    direction: "outbound",
  };
}

/** The row the API sync or webhook writes, carrying WATI's own id. */
function confirmed(id: string, body: string, offsetMs: number) {
  return {
    id,
    external_id: `wamid.${id}`,
    whatsapp_message_id: `wamid.${id}`,
    sent_at: at(offsetMs),
    body,
    direction: "outbound",
  };
}

describe("isSyntheticWatiMessageId", () => {
  it("recognises the ids we mint when a WATI send response carries none", () => {
    expect(isSyntheticWatiMessageId("wati_session_1786613726373")).toBe(true);
    expect(isSyntheticWatiMessageId("wati_tpl_1786613726373")).toBe(true);
    expect(isSyntheticWatiMessageId("wati_file_1786613726373")).toBe(true);
    expect(isSyntheticWatiMessageId("wati_1786613726373")).toBe(true);
  });

  it("leaves real WATI and Twilio ids alone", () => {
    expect(isSyntheticWatiMessageId("wamid.HBgMOTcxNTA1NTg3MTE1FQIAERgSQjhGNDEyQTVGQ0I2")).toBe(
      false,
    );
    expect(isSyntheticWatiMessageId("SM1234567890abcdef")).toBe(false);
    expect(isSyntheticWatiMessageId("wati_session_abc")).toBe(false);
    expect(isSyntheticWatiMessageId(null)).toBe(false);
  });
});

describe("findRedundantOptimisticMessageIds", () => {
  it("drops the optimistic copy of a message WATI has confirmed", () => {
    // The duplicate as it appeared in production: same text, 1.4s apart, sync won the race.
    const rows = [
      confirmed("real-1", "Okay, thank you", 0),
      optimistic("optimistic-1", "Okay, thank you", 1374),
    ];

    expect(findRedundantOptimisticMessageIds(rows)).toEqual(["optimistic-1"]);
  });

  it("keeps the optimistic row while WATI has not confirmed it yet", () => {
    const rows = [optimistic("optimistic-1", "Okay, thank you", 0)];

    expect(findRedundantOptimisticMessageIds(rows)).toEqual([]);
  });

  it("keeps both messages when the same text is genuinely sent twice", () => {
    const rows = [
      confirmed("real-1", "Okay, thank you", 0),
      optimistic("optimistic-1", "Okay, thank you", 1000),
      confirmed("real-2", "Okay, thank you", 4000),
      optimistic("optimistic-2", "Okay, thank you", 5000),
    ];

    // One confirmed row may only absorb one optimistic row, so two messages survive.
    expect(findRedundantOptimisticMessageIds(rows).sort()).toEqual([
      "optimistic-1",
      "optimistic-2",
    ]);
  });

  it("keeps a repeat send whose confirmation has not arrived", () => {
    const rows = [
      confirmed("real-1", "Okay, thank you", 0),
      optimistic("optimistic-1", "Okay, thank you", 1000),
      optimistic("optimistic-2", "Okay, thank you", 5000),
    ];

    expect(findRedundantOptimisticMessageIds(rows)).toHaveLength(1);
  });

  it("does not pair rows outside the race window", () => {
    const rows = [
      confirmed("real-1", "Okay, thank you", 0),
      optimistic("optimistic-1", "Okay, thank you", 60_000),
    ];

    expect(findRedundantOptimisticMessageIds(rows)).toEqual([]);
  });

  it("does not pair different message bodies", () => {
    const rows = [
      confirmed("real-1", "Okay, thank you", 0),
      optimistic("optimistic-1", "Something else", 1000),
    ];

    expect(findRedundantOptimisticMessageIds(rows)).toEqual([]);
  });

  it("ignores whitespace differences between the two copies", () => {
    const rows = [
      confirmed("real-1", "Okay, thank you ", 0),
      optimistic("optimistic-1", "Okay, thank you", 1000),
    ];

    expect(findRedundantOptimisticMessageIds(rows)).toEqual(["optimistic-1"]);
  });

  it("never drops a row carrying a real WATI id", () => {
    const rows = [
      confirmed("real-1", "Okay, thank you", 0),
      confirmed("real-2", "Okay, thank you", 1000),
    ];

    expect(findRedundantOptimisticMessageIds(rows)).toEqual([]);
  });

  it("leaves inbound replies untouched", () => {
    const rows = [
      { ...confirmed("real-1", "It's sold", 0), direction: "inbound" },
      { ...optimistic("optimistic-1", "It's sold", 1000), direction: "inbound" },
    ];

    expect(findRedundantOptimisticMessageIds(rows)).toEqual([]);
  });
});
