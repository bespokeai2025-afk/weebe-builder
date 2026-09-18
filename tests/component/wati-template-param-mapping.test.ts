/**
 * Regression: an Arabian Ranches campaign sent "your villa at Customer".
 *
 * Three defects compounded. The template field picker offers one fixed spelling per property field
 * ("meta.UnitNumber"), but the customer's spreadsheet column imported as "UNIT NUMBER" — and the
 * lookup matched on case only, so a single space made the mapping resolve to nothing. An
 * unresolved parameter then falls back to defaultParamSample (WATI rejects blank variables), and
 * that function tested `includes("name")` before any property token, so every *_name variable
 * sampled as "Customer". Three real messages went out reading "your villa at Customer".
 */
import { describe, expect, it } from "vitest";
import {
  buildWatiTemplateParams,
  resolveWatiTemplateParamsDetailed,
} from "@/lib/whatsapp/wati-campaign.server";
import { defaultParamSample } from "@/lib/whatsapp/wati-template-create.shared";

/** The lead from the failed test campaign, verbatim. */
const LEAD = {
  full_name: "SUNDIP PAREKH",
  phone: "0566991800",
  meta: {
    PHONE: "+0566991800",
    "UNIT NUMBER": "ELIE SAAB II",
    upload_type: "Elie Saab AR3",
  },
};

const SLOTS = ["name", "property_name"];

describe("buildWatiTemplateParams — meta key spellings", () => {
  it("resolves the picker's meta.UnitNumber against a 'UNIT NUMBER' column", () => {
    expect(
      buildWatiTemplateParams(LEAD, { name: "full_name", property_name: "meta.UnitNumber" }, SLOTS),
    ).toEqual([
      { name: "name", value: "SUNDIP" },
      { name: "property_name", value: "ELIE SAAB II" },
    ]);
  });

  it("matches the same column however the import spelled it", () => {
    for (const key of [
      "meta.unit number",
      "meta.Unit_Number",
      "meta.UNITNUMBER",
      "meta.unit-number",
      "meta.UnitNumber",
    ]) {
      expect(buildWatiTemplateParams(LEAD, { property_name: key }, ["property_name"])).toEqual([
        { name: "property_name", value: "ELIE SAAB II" },
      ]);
    }
  });

  it("never sends the customer's name in a property variable", () => {
    const [, property] = buildWatiTemplateParams(
      LEAD,
      { name: "full_name", property_name: "meta.UnitNumber" },
      SLOTS,
    );
    expect(property.value).not.toBe("SUNDIP");
    expect(property.value).not.toBe("SUNDIP PAREKH");
    expect(property.value).not.toBe("Customer");
  });

  it("matches on normalised equality, not substring — Size must not claim UNIT NUMBER", () => {
    const [p] = buildWatiTemplateParams(LEAD, { property_name: "meta.Size" }, ["property_name"]);
    expect(p.value).not.toBe("ELIE SAAB II");
  });

  it("still shortens a long owner name to the first word", () => {
    const [n] = buildWatiTemplateParams(LEAD, { name: "full_name" }, ["name"]);
    expect(n.value).toBe("SUNDIP");
  });

  it("keeps parameters in template slot order", () => {
    const params = buildWatiTemplateParams(
      LEAD,
      { property_name: "meta.UnitNumber", name: "full_name" },
      SLOTS,
    );
    expect(params.map((p) => p.name)).toEqual(["name", "property_name"]);
  });
});

describe("defaultParamSample", () => {
  it("no longer calls a property variable 'Customer'", () => {
    // This exact string shipped to three customers.
    expect(defaultParamSample("property_name")).not.toBe("Customer");
    expect(defaultParamSample("building_name")).not.toBe("Customer");
    expect(defaultParamSample("project_name")).not.toBe("Customer");
  });

  it("still uses Customer for an actual person variable", () => {
    expect(defaultParamSample("name")).toBe("Customer");
    expect(defaultParamSample("owner_name")).toBe("Customer");
  });

  it("keeps the phone sample dialable", () => {
    expect(defaultParamSample("phone")).toBe("447000000000");
    expect(defaultParamSample("mobile_number")).toBe("447000000000");
  });

  it("never returns an empty string, which WATI rejects", () => {
    for (const p of ["name", "property_name", "unit", "whatever", "", "x"]) {
      expect(defaultParamSample(p).length).toBeGreaterThan(0);
    }
  });
});

/**
 * The signal the campaign preview relies on.
 *
 * A variable that resolves for nobody still sends: WATI rejects blank variables, so a generic
 * sample is substituted. `resolved` is the only way to know a message will contain filler, and the
 * preview turns it into a warning before anyone presses send.
 */
describe("resolveWatiTemplateParamsDetailed", () => {
  it("marks a slot resolved when the lead really has the value", () => {
    const [p] = resolveWatiTemplateParamsDetailed(LEAD, { property_name: "meta.UnitNumber" }, [
      "property_name",
    ]);
    expect(p).toMatchObject({
      name: "property_name",
      value: "ELIE SAAB II",
      fieldKey: "meta.UnitNumber",
      resolved: true,
    });
  });

  it("marks a slot unresolved when the mapped column is absent, and still supplies a value", () => {
    // This is the Caya campaign's mapping: Building does not exist on these leads.
    const [p] = resolveWatiTemplateParamsDetailed(LEAD, { property_name: "meta.Building" }, [
      "property_name",
    ]);
    expect(p.resolved).toBe(false);
    expect(p.value.length).toBeGreaterThan(0);
    expect(p.value).not.toBe("Customer");
  });

  it("reports the mapping used, so a warning can name it", () => {
    const [p] = resolveWatiTemplateParamsDetailed(LEAD, { property_name: "meta.Building" }, [
      "property_name",
    ]);
    expect(p.fieldKey).toBe("meta.Building");
  });

  it("treats fixed text as resolved", () => {
    const [p] = resolveWatiTemplateParamsDetailed(LEAD, { agent: "literal:Khisha" }, ["agent"]);
    expect(p).toMatchObject({ value: "Khisha", resolved: true });
  });

  it("treats empty fixed text as unresolved rather than sending a blank", () => {
    const [p] = resolveWatiTemplateParamsDetailed(LEAD, { agent: "literal:" }, ["agent"]);
    expect(p.resolved).toBe(false);
    expect(p.value.length).toBeGreaterThan(0);
  });

  it("agrees with buildWatiTemplateParams, which the send path uses", () => {
    const mapping = { name: "full_name", property_name: "meta.UnitNumber" };
    expect(
      resolveWatiTemplateParamsDetailed(LEAD, mapping, SLOTS).map(({ name, value }) => ({
        name,
        value,
      })),
    ).toEqual(buildWatiTemplateParams(LEAD, mapping, SLOTS));
  });
});
