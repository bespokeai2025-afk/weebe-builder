import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/providers/crm/adapters/dynamics.adapter", () => ({
  fetchDynamicsAccessToken: vi.fn(async () => "test-token"),
}));

import { stripWbahProtectedContactFields } from "@/lib/wbah/post-call/wbah-crm-protected-fields.shared";
import { patchWbahLead, patchWbahOpportunity } from "@/lib/wbah/post-call/wbah-dynamics.server";

describe("stripWbahProtectedContactFields", () => {
  it("removes name, email and phone from a lead payload and keeps everything else", () => {
    const { fields, removed } = stripWbahProtectedContactFields("lead", {
      firstname: "Patrick",
      lastname: "Urology",
      emailaddress1: "p@example.com",
      mobilephone: "+447700900123",
      telephone1: "01632960000",
      new_currentstatus: 100000008,
      cos_call_summary: "Booked",
      new_othervendor_hometelephone: "01632960001",
    });
    expect(fields).toEqual({
      new_currentstatus: 100000008,
      cos_call_summary: "Booked",
      new_othervendor_hometelephone: "01632960001",
    });
    expect(removed.sort()).toEqual(["emailaddress1", "firstname", "lastname", "mobilephone", "telephone1"]);
  });

  it("removes the opportunity's own contact fields", () => {
    const { fields } = stripWbahProtectedContactFields("opportunity", {
      new_firstname: "Ben",
      new_lastname: "Ashman",
      new_mobile: "+447700900123",
      emailaddress: "b@example.com",
      cr_hsdconsultation: 121590000,
    });
    expect(fields).toEqual({ cr_hsdconsultation: 121590000 });
  });
});

describe("Dynamics PATCH never sends contact details", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function stubDynamics() {
    vi.stubEnv("DYNAMICS_TENANT_ID", "t");
    vi.stubEnv("DYNAMICS_CLIENT_ID", "c");
    vi.stubEnv("DYNAMICS_CLIENT_SECRET", "s");
    vi.stubEnv("DYNAMICS_ORG_URL", "https://org.example.com");
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("lead PATCH body has no name, email or phone", async () => {
    const fetchMock = stubDynamics();
    await patchWbahLead("lead-1", {
      firstname: "Patrick",
      emailaddress1: "p@example.com",
      mobilephone: "+447700900123",
      new_currentstatus: 100000008,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({ new_currentstatus: 100000008 });
  });

  it("does not call Dynamics when only contact details were in the payload", async () => {
    const fetchMock = stubDynamics();
    await patchWbahLead("lead-1", { firstname: "Patrick", lastname: "Olaniyi" });
    await patchWbahOpportunity("opp-1", { new_firstname: "Ben", emailaddress: "b@example.com" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
