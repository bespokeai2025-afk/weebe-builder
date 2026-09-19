import { describe, it, expect } from "vitest";
import {
  bucketLeadsCreatedAt,
  getLeadsCreatedTrendCore,
} from "@/lib/dashboard/leads.functions";

// A fixed "now" so tests are deterministic regardless of when they run:
// 2026-09-18T12:00:00.000Z (a Friday, no DST edge nearby in UTC).
const NOW = Date.UTC(2026, 8, 18, 12, 0, 0);
const DAY_MS = 24 * 60 * 60 * 1000;

function isoAt(daysAgo: number, hourUtc = 10): string {
  return new Date(NOW - daysAgo * DAY_MS).toISOString().slice(0, 10) + `T${String(hourUtc).padStart(2, "0")}:00:00.000Z`;
}

describe("bucketLeadsCreatedAt (pure, no Supabase dependency)", () => {
  it("returns exactly 7 buckets for a 7-day range", () => {
    const result = bucketLeadsCreatedAt([], 7, "UTC", NOW);
    expect(result).toHaveLength(7);
  });

  it("returns exactly 30 buckets for a 30-day range", () => {
    const result = bucketLeadsCreatedAt([], 30, "UTC", NOW);
    expect(result).toHaveLength(30);
  });

  it("zero-fills days with no leads instead of omitting them", () => {
    // One lead today, one lead 6 days ago, nothing in between.
    const result = bucketLeadsCreatedAt([isoAt(0), isoAt(6)], 7, "UTC", NOW);
    expect(result).toHaveLength(7);
    expect(result[0].count).toBe(1); // oldest day (6 days ago)
    expect(result[6].count).toBe(1); // today
    for (let i = 1; i < 6; i++) {
      expect(result[i].count).toBe(0);
    }
  });

  it("returns an empty dataset as all-zero buckets, not an error or omission", () => {
    const result = bucketLeadsCreatedAt([], 7, "UTC", NOW);
    expect(result.every((b) => b.count === 0)).toBe(true);
    expect(result).toHaveLength(7);
  });

  it("returns buckets in chronological ascending order (oldest first)", () => {
    const result = bucketLeadsCreatedAt([], 30, "UTC", NOW);
    // Re-derive the expected date labels independently and compare order.
    const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short" });
    const expectedOldestLabel = fmt.format(new Date(NOW - 29 * DAY_MS));
    const expectedNewestLabel = fmt.format(new Date(NOW));
    expect(result[0].date).toBe(expectedOldestLabel);
    expect(result[29].date).toBe(expectedNewestLabel);
  });

  it("counts multiple leads on the same UTC day into one bucket", () => {
    const result = bucketLeadsCreatedAt(
      [isoAt(2, 1), isoAt(2, 14), isoAt(2, 23)],
      7,
      "UTC",
      NOW,
    );
    const dayIndex = 7 - 1 - 2; // 2 days ago, from the end
    expect(result[dayIndex].count).toBe(3);
  });

  it("timezone boundary: a lead just before UTC midnight buckets into the PREVIOUS calendar day in a negative-offset timezone", () => {
    // 2026-09-15T23:30:00Z is 15 Sep in UTC, but only 19:30 on 15 Sep in
    // America/New_York (UTC-4 in September, EDT) — same calendar day there
    // too. Use a clearer boundary case: 2026-09-16T02:00:00Z is 16 Sep in
    // UTC, but still 15 Sep 22:00 in America/New_York (UTC-4).
    const lateUtc = "2026-09-16T02:00:00.000Z";
    const asUtc = bucketLeadsCreatedAt([lateUtc], 7, "UTC", NOW);
    const asNewYork = bucketLeadsCreatedAt([lateUtc], 7, "America/New_York", NOW);

    // In UTC this lead lands on 16 Sep; in New York it lands on 15 Sep —
    // a full day earlier. Confirm the bucket that receives the count differs.
    const utcNonZeroIndex = asUtc.findIndex((b) => b.count === 1);
    const nyNonZeroIndex = asNewYork.findIndex((b) => b.count === 1);
    expect(utcNonZeroIndex).toBeGreaterThanOrEqual(0);
    expect(nyNonZeroIndex).toBeGreaterThanOrEqual(0);
    expect(nyNonZeroIndex).toBe(utcNonZeroIndex - 1);
  });

  it("ignores a created_at timestamp that falls entirely outside the requested range", () => {
    const wayBefore = new Date(NOW - 100 * DAY_MS).toISOString();
    const result = bucketLeadsCreatedAt([wayBefore], 7, "UTC", NOW);
    expect(result.every((b) => b.count === 0)).toBe(true);
  });
});

