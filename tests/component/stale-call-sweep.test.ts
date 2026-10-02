import { describe, expect, it } from "vitest";
import { sweepStaleNativeCalls } from "@/lib/voice/lifecycle/stale-call-sweep.server";

/** Minimal fake matching only the chain sweepStaleNativeCalls actually calls. */
function fakeSupabase(selectRows: Array<{ id: string }>, opts: { updateError?: string } = {}) {
  const updateCalls: Array<{ payload: unknown; ids: string[] }> = [];

  const selectChain = {
    eq: () => selectChain,
    is: () => selectChain,
    lt: () => Promise.resolve({ data: selectRows, error: null }),
  };

  const updateChain = (payload: unknown) => ({
    in: (_col: string, ids: string[]) => ({
      eq: () => {
        updateCalls.push({ payload, ids });
        return Promise.resolve({
          data: null,
          error: opts.updateError ? { message: opts.updateError } : null,
        });
      },
    }),
  });

  const sb = {
    from: () => ({
      select: () => selectChain,
      update: (payload: unknown) => updateChain(payload),
    }),
  };
  return { sb: sb as any, updateCalls };
}

describe("sweepStaleNativeCalls", () => {
  it("closes native calls stuck in_progress past the stale threshold", async () => {
    const { sb, updateCalls } = fakeSupabase([{ id: "call-1" }, { id: "call-2" }]);
    const result = await sweepStaleNativeCalls(sb);

    expect(result).toEqual({ checked: 2, closed: 2, callIds: ["call-1", "call-2"] });
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].ids).toEqual(["call-1", "call-2"]);
    expect(updateCalls[0].payload).toMatchObject({
      call_status: "failed",
      disconnection_reason: "lost_connection_unrecovered",
    });
  });

  it("does nothing when no call is stale", async () => {
    const { sb, updateCalls } = fakeSupabase([]);
    const result = await sweepStaleNativeCalls(sb);

    expect(result).toEqual({ checked: 0, closed: 0, callIds: [] });
    expect(updateCalls).toHaveLength(0);
  });

  it("throws rather than silently losing an update failure", async () => {
    const { sb } = fakeSupabase([{ id: "call-1" }], { updateError: "db unavailable" });
    await expect(sweepStaleNativeCalls(sb)).rejects.toThrow(/db unavailable/);
  });
});
