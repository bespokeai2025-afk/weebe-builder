import { describe, it, expect, vi, afterEach } from "vitest";
import { listRetellCalls } from "@/lib/providers/retell/list.server";

// Regression for the provider-reconciliation undercount: listPaged used to
// dedupe records by `agent_id ?? call_id`, and CALL records also carry an
// agent_id — so every call after the first per agent was silently dropped
// (a 407-call day collapsed to 2 rows, one per agent).
describe("listRetellCalls pagination dedup", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps every call even when many calls share one agent_id", async () => {
    const page = (items: unknown[], hasMore: boolean, pk?: string) =>
      new Response(JSON.stringify({ items, has_more: hasMore, pagination_key: pk }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    const p1 = Array.from({ length: 3 }, (_, i) => ({
      call_id: `call_a${i}`,
      agent_id: "agent_shared",
      duration_ms: 1000,
    }));
    const p2 = Array.from({ length: 2 }, (_, i) => ({
      call_id: `call_b${i}`,
      agent_id: "agent_shared",
      duration_ms: 1000,
    }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(page(p1, true, "pk1"))
      .mockResolvedValueOnce(page(p2, false));
    vi.stubGlobal("fetch", fetchMock);

    const out = await listRetellCalls({ limit: 1000 }, "key_test");
    expect(out).toHaveLength(5);
    expect(new Set(out.map((c: any) => c.call_id)).size).toBe(5);
  });

  it("still drops true duplicate call_ids across pages", async () => {
    const page = (items: unknown[], hasMore: boolean, pk?: string) =>
      new Response(JSON.stringify({ items, has_more: hasMore, pagination_key: pk }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(page([{ call_id: "call_x", agent_id: "a1" }], true, "pk1"))
      .mockResolvedValueOnce(page([{ call_id: "call_x", agent_id: "a1" }], false));
    vi.stubGlobal("fetch", fetchMock);

    const out = await listRetellCalls({ limit: 1000 }, "key_test");
    expect(out).toHaveLength(1);
  });
});
