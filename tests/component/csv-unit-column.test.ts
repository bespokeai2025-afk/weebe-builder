/**
 * A plain "Unit" column must survive import.
 *
 * Owner exports label the property "Unit" ("R3 Bliss 2-V-1"), but only "unitnumber" was recognised
 * as a context column, so the value was dropped on import: it reached neither import_meta nor the
 * notes. A campaign template with a {{property_name}} slot then had nothing real to map to, which
 * is how that slot ended up resolving to the customer's name instead.
 */
import { describe, expect, it } from "vitest";
import {
  autoDetectCsvColumnMapping,
  mapCsvRowsToLeads,
  parseNotesToMeta,
} from "@/lib/whatsapp/csv-leads.shared";

/** Header row and two rows lifted verbatim from the Bliss 2 export. */
const HEADERS = ["Unit", "Name", "Number", "Email"];
const ROWS = [
  {
    Unit: "R3 Bliss 2-V-1",
    Name: "Shamsuddin Abdul Samad Sheikh",
    Number: "(96659) 300-0626",
    Email: "meetshamsg@gmail.com",
  },
  {
    Unit: "R3 Bliss 2-V-2",
    Name: "Mahmood Baqer Abdulredha Alkhaja",
    Number: "(97150) 451-5940",
    Email: "mahkhaj@gmail.com",
  },
];

describe("Bliss 2 owner export", () => {
  it("detects the unit column as property context", () => {
    const mapping = autoDetectCsvColumnMapping(HEADERS);
    expect(mapping).not.toBeNull();
    expect(mapping!.phone).toBe("Number");
    expect(mapping!.full_name).toBe("Name");
    expect(mapping!.email).toBe("Email");
    expect(mapping!.context_columns).toContain("Unit");
  });

  it("carries the unit onto the lead so a template can map to it", () => {
    const mapping = autoDetectCsvColumnMapping(HEADERS)!;
    const leads = mapCsvRowsToLeads(ROWS, mapping);
    expect(leads.length).toBe(2);
    expect(leads[0]!.import_meta?.Unit).toBe("R3 Bliss 2-V-1");
    expect(leads[1]!.import_meta?.Unit).toBe("R3 Bliss 2-V-2");
    // Also readable back out of the notes, which is where older leads keep their context.
    expect(parseNotesToMeta(leads[0]!.notes).Unit).toBe("R3 Bliss 2-V-1");
  });

  it("keeps the country code from the bracketed phone format", () => {
    const mapping = autoDetectCsvColumnMapping(HEADERS)!;
    const leads = mapCsvRowsToLeads(ROWS, mapping);
    // "(97150) 451-5940" is a UAE number; the digits must survive as 971…, not 50…
    expect(leads[1]!.phone.replace(/\D/g, "")).toBe("971504515940");
  });

  it("recognises the other ways an export labels a property", () => {
    for (const header of ["Unit No", "Unit Number", "Villa", "Plot No", "Apartment"]) {
      const mapping = autoDetectCsvColumnMapping([header, "Name", "Number"]);
      expect(mapping?.context_columns, header).toContain(header);
    }
  });
});
