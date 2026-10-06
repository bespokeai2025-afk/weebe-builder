import { describe, expect, it, vi } from "vitest";
import { writeWithSchemaFallback } from "@/lib/retell/retell-webhook.processor";

/**
 * A call row gains columns ahead of the migrations that create them. Without this fallback a
 * single unapplied migration makes every call write fail, and calls silently stop being
 * recorded — much worse than losing one optional field.
 */
describe("writeWithSchemaFallback", () => {
  const schemaError = (col: string) => ({
    error: { message: `Could not find the '${col}' column of 'calls' in the schema cache` },
  });
  const ok = { error: null };

  it("writes the row unchanged when every column exists", async () => {
    const write = vi.fn().mockResolvedValue(ok);
    const row = { retell_call_id: "c1", cost_cents: 3, cost_cents_precise: 2.531 };

    const res = await writeWithSchemaFallback(row, write);

    expect(res.error).toBeNull();
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][0]).toEqual(row);
  });

  it("drops the one missing column and keeps the rest of the call", async () => {
    const write = vi
      .fn()
      .mockResolvedValueOnce(schemaError("cost_cents_precise"))
      .mockResolvedValueOnce(ok);

    const res = await writeWithSchemaFallback(
      { retell_call_id: "c1", cost_cents: 3, cost_cents_precise: 2.531 },
      write,
    );

    expect(res.error).toBeNull();
    // The call is still recorded, just without the extra precision.
    expect(write.mock.calls[1][0]).toEqual({ retell_call_id: "c1", cost_cents: 3 });
    expect(write.mock.calls[1][0]).not.toHaveProperty("cost_cents_precise");
  });

  it("drops several missing columns across successive attempts", async () => {
    // Both the LLM-provider and the precision migrations unapplied.
    const write = vi
      .fn()
      .mockResolvedValueOnce(schemaError("cost_cents_precise"))
      .mockResolvedValueOnce(schemaError("llm_provider"))
      .mockResolvedValueOnce(ok);

    const res = await writeWithSchemaFallback(
      { retell_call_id: "c1", cost_cents: 3, cost_cents_precise: 2.5, llm_provider: "cerebras" },
      write,
    );

    expect(res.error).toBeNull();
    expect(write.mock.calls[2][0]).toEqual({ retell_call_id: "c1", cost_cents: 3 });
  });

  it("surfaces a real failure instead of retrying forever", async () => {
    // Not a schema error — must come straight back so the caller can mark the webhook failed.
    const write = vi.fn().mockResolvedValue({ error: { message: "permission denied for table calls" } });

    const res = await writeWithSchemaFallback({ retell_call_id: "c1" }, write);

    expect(res.error?.message).toContain("permission denied");
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("gives up rather than looping when the named column is not in the row", async () => {
    // A column we never sent cannot be dropped; retrying would spin.
    const write = vi.fn().mockResolvedValue(schemaError("some_other_column"));

    const res = await writeWithSchemaFallback({ retell_call_id: "c1" }, write);

    expect(res.error).toBeTruthy();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("matches the other wording PostgREST uses for a missing column", async () => {
    const write = vi
      .fn()
      .mockResolvedValueOnce({ error: { message: 'column "cost_cents_precise" of relation "calls" does not exist' } })
      .mockResolvedValueOnce(ok);

    const res = await writeWithSchemaFallback({ retell_call_id: "c1", cost_cents_precise: 1 }, write);

    expect(res.error).toBeNull();
    expect(write.mock.calls[1][0]).toEqual({ retell_call_id: "c1" });
  });
});
