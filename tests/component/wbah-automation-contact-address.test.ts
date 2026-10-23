import { beforeEach, describe, expect, it, vi } from "vitest";

const patched: Array<Record<string, unknown>> = [];

vi.mock("@/lib/wbah/post-call/wbah-dynamics.server", () => ({
  isWbahDynamicsConfigured: () => true,
  getWbahLeadCurrentStatus: vi.fn(async () => ({
    new_currentstatus: 100000000,
    statecode: 0,
    raw: {},
  })),
  patchWbahLead: vi.fn(async (_id: string, patch: Record<string, unknown>) => {
    patched.push(patch);
  }),
  postWbahLeadTimelineNote: vi.fn(async () => undefined),
}));

import { parseWbahRunBag, type WbahRunBag } from "@/lib/automation-engine/plugins/wbah/wbah-run-context";
import {
  wbahStepDynamicsAgentic,
  wbahStepDynamicsAllens,
  wbahStepFormatData,
} from "@/lib/automation-engine/plugins/wbah/wbah-step-handlers.server";

/**
 * Shape of call_d8f383c8a82f1803a3a719be5f9 (23 Oct): the caller said "Yes" to
 * "are your contact address details the same as your property address?", the
 * Extract Variable node stored contact_same_as_property in
 * collected_dynamic_variables, and the dictated postcode was garbled.
 */
function bookedCallSameAddress(): WbahRunBag {
  const call = {
    call_id: "call_same_address",
    agent_id: "agent_0440750bb59597eef7352901bf",
    call_type: "phone_call",
    transcript:
      "Agent: Could I just confirm, are your contact address details the same as your property address?\nUser: Yes.",
    retell_llm_dynamic_variables: { lead_id: "lead-1", contact_address: "", property_address: "" },
    collected_dynamic_variables: {
      booked_date: "2026-10-23",
      booked_time: "1:20 PM",
      contact_same_as_property: "true",
    },
    call_analysis: {
      user_sentiment: "Positive",
      call_summary: "Consultation booked for 23 Oct 1:20 PM.",
      custom_analysis_data: {
        calendly_slot: JSON.stringify({ preferred_slot: { date: "2026-10-23", time: "13:20" } }),
        structured_json_output: JSON.stringify({
          verified_details: {
            new_propinfo_street2: "40 Example Place",
            new_propinfo_city: "Linton",
            new_propinfo_postalcode: "N8238SD",
            address1_postalcode: "N8238SD",
          },
        }),
      },
    },
  };
  const bag = parseWbahRunBag({ event: "call_analyzed", call }) as WbahRunBag;
  return bag;
}

describe("automation engine — contact address same as property", () => {
  beforeEach(() => {
    patched.length = 0;
  });

  it("reads contact_same_as_property from collected_dynamic_variables", () => {
    expect(bookedCallSameAddress().dynVars.contact_same_as_property).toBe("true");
  });

  for (const [name, run] of [
    ["Allen's step", (bag: WbahRunBag) => wbahStepDynamicsAllens(bag, wbahStepFormatData(bag), null)],
    ["agentic step", (bag: WbahRunBag) => wbahStepDynamicsAgentic(bag, wbahStepFormatData(bag))],
  ] as const) {
    it(`${name}: sets the flag to Yes and copies the property address into the contact address`, async () => {
      await run(bookedCallSameAddress());
      const all = Object.assign({}, ...patched);
      expect(all.new_propinfo_sameascontactaddress).toBe(true);
      expect(all.address1_line1).toBe("40 Example Place");
      expect(all.address1_city).toBe("Linton");
    });

    it(`${name}: never copies a garbled postcode into the contact postcode`, async () => {
      await run(bookedCallSameAddress());
      for (const p of patched) {
        expect(p.address1_postalcode ?? null).toBeNull();
      }
    });
  }
});
