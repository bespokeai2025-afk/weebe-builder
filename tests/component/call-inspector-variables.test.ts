import { describe, expect, it } from "vitest";
import { NativeCallLifecycle } from "@/lib/voice/lifecycle/call-lifecycle";

function makeLifecycle() {
  const emitted: Array<{ event: string; call: Record<string, unknown> }> = [];
  const lifecycle = new NativeCallLifecycle(
    {
      callId: "call_test_1",
      agentId: "agent-1",
      agentName: "Test agent",
      workspaceId: "ws-1",
      callType: "web_call",
      direction: "outbound",
      dynamicVariables: { lead_id: "lead-1", property_address: "10 Example Road" },
    },
    {
      emit: async (payload: { event: string; call: Record<string, unknown> }) => {
        emitted.push(payload);
      },
    } as never,
  );
  return { lifecycle, emitted };
}

describe("NativeCallLifecycle — collected variables vs setup variables", () => {
  it("reports in-call captures under collected_dynamic_variables, matching Retell's shape", () => {
    const { lifecycle } = makeLifecycle();
    lifecycle.mergeDynamicVariables({ contact_same_as_property: "true" });

    const call = (lifecycle as never as { buildCall: (o: object) => Record<string, unknown> })
      .buildCall({});

    // Setup variables stay where they were.
    expect(call.retell_llm_dynamic_variables).toMatchObject({ lead_id: "lead-1" });
    // In-call captures are reported separately, not folded indistinguishably in.
    expect(call.collected_dynamic_variables).toEqual({ contact_same_as_property: "true" });
    // ...and are still present in the merged setup bag for consumers reading only that.
    expect(call.retell_llm_dynamic_variables).toMatchObject({
      contact_same_as_property: "true",
    });
  });

  it("omits collected_dynamic_variables entirely when nothing was captured", () => {
    const { lifecycle } = makeLifecycle();
    const call = (lifecycle as never as { buildCall: (o: object) => Record<string, unknown> })
      .buildCall({});
    expect(call.collected_dynamic_variables).toBeUndefined();
  });
});

describe("NativeCallLifecycle — tool call history", () => {
  it("records tool calls in Retell's reporting shape with a call-relative offset", () => {
    const { lifecycle } = makeLifecycle();
    lifecycle.recordToolCall({ name: "get_available_slots", type: "custom", success: true });
    lifecycle.recordToolCall({ name: "book_appointment", type: "custom", success: false });

    const call = (lifecycle as never as { buildCall: (o: object) => Record<string, unknown> })
      .buildCall({});
    const tools = call.tool_calls as Array<Record<string, unknown>>;

    expect(tools).toHaveLength(2);
    expect(tools[0]).toMatchObject({ name: "get_available_slots", success: true });
    expect(tools[1]).toMatchObject({ name: "book_appointment", success: false });
    // Offset is filled in automatically so the UI can order/locate calls.
    expect(typeof tools[0]!.start_time_sec).toBe("number");
  });

  it("omits tool_calls entirely when no tool ran", () => {
    const { lifecycle } = makeLifecycle();
    const call = (lifecycle as never as { buildCall: (o: object) => Record<string, unknown> })
      .buildCall({});
    expect(call.tool_calls).toBeUndefined();
  });
});
