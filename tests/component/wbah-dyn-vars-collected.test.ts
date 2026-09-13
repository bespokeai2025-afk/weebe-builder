import { describe, expect, it } from "vitest";
import { extractDynVars } from "@/lib/wbah/post-call/wbah-post-call.server";

describe("extractDynVars — collected_dynamic_variables merge", () => {
  it("merges collected_dynamic_variables (live Extract Variable node output) into dynVars", () => {
    // Real production payload shape from call_76470fd94b070b18ef911a3212b:
    // the Extract Variable node visibly fired mid-call (dashboard showed the
    // tool call + "true" response), but contact_same_as_property landed
    // under call.collected_dynamic_variables, not retell_llm_dynamic_variables
    // — the only field extractDynVars previously read.
    const call = {
      call_id: "call_76470fd94b070b18ef911a3212b",
      retell_llm_dynamic_variables: {
        lead_id: "efe54e03-6eaf-f111-aaab-7ced8d45e49a",
        contact_address: "",
        property_address: "10 Example Road",
      },
      collected_dynamic_variables: {
        current_node: "Conversation",
        booked_date: "2026-09-14",
        contact_same_as_property: "true",
      },
    };
    const dynVars = extractDynVars(call as any, { call });
    expect(dynVars.lead_id).toBe("efe54e03-6eaf-f111-aaab-7ced8d45e49a");
    expect(dynVars.contact_same_as_property).toBe("true");
    expect(dynVars.booked_date).toBe("2026-09-14");
  });

  it("still works when collected_dynamic_variables is absent (older/simpler payloads)", () => {
    const call = {
      call_id: "call_x",
      retell_llm_dynamic_variables: { lead_id: "lead-1" },
    };
    const dynVars = extractDynVars(call as any, { call });
    expect(dynVars.lead_id).toBe("lead-1");
    expect(dynVars.contact_same_as_property).toBeUndefined();
  });

  it("prefers collected_dynamic_variables over retell_llm_dynamic_variables on key overlap (latest in-call state wins)", () => {
    const call = {
      call_id: "call_y",
      retell_llm_dynamic_variables: { contact_same_as_property: "false" },
      collected_dynamic_variables: { contact_same_as_property: "true" },
    };
    const dynVars = extractDynVars(call as any, { call });
    expect(dynVars.contact_same_as_property).toBe("true");
  });
});
