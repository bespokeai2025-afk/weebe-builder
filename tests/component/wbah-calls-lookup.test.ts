import { describe, expect, it } from "vitest";
import { selectWbahCallsByIds } from "@/lib/integrations/webespokeEnterprise/wbah-calls-lookup.server";

function fakeSb(opts: { failOnChunk?: number } = {}) {
  const chunks: string[][] = [];
  const sb = {
    from: () => ({
      select: () => ({
        in: (_col: string, ids: string[]) => {
          chunks.push(ids);
          const result =
            opts.failOnChunk === chunks.length
              ? { data: null, error: { message: "Bad Request" } }
              : { data: ids.map((id) => ({ id })), error: null };
          const q: any = Promise.resolve(result);
          q.eq = () => q;
          return q;
        },
      }),
    }),
  };
  return { sb, chunks };
}

describe("selectWbahCallsByIds", () => {
  it("splits a 1,000-call sync page into lookups of at most 200 ids", async () => {
    const ids = Array.from({ length: 1000 }, (_, i) => `call_${i}`);
    const { sb, chunks } = fakeSb();
    const rows = await selectWbahCallsByIds(sb, ids, "id", "ws");
    expect(rows).toHaveLength(1000);
    expect(chunks).toHaveLength(5);
    expect(Math.max(...chunks.map((c) => c.length))).toBe(200);
  });

  it("throws when a lookup fails, so the sync never upserts over booking fields blind", async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `call_${i}`);
    const { sb } = fakeSb({ failOnChunk: 2 });
    await expect(selectWbahCallsByIds(sb, ids, "id")).rejects.toThrow(/lookup failed/);
  });
});
