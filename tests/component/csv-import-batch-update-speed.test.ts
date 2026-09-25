/**
 * Re-selecting an existing Buzzchat audience for a campaign is the common case — most of the
 * contacts already have a matching lead — and updating them used to be one HTTP round trip per
 * lead (a concurrency-24 pool of individual `.update()` calls). That's what made loading a few
 * hundred contacts for a campaign visibly slow. These pin the replacement: one bulk `.upsert()`
 * call per chunk of up to 200 rows, and — because a bulk write can't selectively omit a column
 * per row — that every field not present on the incoming CSV row still keeps the lead's existing
 * value instead of being wiped to null.
 */
import { describe, expect, it } from "vitest";
import { batchImportCsvLeads } from "@/lib/whatsapp/csv-import-batch.server";
import type { CsvLeadRow } from "@/lib/whatsapp/csv-leads.shared";

/** Minimal fake of the chainable Supabase query builder this module actually calls. */
function fakeSupabase(existingLeads: Array<Record<string, unknown>>) {
  const calls: { table: string; method: string; args: unknown[] }[] = [];
  const upsertBatches: Array<Record<string, unknown>[]> = [];
  const insertBatches: Array<Record<string, unknown>[]> = [];

  function leadsBuilder() {
    let mode: "select" | "insert" | "upsert" = "select";
    let insertedRows: Record<string, unknown>[] = [];
    const builder: any = {
      select: (...args: unknown[]) => {
        calls.push({ table: "leads", method: "select", args });
        mode = mode === "insert" ? "insert" : "select";
        return builder;
      },
      eq: () => builder,
      in: (_col: string, phones: string[]) => {
        // fetchLeadsByPhones resolution
        const matched = existingLeads.filter((l) => phones.includes(String(l.phone)));
        return Promise.resolve({ data: matched, error: null });
      },
      or: () => Promise.resolve({ data: [], error: null }),
      insert: (rows: Record<string, unknown>[]) => {
        mode = "insert";
        insertedRows = rows;
        insertBatches.push(rows);
        calls.push({ table: "leads", method: "insert", args: [rows] });
        return builder;
      },
      upsert: (rows: Record<string, unknown>[]) => {
        mode = "upsert";
        upsertBatches.push(rows);
        calls.push({ table: "leads", method: "upsert", args: [rows] });
        return Promise.resolve({ data: rows, error: null });
      },
      then: (resolve: (v: { data: unknown; error: null }) => void) => {
        if (mode === "insert") {
          const data = insertedRows.map((r, i) => ({
            id: `new-${i}-${r.phone}`,
            phone: r.phone,
          }));
          return resolve({ data, error: null });
        }
        return resolve({ data: [], error: null });
      },
    };
    return builder;
  }

  const sb = {
    from: (table: string) => {
      if (table === "leads") return leadsBuilder();
      // whatsapp_contacts sync is opt-in and unused by these tests.
      return {
        select: () => ({ eq: () => ({ in: () => Promise.resolve({ data: [], error: null }) }) }),
        upsert: () => Promise.resolve({ data: [], error: null }),
      };
    },
  };

  return { sb, calls, upsertBatches, insertBatches };
}

describe("batchImportCsvLeads — updating already-matched leads", () => {
  it("writes all updates in one bulk upsert call, not one per row", async () => {
    const existing = Array.from({ length: 50 }, (_, i) => ({
      id: `lead-${i}`,
      phone: `9715012340${String(i).padStart(2, "0")}`,
      full_name: `Existing ${i}`,
      email: null,
      company_name: null,
      notes: null,
      meta: {},
      pipeline_stage: null,
    }));
    const { sb, calls, upsertBatches } = fakeSupabase(existing);

    const rows: CsvLeadRow[] = existing.map((e) => ({
      phone: `+${e.phone}`,
      full_name: null, // caller didn't re-supply a name — the point of this test
    }));

    const result = await batchImportCsvLeads(sb, "ws-1", rows);

    expect(result.updated).toBe(50);
    // One upsert call for all 50 rows (well under the 200-row chunk size) —
    // not 50 individual .update() round trips.
    const upsertCalls = calls.filter((c) => c.method === "upsert");
    expect(upsertCalls).toHaveLength(1);
    expect(upsertBatches[0]).toHaveLength(50);
  });

  it("keeps the lead's existing name when the row doesn't supply one — a bulk write can't leave a column untouched per-row", async () => {
    const existing = [
      {
        id: "lead-1",
        phone: "971501234567",
        full_name: "Original Name",
        email: "original@example.com",
        company_name: "Original Co",
        notes: "Original notes",
        meta: {},
        pipeline_stage: null,
      },
    ];
    const { sb, upsertBatches } = fakeSupabase(existing);

    const rows: CsvLeadRow[] = [{ phone: "+971501234567", full_name: null, email: null }];
    await batchImportCsvLeads(sb, "ws-1", rows);

    const written = upsertBatches[0]![0]!;
    expect(written.full_name).toBe("Original Name");
    expect(written.email).toBe("original@example.com");
    expect(written.company_name).toBe("Original Co");
    expect(written.notes).toBe("Original notes");
  });

  it("still overwrites a field when the row does supply a new value", async () => {
    const existing = [
      {
        id: "lead-1",
        phone: "971501234567",
        full_name: "Old Name",
        email: null,
        company_name: null,
        notes: null,
        meta: {},
        pipeline_stage: null,
      },
    ];
    const { sb, upsertBatches } = fakeSupabase(existing);

    const rows: CsvLeadRow[] = [{ phone: "+971501234567", full_name: "New Name" }];
    await batchImportCsvLeads(sb, "ws-1", rows);

    expect(upsertBatches[0]![0]!.full_name).toBe("New Name");
  });

  it("carries workspace_id and phone on every update row, so the upsert's insert-branch validation never fails", async () => {
    const existing = [
      { id: "lead-1", phone: "971501234567", full_name: "X", email: null, company_name: null, notes: null, meta: {}, pipeline_stage: null },
    ];
    const { sb, upsertBatches } = fakeSupabase(existing);

    await batchImportCsvLeads(sb, "ws-42", [{ phone: "+971501234567", full_name: null }]);

    const row = upsertBatches[0]![0]!;
    expect(row.workspace_id).toBe("ws-42");
    expect(row.phone).toBe("971501234567");
    expect(row.id).toBe("lead-1");
  });

  it("splits a large update batch across multiple upsert chunks, still far fewer than one per row", async () => {
    const existing = Array.from({ length: 450 }, (_, i) => ({
      id: `lead-${i}`,
      phone: `97150${String(1000000 + i)}`,
      full_name: "Name",
      email: null,
      company_name: null,
      notes: null,
      meta: {},
      pipeline_stage: null,
    }));
    const { sb, upsertBatches } = fakeSupabase(existing);

    const rows: CsvLeadRow[] = existing.map((e) => ({ phone: `+${e.phone}`, full_name: null }));
    const result = await batchImportCsvLeads(sb, "ws-1", rows);

    expect(result.updated).toBe(450);
    // 450 rows at 200/chunk = 3 upsert calls, not 450 update calls.
    expect(upsertBatches).toHaveLength(3);
    expect(upsertBatches.reduce((n, b) => n + b.length, 0)).toBe(450);
  });
});
