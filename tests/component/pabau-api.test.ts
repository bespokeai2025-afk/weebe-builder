import { describe, expect, it } from "vitest";
import {
  pabauListItems,
  pabauRequestHeaders,
  pabauSampleRecord,
  resolvePabauApiBase,
} from "@/lib/pabau/pabau-api.shared";

describe("pabau-api.shared", () => {
  it("builds oauth base with raw api key in path (no Bearer)", () => {
    expect(resolvePabauApiBase("abc-123")).toBe("https://api.oauth.pabau.com/abc-123");
    expect(pabauRequestHeaders()).toEqual({ Accept: "application/json" });
    expect(pabauRequestHeaders(true)).toEqual({
      Accept: "application/json",
      "Content-Type": "application/json",
    });
    expect(pabauRequestHeaders()).not.toHaveProperty("Authorization");
  });

  it("flattens nested appointment rows", () => {
    const sample = pabauSampleRecord({
      appointments: [
        {
          details: { appointment_id: 99 },
          dates: { start_date: "2026-04-30", start_time: "10:00:00" },
          client: [{ id: 1, customer_name: "Jane", Mobile: "0700" }],
          service: [{ service: "Consultation" }],
        },
      ],
    });
    expect(sample).toMatchObject({
      appointment_id: 99,
      client_id: 1,
      customer_name: "Jane",
      mobile: "0700",
      service: "Consultation",
    });
  });

  it("parses locations wrapper array", () => {
    const items = pabauListItems({
      locations: [{ id: 3526, location_name: "Medispa Cheshire" }],
    });
    expect(items).toHaveLength(1);
    expect((items[0] as { id: number }).id).toBe(3526);
  });
});
