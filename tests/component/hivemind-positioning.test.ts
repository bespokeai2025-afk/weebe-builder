import { describe, expect, it } from "vitest";
import { calculateHiveMindAnchor } from "@/components/hivemind/hiveMindPositioning";

describe("HiveMind shell positioning", () => {
  it("uses a deliberate bottom-right shell anchor on standard pages", () => {
    const anchor = calculateHiveMindAnchor({
      viewportWidth: 1440,
      viewportHeight: 900,
      mainLeft: 240,
      mainRight: 1440,
      mainTop: 0,
      orbWidth: 180,
      orbHeight: 145,
      rightReserve: 0,
      bottomReserve: 0,
      cornerBottomReserve: 0,
    });

    expect(anchor.right).toBe(32);
    expect(anchor.bottom).toBe(32);
  });

  it("stays beside a right-side reserve when the main area has room", () => {
    const anchor = calculateHiveMindAnchor({
      viewportWidth: 1440,
      viewportHeight: 900,
      mainLeft: 240,
      mainRight: 1440,
      mainTop: 0,
      orbWidth: 180,
      orbHeight: 145,
      rightReserve: 322,
      bottomReserve: 0,
      cornerBottomReserve: 0,
    });

    expect(anchor.stacksAboveCorner).toBe(false);
    expect(anchor.right).toBe(322);
    expect(anchor.bottom).toBe(32);
    expect(anchor.right).toBeLessThanOrEqual(anchor.maxRight);
  });

  it("stacks above a wide bottom-right widget on narrow screens instead of leaving the viewport", () => {
    const anchor = calculateHiveMindAnchor({
      viewportWidth: 375,
      viewportHeight: 667,
      mainLeft: 0,
      mainRight: 375,
      mainTop: 0,
      orbWidth: 126,
      orbHeight: 105,
      rightReserve: 322,
      bottomReserve: 0,
      cornerBottomReserve: 185,
    });

    expect(anchor.stacksAboveCorner).toBe(true);
    expect(anchor.right).toBe(32);
    expect(anchor.bottom).toBe(185);
    expect(375 - anchor.right - 126).toBeGreaterThanOrEqual(16);
    expect(667 - anchor.bottom).toBeLessThanOrEqual(482);
  });
});