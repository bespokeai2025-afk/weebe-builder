/**
 * Auto Dialer keeps exactly as many calls live as there are people to take them. With two people,
 * two leads can be on the phone at once and a third is never dialled while both are busy.
 */
import { describe, expect, it } from "vitest";
import {
  capacityUsed,
  chooseRouteNumbers,
  dialerCapacity,
  statusLabel,
} from "@/lib/telephony/auto-dialer.shared";

const A = "+447700900001";
const B = "+447700900002";
const used = (live: Array<{ status: string; bridged_number?: string | null }>) =>
  live.reduce((n, t) => n + capacityUsed(t), 0);

describe("auto dialer capacity", () => {
  it("allows one live call per person", () => {
    expect(dialerCapacity([A])).toBe(1);
    expect(dialerCapacity([A, B])).toBe(2);
  });

  it("stops dialling while both people are on calls", () => {
    const live = [
      { status: "connected", bridged_number: A },
      { status: "connected", bridged_number: B },
    ];
    expect(used(live)).toBe(2);
    expect(used(live) >= dialerCapacity([A, B])).toBe(true); // no third call
  });

  it("dials again as soon as one person is free", () => {
    const live = [{ status: "connected", bridged_number: A }];
    expect(used(live) < dialerCapacity([A, B])).toBe(true);
  });

  it("counts a call still ringing out as needing one person", () => {
    expect(capacityUsed({ status: "dialing" })).toBe(1);
    expect(capacityUsed({ status: "ringing" })).toBe(1);
    expect(capacityUsed({ status: "bridged", bridged_number: A })).toBe(0); // finished
  });
});

describe("who an answered lead rings", () => {
  it("rings everyone free when it is the only live call, holding them both", () => {
    const chosen = chooseRouteNumbers({ routeNumbers: [A, B], otherLive: [] });
    expect(chosen.map((c) => c.number)).toEqual([A, B]);
    expect(capacityUsed({ status: "connecting", bridged_number: `${A},${B}` })).toBe(2);
  });

  it("rings only the free person when the other is on a call", () => {
    const chosen = chooseRouteNumbers({
      routeNumbers: [A, B],
      otherLive: [{ status: "connected", bridged_number: A }],
    });
    expect(chosen).toEqual([{ number: B, index: 1 }]);
  });

  it("gives a second answered lead its own person while another call is still ringing out", () => {
    const chosen = chooseRouteNumbers({ routeNumbers: [A, B], otherLive: [{ status: "dialing" }] });
    expect(chosen).toEqual([{ number: A, index: 0 }]);
  });

  it("rings nobody when everyone is busy", () => {
    expect(
      chooseRouteNumbers({
        routeNumbers: [A, B],
        otherLive: [
          { status: "connected", bridged_number: A },
          { status: "connecting", bridged_number: B },
        ],
      }),
    ).toEqual([]);
  });

  it("labels the new states", () => {
    expect(statusLabel("connecting")).toBe("Ringing your team…");
    expect(statusLabel("connected")).toBe("On call");
  });
});