describe("getLeadsCreatedTrendCore (injectable-deps, tenant/role scoping)", () => {
  function makeLeadsBuilder(rows: Array<{ created_at: string }>, spy: { calls: Array<[string, string]> }) {
    const builder: any = {
      select: () => builder,
      eq: (col: string, val: string) => {
        spy.calls.push([col, val]);
        return builder;
      },
      gte: (col: string, val: string) => {
        spy.calls.push([col, val]);
        return builder;
      },
      then: (resolve: (v: unknown) => void) => resolve({ data: rows, error: null }),
    };
    return builder;
  }

  function makeFakeSb(opts: {
    workspaceSlug?: string | null;
    timezone?: string | null;
    leads: Array<{ created_at: string }>;
    spy: { calls: Array<[string, string]> };
  }) {
    return {
      from(table: string) {
        if (table === "workspaces") {
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.workspaceSlug != null ? { slug: opts.workspaceSlug } : null, error: null }) }) }) };
        }
        if (table === "workspace_settings") {
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.timezone !== undefined ? { timezone: opts.timezone } : null, error: null }) }) }) };
        }
        if (table === "leads") return makeLeadsBuilder(opts.leads, opts.spy);
        throw new Error(`Unexpected table in test: ${table}`);
      },
    };
  }

  it("scopes the leads query by workspace_id", async () => {
    const spy = { calls: [] as Array<[string, string]> };
    const sb = makeFakeSb({ workspaceSlug: "acme", timezone: "UTC", leads: [], spy });
    await getLeadsCreatedTrendCore(7, { sb, workspaceId: "ws-123", userId: "user-1", assignedOnly: false, now: NOW });
    expect(spy.calls.some(([col, val]) => col === "workspace_id" && val === "ws-123")).toBe(true);
  });

  it("adds an assigned_to filter only when assignedOnly is true", async () => {
    const spyRestricted = { calls: [] as Array<[string, string]> };
    const sbRestricted = makeFakeSb({ workspaceSlug: "acme", timezone: "UTC", leads: [], spy: spyRestricted });
    await getLeadsCreatedTrendCore(7, { sb: sbRestricted, workspaceId: "ws-123", userId: "user-42", assignedOnly: true, now: NOW });
    expect(spyRestricted.calls.some(([col, val]) => col === "assigned_to" && val === "user-42")).toBe(true);

    const spyUnrestricted = { calls: [] as Array<[string, string]> };
    const sbUnrestricted = makeFakeSb({ workspaceSlug: "acme", timezone: "UTC", leads: [], spy: spyUnrestricted });
    await getLeadsCreatedTrendCore(7, { sb: sbUnrestricted, workspaceId: "ws-123", userId: "user-42", assignedOnly: false, now: NOW });
    expect(spyUnrestricted.calls.some(([col]) => col === "assigned_to")).toBe(false);
  });

  it("uses the WBAH Europe/London override regardless of workspace_settings.timezone", async () => {
    const spy = { calls: [] as Array<[string, string]> };
    // A lead at 2026-09-16T23:30:00Z is 17 Sep in UTC but 00:30 on 17 Sep in
    // Europe/London (BST, UTC+1 in September) too in this specific case —
    // use a clearer instant: 2026-09-16T22:30:00Z is 16 Sep UTC and 23:30
    // on 16 Sep London time (still same day) vs 2026-09-16T23:30 is 17 Sep
    // in London (BST +1) but still 16 Sep in UTC.
    const boundaryLead = { created_at: "2026-09-16T23:30:00.000Z" };
    const sb = makeFakeSb({ workspaceSlug: "webuyanyhouse", timezone: "UTC", leads: [boundaryLead], spy });
    const result = await getLeadsCreatedTrendCore(7, { sb, workspaceId: "ws-wbah", userId: "user-1", assignedOnly: false, now: NOW });
    // Confirm exactly one day bucket received the lead (i.e. WBAH's
    // Europe/London override was actually applied, not silently ignored).
    expect(result.reduce((sum, b) => sum + b.count, 0)).toBe(1);
  });

  it("falls back to UTC when workspace_settings.timezone is missing or invalid", async () => {
    const spy = { calls: [] as Array<[string, string]> };
    const sb = makeFakeSb({ workspaceSlug: "acme", timezone: "Not/ARealZone", leads: [{ created_at: isoAt(0) }], spy });
    const result = await getLeadsCreatedTrendCore(7, { sb, workspaceId: "ws-123", userId: "user-1", assignedOnly: false, now: NOW });
    expect(result.reduce((sum, b) => sum + b.count, 0)).toBe(1);
  });

  it("returns 30 zero-filled buckets when the workspace has no leads at all", async () => {
    const spy = { calls: [] as Array<[string, string]> };
    const sb = makeFakeSb({ workspaceSlug: "acme", timezone: "UTC", leads: [], spy });
    const result = await getLeadsCreatedTrendCore(30, { sb, workspaceId: "ws-empty", userId: "user-1", assignedOnly: false, now: NOW });
    expect(result).toHaveLength(30);
    expect(result.every((b) => b.count === 0)).toBe(true);
  });
});
