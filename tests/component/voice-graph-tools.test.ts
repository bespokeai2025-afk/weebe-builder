import { describe, expect, it, vi } from "vitest";
import { createVmHooks } from "@/lib/voice/graph/tools";
import type { ToolInvocation } from "@/lib/voice/graph/types";

function invocation(partial: Partial<ToolInvocation> = {}): ToolInvocation {
  return {
    toolId: "get_available_slots",
    toolName: "get_available_slots",
    toolType: "custom",
    args: { date: "2026-08-30" },
    variables: {},
    ...partial,
  };
}

describe("custom function dispatch", () => {
  it("posts a custom webhook instead of Cal.com when the tool has a URL", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ slots: ["10:00"] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const hooks = createVmHooks({
      tools: [
        {
          name: "get_available_slots",
          tool_id: "get_available_slots",
          type: "custom",
          url: "https://example.com/slots",
          cal_api_key: "cal_should_not_be_used",
          event_type_id: 99,
        },
      ],
    });

    const out = await hooks.executeTool!(invocation());
    expect(out.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/slots",
      expect.objectContaining({ method: "POST" }),
    );
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toMatch(/cal.com/i);
    vi.unstubAllGlobals();
  });

  it("does not treat a custom available-slots name as Cal.com", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const hooks = createVmHooks({
      tools: [
        {
          name: "get_available_slots",
          tool_id: "get_available_slots",
          type: "custom",
          cal_api_key: "cal_xxx",
          event_type_id: 12,
        },
      ],
    });
    const out = await hooks.executeTool!(invocation());
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.every((u) => !/cal\.com/i.test(u))).toBe(true);
    expect(out.output).not.toMatch(/Available times:/);
    vi.unstubAllGlobals();
  });
});
