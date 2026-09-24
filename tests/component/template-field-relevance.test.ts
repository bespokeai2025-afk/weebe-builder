/**
 * Which fields the template variable picker offers.
 *
 * The picker showed one hardcoded list of ~30 column spellings plus every meta key ever seen, so
 * mapping a variable for the "Bliss 2" upload meant choosing from 55 options when only 8 of them
 * hold data. Picking a dead one is not a visible error — the send substitutes a generic sample, so
 * the customer receives "your villa at Customer".
 */
import { describe, expect, it } from "vitest";
import {
  RELEVANT_FIELD_COVERAGE_PCT,
  discoverLeadColumnFields,
  discoverLeadMetaFields,
  isOfferableFieldOption,
  isRelevantFieldOption,
  LEAD_COLUMN_FIELDS,
  mergeFieldOptions,
} from "@/lib/whatsapp/lead-meta-fields.shared";

describe("isRelevantFieldOption", () => {
  it("keeps a column most leads actually have", () => {
    expect(isRelevantFieldOption({ coverage: 100 })).toBe(true);
    expect(isRelevantFieldOption({ coverage: RELEVANT_FIELD_COVERAGE_PCT })).toBe(true);
  });

  it("drops a stray key left behind by an import", () => {
    // Bliss 2 carries keys present on one or two of its 223 leads.
    expect(isRelevantFieldOption({ coverage: 0 })).toBe(false);
    expect(isRelevantFieldOption({ coverage: RELEVANT_FIELD_COVERAGE_PCT - 1 })).toBe(false);
  });
});

describe("discoverLeadColumnFields", () => {
  const leads = [
    { full_name: "Shamsuddin Sheikh", phone: "+96659300626", email: "a@b.com", company_name: "" },
    { full_name: "Mahmood Alkhaja", phone: "+971504515940", email: "c@d.com", company_name: "" },
    { full_name: "Irfan Aslam", phone: "+447966019951", email: "", company_name: "" },
  ];

  it("reports coverage per standard lead column", () => {
    const byValue = Object.fromEntries(discoverLeadColumnFields(leads).map((f) => [f.value, f]));
    expect(byValue.full_name!.coverage).toBe(100);
    expect(byValue.phone!.coverage).toBe(100);
    expect(byValue.email!.coverage).toBe(67);
    expect(byValue.company_name!.coverage).toBe(0);
  });

  it("gives an empty column zero coverage rather than omitting it", () => {
    // It stays in the list so the picker can offer it under "empty for this audience".
    const company = discoverLeadColumnFields(leads).find((f) => f.value === "company_name");
    expect(company).toBeDefined();
    expect(isRelevantFieldOption(company!)).toBe(false);
  });

  it("carries a sample so the column is recognisable", () => {
    const name = discoverLeadColumnFields(leads).find((f) => f.value === "full_name");
    expect(name!.sample).toBe("Shamsuddin Sheikh");
  });

  it("handles an empty sample without dividing by zero", () => {
    for (const f of discoverLeadColumnFields([])) expect(f.coverage).toBe(0);
  });
});

describe("the Bliss 2 shape", () => {
  /** 100 leads: three real columns, plus one stray key on a single row. */
  const leads = Array.from({ length: 100 }, (_, i) => ({
    meta:
      i === 0
        ? { upload_type: "Bliss 2", Unit: "R3 Bliss 2-V-1", Number: "(97150) 451-5940", "UNIT NUMBER": "stray" }
        : { upload_type: "Bliss 2", Unit: `R3 Bliss 2-V-${i + 1}`, Number: "(97150) 451-5940" },
  }));

  it("separates the columns that hold data from the strays", () => {
    const fields = discoverLeadMetaFields(leads.map((l) => ({ meta: l.meta, extra: null })));
    const relevant = fields.filter(isRelevantFieldOption).map((f) => f.label);
    const hidden = fields.filter((f) => !isRelevantFieldOption(f)).map((f) => f.label);

    expect(relevant.sort()).toEqual(["Number", "Unit"]);
    expect(hidden).toEqual(["UNIT NUMBER"]);
  });

  it("never treats upload_type itself as a mappable column", () => {
    const fields = discoverLeadMetaFields(leads.map((l) => ({ meta: l.meta, extra: null })));
    expect(fields.some((f) => f.label === "upload_type")).toBe(false);
  });
});

/**
 * Two uploads carrying different property columns must each offer their own.
 *
 * This is the case the picker kept getting wrong: the offered list was assembled from a hardcoded
 * schema plus every lead column, so an upload with "Unit" and an upload with "Property Name" were
 * shown the same ~30 options, most of which resolved to nothing for that audience.
 */
describe("the offered list follows the upload", () => {
  const leadsWithUnit = [
    { meta: { upload_type: "Bliss 2", Unit: "R3 Bliss 2-V-1" }, full_name: "A", phone: "9715", source: "import", notes: "Unit: R3" },
    { meta: { upload_type: "Bliss 2", Unit: "R3 Bliss 2-V-2" }, full_name: "B", phone: "9715", source: "import", notes: "Unit: R3" },
  ];
  const leadsWithProperty = [
    { meta: { upload_type: "Sun", "Property Name": "Sun Tower" }, full_name: "C", phone: "9715", source: "import", notes: "x" },
    { meta: { upload_type: "Sun", "Property Name": "Sun Villas" }, full_name: "D", phone: "9715", source: "import", notes: "x" },
  ];

  const offeredFor = (leads: Array<Record<string, unknown>>) =>
    mergeFieldOptions(
      discoverLeadColumnFields(leads),
      discoverLeadMetaFields(leads as never),
    )
      .filter(isOfferableFieldOption)
      .map((f) => f.label);

  it("offers Unit to the upload that has it, and not to the one that does not", () => {
    expect(offeredFor(leadsWithUnit)).toContain("Unit");
    expect(offeredFor(leadsWithUnit)).not.toContain("Property Name");
  });

  it("offers Property Name to the other upload, and not Unit", () => {
    expect(offeredFor(leadsWithProperty)).toContain("Property Name");
    expect(offeredFor(leadsWithProperty)).not.toContain("Unit");
  });

  it("still offers the identity columns to both, since a template needs a name", () => {
    for (const leads of [leadsWithUnit, leadsWithProperty]) {
      expect(offeredFor(leads)).toContain("Owner / Full Name");
      expect(offeredFor(leads)).toContain("Phone (primary)");
    }
  });
});

describe("bookkeeping columns", () => {
  /**
   * `source` is the literal constant "import" on every imported lead, so it is 100% covered on
   * every upload and no coverage threshold can ever remove it. Mapping a variable to it sends the
   * same word to every recipient — the "fixed text for everyone" the picker was reported for.
   */
  it("are never offered, however well covered", () => {
    for (const value of ["source", "notes", "call_summary", "next_action"]) {
      expect(isOfferableFieldOption({ value, coverage: 100 })).toBe(false);
    }
  });

  it("do not hide a real column that happens to share the rule's shape", () => {
    expect(isOfferableFieldOption({ value: "full_name", coverage: 100 })).toBe(true);
    expect(isOfferableFieldOption({ value: "meta.Unit", coverage: 100 })).toBe(true);
  });

  it("remain reachable, rather than being deleted from the schema", () => {
    // They stay in the mapping vocabulary so an existing campaign that uses one still resolves.
    expect(LEAD_COLUMN_FIELDS.map((f) => f.value)).toContain("source");
  });
});
