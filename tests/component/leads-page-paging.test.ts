/**
 * Leads page paging: the server applies the page's filters and returns one page, the number of
 * matching leads, and headline numbers over every lead.
 */
import { describe, expect, it } from "vitest";
import {
  leadMatchesPageFilters,
  pageOfLeads,
  summarizeLeads,
} from "@/lib/dashboard/leads-page.shared";

function lead(i: number, over: Record<string, unknown> = {}) {
  return {
    id: `lead-${i}`,
    full_name: `Person ${i}`,
    phone: `0770090${String(i).padStart(4, "0")}`,
    email: `p${i}@example.com`,
    status: "need_to_call",
    sentiment: i % 3 === 0 ? "Positive" : i % 3 === 1 ? "Neutral" : "Negative",
    lead_score: i % 10,
    created_at: new Date(Date.UTC(2026, 9, 1 + (i % 28))).toISOString(),
    meta: { agent_name: i % 2 ? "Clare" : "Sam" },
    ...over,
  };
}

const many = Array.from({ length: 2_500 }, (_, i) => lead(i));

describe("pageOfLeads", () => {
  it("returns one page and the full matching count", () => {
    const res = pageOfLeads(many, {}, { isWbah: false, page: 2, pageSize: 25 });
    expect(res.rows).toHaveLength(25);
    expect(res.rows[0]!.id).toBe("lead-25");
    expect(res.matching).toBe(2_500);
  });

  it("searches every lead, not just the first 1,000", () => {
    const res = pageOfLeads(many, { search: "person 2400" }, { isWbah: false, page: 1, pageSize: 25 });
    expect(res.rows.map((r) => r.id)).toEqual(["lead-2400"]);
  });

  it("clamps a page past the end to the last page", () => {
    const res = pageOfLeads(many, { sentiment: "positive" }, { isWbah: false, page: 999, pageSize: 100 });
    expect(res.matching).toBe(834);
    expect(res.page).toBe(9);
    expect(res.rows).toHaveLength(34);
  });

  it("lists every matching id for select-all", () => {
    const res = pageOfLeads(many, { wbahAgent: "Sam" }, { isWbah: true, page: 1, pageSize: 10 });
    expect(res.matchingIds()).toHaveLength(1_250);
  });
});

describe("leadMatchesPageFilters", () => {
  const ctx = { isWbah: false, isRetell: true };

  it("call status and duration read the lead's latest call", () => {
    const l = lead(1, { retell_call: { call_status: "completed", duration_seconds: 90 } });
    expect(leadMatchesPageFilters(l, { callStatus: "completed", minDurationSec: 60 }, ctx)).toBe(true);
    expect(leadMatchesPageFilters(l, { minDurationSec: 120 }, ctx)).toBe(false);
  });

  it("date range uses the last call, then last contact, then creation", () => {
    const l = lead(1, { meta: { last_called_at: "2026-10-20T10:00:00Z" }, created_at: "2026-01-01T00:00:00Z" });
    expect(leadMatchesPageFilters(l, { dateFrom: "2026-10-19T00:00:00Z" }, ctx)).toBe(true);
    expect(leadMatchesPageFilters(l, { dateTo: "2026-10-19T00:00:00Z" }, ctx)).toBe(false);
  });

  it("matches the workspace agent by id, Retell id or name", () => {
    const l = lead(1, { agent_id: "retell-1" });
    expect(leadMatchesPageFilters(l, { agent: { id: "local", retellAgentId: "retell-1" } }, ctx)).toBe(true);
    expect(leadMatchesPageFilters(l, { agent: { id: "other", name: "Nobody" } }, ctx)).toBe(false);
  });

  it("quick filters", () => {
    expect(leadMatchesPageFilters(lead(3), { quick: "positive" }, ctx)).toBe(true);
    expect(leadMatchesPageFilters(lead(1), { quick: "callback" }, ctx)).toBe(false);
    expect(leadMatchesPageFilters(lead(1, { status: "callback_requested" }), { quick: "callback" }, ctx)).toBe(true);
  });
});

describe("summarizeLeads", () => {
  it("counts over every lead and keeps agent names for the filter", () => {
    const s = summarizeLeads(many, false);
    expect(s.total).toBe(2_500);
    expect(s.positive).toBe(834);
    expect(s.avgScore).toBe(5);
    expect(s.agentNames.sort()).toEqual(["Clare", "Sam"]);
    expect(s.isRetell).toBe(false);
  });
});
