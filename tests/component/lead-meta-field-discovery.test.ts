/**
 * Offering the columns a workspace actually imported, instead of a fixed list.
 *
 * Avenue Elite holds two spellings of the same concept from two different files — "UNIT NUMBER"
 * (the Arabian Ranches import) and "UnitNumber" (the JVC one). The picker offered only the second,
 * so an Arabian Ranches campaign mapped a column that did not exist for those leads and every
 * message shipped filler text.
 */
import { describe, expect, it } from "vitest";
import {
  INTERNAL_LEAD_META_KEYS,
  discoverLeadMetaFields,
} from "@/lib/whatsapp/lead-meta-fields.shared";

/** Shaped like the real rows, including both spellings. */
const LEADS = [
  { meta: { PHONE: "+971500000001", "UNIT NUMBER": "ELIE SAAB II", upload_type: "Elie Saab AR3" } },
  { meta: { PHONE: "+971500000002", "UNIT NUMBER": "ELIE SAAB I", upload_type: "Elie Saab AR3" } },
  { meta: { PHONE: "+971500000003", UnitNumber: "140", Building: "LAYA Mansion" } },
  { meta: { PHONE: "+971500000004", UnitNumber: "", Building: "   " } },
];

describe("discoverLeadMetaFields", () => {
  it("offers the column as it was actually imported", () => {
    const labels = discoverLeadMetaFields(LEADS).map((f) => f.label);
    expect(labels).toContain("UNIT NUMBER");
    expect(labels).toContain("UnitNumber");
  });

  it("stores a mapping value the send path understands", () => {
    const unit = discoverLeadMetaFields(LEADS).find((f) => f.label === "UNIT NUMBER");
    expect(unit?.value).toBe("meta.UNIT NUMBER");
  });

  it("ranks by how many leads actually have a value", () => {
    const fields = discoverLeadMetaFields(LEADS);
    // PHONE is on all 4; UNIT NUMBER on 2; UnitNumber and Building on 1 each
    // (the blank/whitespace row does not count).
    expect(fields[0].label).toBe("PHONE");
    expect(fields[0].filled).toBe(4);
    expect(fields.find((f) => f.label === "UNIT NUMBER")?.filled).toBe(2);
    expect(fields.find((f) => f.label === "UnitNumber")?.filled).toBe(1);
  });

  it("reports coverage so a mostly-empty column is obvious before it is chosen", () => {
    const fields = discoverLeadMetaFields(LEADS);
    expect(fields.find((f) => f.label === "PHONE")?.coverage).toBe(100);
    expect(fields.find((f) => f.label === "UNIT NUMBER")?.coverage).toBe(50);
  });

  it("never offers a column that is blank everywhere", () => {
    const labels = discoverLeadMetaFields([
      { meta: { Nothing: "", AlsoNothing: "   ", Real: "x" } },
    ]).map((f) => f.label);
    expect(labels).toEqual(["Real"]);
  });

  it("hides our own bookkeeping keys", () => {
    const labels = discoverLeadMetaFields(LEADS).map((f) => f.label);
    for (const internal of INTERNAL_LEAD_META_KEYS) expect(labels).not.toContain(internal);
    expect(labels).not.toContain("upload_type");
  });

  it("includes columns an older import stashed in notes", () => {
    const fields = discoverLeadMetaFields([
      { meta: { PHONE: "+1" }, extra: { "Master Project": "Arabian Ranches 3" } },
    ]);
    expect(fields.map((f) => f.label)).toContain("Master Project");
  });

  it("does not let a notes column shadow the real meta value", () => {
    const fields = discoverLeadMetaFields([
      { meta: { Building: "From meta" }, extra: { Building: "From notes" } },
    ]);
    expect(fields.find((f) => f.label === "Building")?.sample).toBe("From meta");
  });

  it("shows an example value so the column is recognisable", () => {
    const unit = discoverLeadMetaFields(LEADS).find((f) => f.label === "UNIT NUMBER");
    expect(unit?.sample).toBe("ELIE SAAB II");
  });

  it("returns nothing for an empty workspace rather than throwing", () => {
    expect(discoverLeadMetaFields([])).toEqual([]);
  });
});
