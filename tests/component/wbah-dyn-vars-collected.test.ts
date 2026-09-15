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

describe("extractDynVars — variable names typed with their own braces", () => {
  it("resolves a variable whose NAME was saved as {{contact_same_as_property}}", () => {
    // Real case, call_e80ff81fb01e3fd278eca967c11: the Extract Variable node's
    // name field was filled in as "{{contact_same_as_property}}", so Retell
    // stored the braces as part of the key. The value was correct all along —
    // every lookup by the bare name simply missed it.
    const call = {
      call_id: "call_e80ff81fb01e3fd278eca967c11",
      retell_llm_dynamic_variables: { lead_id: "0388a435-7bac-f111-aaab-002248a45fab" },
      collected_dynamic_variables: {
        booked_date: "2026-09-17",
        "{{contact_same_as_property}}": "true",
      },
    };
    const dynVars = extractDynVars(call as never, { call });
    expect(dynVars.contact_same_as_property).toBe("true");
    // The original spelling is kept too, so nothing reading it verbatim breaks.
    expect(dynVars["{{contact_same_as_property}}"]).toBe("true");
  });

  it("tolerates padding inside the braces", () => {
    const call = { collected_dynamic_variables: { "{{ some_var }}": "x" } };
    expect(extractDynVars(call as never, { call }).some_var).toBe("x");
  });

  it("never lets a braced alias shadow a real bare variable", () => {
    const call = {
      collected_dynamic_variables: {
        contact_same_as_property: "false",
        "{{contact_same_as_property}}": "true",
      },
    };
    expect(extractDynVars(call as never, { call }).contact_same_as_property).toBe("false");
  });

  it("leaves ordinary variable names untouched", () => {
    const call = { collected_dynamic_variables: { booked_time: "9:55 AM" } };
    const out = extractDynVars(call as never, { call });
    expect(out.booked_time).toBe("9:55 AM");
    expect(Object.keys(out)).toEqual(["booked_time"]);
  });
});
