/**
 * Manual lead entry from the Leads page.
 *
 * The server side (`upsertLead`) already existed — insert, new-lead notification, auto-call
 * trigger, assigned-records scoping — so the only new logic is turning a typed form into its
 * payload, and deciding who may do it. Both are tested here because both fail silently: a blank
 * field stored as "" looks fine until something filters on null, and a phone with stray whitespace
 * stops calls and WhatsApp replies matching back to the lead.
 */
import { describe, expect, it } from "vitest";
import {
  MANUAL_LEAD_SOURCE,
  buildManualLeadPayload,
  isManualLeadSubmittable,
} from "@/lib/dashboard/manual-lead.shared";
import { pageLevelRank } from "@/lib/permissions/permissions.shared";

describe("buildManualLeadPayload", () => {
  it("keeps a fully filled form intact", () => {
    expect(
      buildManualLeadPayload({
        full_name: "Jane Smith",
        phone: "+44 7700 900000",
        email: "jane@example.com",
        company_name: "Acme Ltd",
        notes: "Asked about pricing",
      }),
    ).toEqual({
      full_name: "Jane Smith",
      phone: "+44 7700 900000",
      email: "jane@example.com",
      company_name: "Acme Ltd",
      notes: "Asked about pricing",
      source: MANUAL_LEAD_SOURCE,
    });
  });

  it("turns every blank optional field into null, not an empty string", () => {
    const p = buildManualLeadPayload({ phone: "+447700900000" });
    expect(p.full_name).toBeNull();
    expect(p.email).toBeNull();
    expect(p.company_name).toBeNull();
    expect(p.notes).toBeNull();
  });

  it("treats whitespace-only input as blank", () => {
    const p = buildManualLeadPayload({ phone: "+447700900000", full_name: "   ", notes: "\t\n " });
    expect(p.full_name).toBeNull();
    expect(p.notes).toBeNull();
  });

  it("trims the phone, which is the matching key for calls and replies", () => {
    expect(buildManualLeadPayload({ phone: "  +447700900000  " }).phone).toBe("+447700900000");
  });

  it("always records the manual source", () => {
    expect(buildManualLeadPayload({ phone: "123" }).source).toBe("Manual entry");
  });
});

describe("isManualLeadSubmittable", () => {
  it("requires a phone of at least 3 characters, matching the server validator", () => {
    expect(isManualLeadSubmittable({ phone: "123" })).toBe(true);
    expect(isManualLeadSubmittable({ phone: "12" })).toBe(false);
    expect(isManualLeadSubmittable({ phone: "  " })).toBe(false);
    expect(isManualLeadSubmittable({})).toBe(false);
  });

  it("does not require any other field", () => {
    expect(isManualLeadSubmittable({ phone: "+447700900000" })).toBe(true);
  });
});

describe("who may add a lead", () => {
  // There is no dedicated action key for creating a lead, so the button is
  // gated on the Leads page level being at least `edit`.
  const canCreate = (level: string) => pageLevelRank(level) >= pageLevelRank("edit");

  it("allows edit and every level above it", () => {
    for (const level of ["edit", "create_draft", "approve", "activate", "manage"]) {
      expect(canCreate(level)).toBe(true);
    }
  });

  it("denies view-only and hidden", () => {
    expect(canCreate("view")).toBe(false);
    expect(canCreate("hidden")).toBe(false);
  });

  it("denies an unknown level rather than failing open", () => {
    expect(canCreate("")).toBe(false);
    expect(canCreate("nonsense")).toBe(false);
  });
});
