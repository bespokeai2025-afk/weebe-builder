/**
 * WBAH People rows built from the stored CRM blobs, whose keys differ by source.
 */
import { describe, expect, it } from "vitest";
import { firstText, mapWbahCatRow } from "@/components/data/wbah-people-row";

describe("mapWbahCatRow", () => {
  it("reads camelCase WeeBespoke fields and snake_case sync fields", () => {
    const row = mapWbahCatRow(
      {
        id: "lead-1",
        full_name: "Jo Bloggs",
        phone: "+447700900123",
        external_status_label: "Tried To Contact",
        created_at: "2026-10-01T09:00:00Z",
        meta: {
          raw_lead: {
            emailAddress: "jo@example.com",
            callStatus: "completed",
            sentimentAnalysis: "Positive",
            startTimestamp: "1793198799256",
            durationMs: "61000",
            wbah_call_id: "call_abc",
          },
          raw_call: { call_summary: "Booked a consultation." },
          raw_crm: { lead_status: "Tried To Contact", need_to_call: true },
        },
      },
      4,
    );
    expect(row).toMatchObject({
      id: "lead-1",
      srNo: 5,
      contact: "+447700900123",
      email: "jo@example.com",
      callType: "Tried To Contact",
      callStatus: "completed",
      sentimentAnalysis: "Positive",
      startTimestamp: 1793198799256,
      durationMs: 61000,
      callSummary: "Booked a consultation.",
      wbahCallId: "call_abc",
      hasTranscript: true,
      loadedAt: "2026-10-01T09:00:00Z",
    });
  });

  it("copes with a row that has no stored blobs", () => {
    const row = mapWbahCatRow({ id: "lead-2", phone: null, meta: null }, 0);
    expect(row.callStatus).toBeNull();
    expect(row.startTimestamp).toBeNull();
    expect(row.callType).toBe("Lead");
    expect(row.hasTranscript).toBe(false);
  });
});

describe("firstText", () => {
  it("returns the first set value as text, keeping empty strings", () => {
    expect(firstText(undefined, null, "", "x")).toBe("");
    expect(firstText(undefined, 42)).toBe("42");
    expect(firstText(null, undefined)).toBeNull();
  });
});
