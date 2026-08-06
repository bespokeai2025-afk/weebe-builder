import { describe, expect, it } from "vitest";
import {
  NEW_LEAD_STATUS,
  NEW_LEAD_SYNC_SUB_SLUGS,
  hasNewLeadSyncEnabled,
  isNewLeadStatus,
  isNewLeadSyncSubSlug,
  newLeadSubBadgeLabel,
  parseWbahNewLeadSyncToggle,
  resolveWbahCrmPersonName,
} from "@/lib/integrations/webespokeEnterprise/wbah-campaign-sync.types";

describe("New lead category helpers", () => {
  it("recognises New lead status", () => {
    expect(isNewLeadStatus("New")).toBe(true);
    expect(isNewLeadStatus("new")).toBe(true);
    expect(isNewLeadStatus("Test Lead")).toBe(false);
  });

  it("maps sub slugs and badge labels", () => {
    expect(isNewLeadSyncSubSlug(NEW_LEAD_SYNC_SUB_SLUGS.call_now)).toBe(true);
    expect(isNewLeadSyncSubSlug(NEW_LEAD_SYNC_SUB_SLUGS.delayed)).toBe(true);
    expect(newLeadSubBadgeLabel(NEW_LEAD_SYNC_SUB_SLUGS.call_now)).toBe("Call now");
    expect(newLeadSubBadgeLabel(NEW_LEAD_SYNC_SUB_SLUGS.delayed)).toBe("Delayed");
    expect(newLeadSubBadgeLabel("disqualified")).toBeNull();
  });

  it("detects New in lead-status options", () => {
    expect(
      hasNewLeadSyncEnabled([
        { value: "Disqualified", label: "Disqualified" },
        { value: NEW_LEAD_STATUS, label: NEW_LEAD_STATUS },
      ]),
    ).toBe(true);
    expect(hasNewLeadSyncEnabled([{ value: "Disqualified", label: "Disqualified" }])).toBe(false);
  });
});

describe("wbahPeopleCrmQueryPath", () => {
  it("uses leadStatus=New on get-crm-data for the New People tab", async () => {
    const { wbahPeopleCrmQueryPath } = await import(
      "@/lib/integrations/webespokeEnterprise/wbah-people-crm.server"
    );
    expect(wbahPeopleCrmQueryPath("New", 1, 50)).toBe(
      "/crm-data/get-crm-data?currentPage=1&pageSize=50&leadStatus=New",
    );
    expect(wbahPeopleCrmQueryPath("disqualified", 2, 25)).toBe(
      "/crm-data/get-crm-data?currentPage=2&pageSize=25&sync_category_slug=disqualified",
    );
    expect(wbahPeopleCrmQueryPath("New", 1, 50, "smith")).toBe(
      "/crm-data/get-crm-data?currentPage=1&pageSize=50&leadStatus=New&search=smith",
    );
  });
});

describe("normalizeWbahPeopleCategorySlug", () => {
  it("normalises New category aliases", async () => {
    const { normalizeWbahPeopleCategorySlug } = await import(
      "@/lib/integrations/webespokeEnterprise/wbah-people-crm.server"
    );
    expect(normalizeWbahPeopleCategorySlug("New")).toBe("new");
    expect(normalizeWbahPeopleCategorySlug("new_lead")).toBe("new");
    expect(normalizeWbahPeopleCategorySlug("Test Lead")).toBe("test_lead");
  });
});

describe("resolveWbahCrmPersonName", () => {
  it("ignores sub-cohort labels in name field", () => {
    expect(
      resolveWbahCrmPersonName({
        name: "Call now",
        first_name: "Jane",
        last_name: "Smith",
      }),
    ).toBe("Jane Smith");
  });
});

describe("parseWbahNewLeadSyncToggle", () => {
  it("parses API envelope", () => {
    expect(
      parseWbahNewLeadSyncToggle({
        data: { enabled: true, source: "redis", envDefault: false },
      }),
    ).toEqual({ enabled: true, source: "redis", envDefault: false });
  });
});
