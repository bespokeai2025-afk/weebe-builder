/**
 * Task #577 — Lead notification filters + leads-screen filter parity.
 *
 * Covers:
 * - evaluateFilterAgainstRow ANY/ALL semantics, operators, derived booleans
 * - validateFilterConfig OR-logic gating + disallowFields
 * - new registry keys (assigned_to / assigned_to_me / unassigned)
 * - notification engine helpers (hasLeadFilterConditions, LEAD_FILTERABLE_EVENTS)
 * - timezone date boundaries (Europe/London vs UTC)
 */
import { describe, it, expect } from "vitest";
import {
  FILTER_FIELDS,
  validateFilterConfig,
  evaluateFilterAgainstRow,
  type FilterConfig,
} from "@/lib/people-views/filter-engine.server";
import {
  LEAD_FILTERABLE_EVENTS,
  hasLeadFilterConditions,
} from "@/lib/notifications/notification-engine.shared";

const lead = (over: Record<string, unknown> = {}) => ({
  id: "l1",
  full_name: "Jane Smith",
  email: "jane@example.com",
  phone: "+447700900000",
  status: "need_to_call",
  source: "webform",
  lead_score: 80,
  assigned_to: null,
  created_at: "2026-08-10T12:00:00Z",
  meta: {},
  ...over,
});

const cfg = (logic: "and" | "or", conditions: any[]): FilterConfig =>
  ({ logic, conditions } as FilterConfig);

describe("registry additions", () => {
  it("has assigned_to, assigned_to_me, unassigned keys", () => {
    expect(FILTER_FIELDS.assigned_to).toBeTruthy();
    expect(FILTER_FIELDS.assigned_to_me?.derived).toBe("assigned_to_me");
    expect(FILTER_FIELDS.unassigned?.derived).toBe("unassigned");
  });
});

describe("validateFilterConfig OR gating", () => {
  const raw = { logic: "or", conditions: [{ field: "lead_status", operator: "equals", value: "qualified" }] };

  it("rejects 'or' logic by default (page filters stay AND-only)", () => {
    const v = validateFilterConfig(raw);
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/ANY/i);
  });

  it("accepts 'or' when allowOrLogic is set", () => {
    const v = validateFilterConfig(raw, { allowOrLogic: true });
    expect(v.ok).toBe(true);
    expect(v.config?.logic).toBe("or");
  });

  it("rejects disallowed fields (assigned_to_me for notification filters)", () => {
    const v = validateFilterConfig(
      { logic: "and", conditions: [{ field: "assigned_to_me", operator: "equals", value: true }] },
      { allowOrLogic: true, disallowFields: ["assigned_to_me"] },
    );
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/assigned_to_me/);
  });

  it("rejects unknown fields and malformed shapes", () => {
    expect(validateFilterConfig({ logic: "and", conditions: [{ field: "nope", operator: "equals", value: 1 }] }).ok).toBe(false);
    expect(validateFilterConfig("garbage").ok).toBe(false);
    expect(validateFilterConfig({ conditions: "x" }).ok).toBe(false);
  });
});

describe("evaluateFilterAgainstRow — ALL / ANY semantics", () => {
  const c1 = { field: "lead_status", operator: "equals", value: "qualified" };
  const c2 = { field: "lead_source", operator: "equals", value: "webform" };

  it("empty conditions match everything", () => {
    expect(evaluateFilterAgainstRow(lead(), cfg("and", []))).toBe(true);
  });

  it("AND requires every condition", () => {
    expect(evaluateFilterAgainstRow(lead({ status: "qualified" }), cfg("and", [c1, c2]))).toBe(true);
    expect(evaluateFilterAgainstRow(lead(), cfg("and", [c1, c2]))).toBe(false);
  });

  it("OR requires any condition", () => {
    expect(evaluateFilterAgainstRow(lead(), cfg("or", [c1, c2]))).toBe(true);
    expect(evaluateFilterAgainstRow(lead({ source: "outbound" }), cfg("or", [c1, c2]))).toBe(false);
  });
});

describe("evaluateFilterAgainstRow — operators", () => {
  it("text contains / not_contains / in_list / not_in_list", () => {
    const row = lead({ call_outcome: "Answered — Positive" });
    expect(evaluateFilterAgainstRow(row, cfg("and", [{ field: "call_outcome", operator: "contains", value: "positive" }]))).toBe(true);
    expect(evaluateFilterAgainstRow(row, cfg("and", [{ field: "call_outcome", operator: "not_contains", value: "positive" }]))).toBe(false);
    expect(evaluateFilterAgainstRow(lead(), cfg("and", [{ field: "lead_source", operator: "in_list", value: ["webform", "outbound"] }]))).toBe(true);
    expect(evaluateFilterAgainstRow(lead(), cfg("and", [{ field: "lead_source", operator: "not_in_list", value: ["outbound"] }]))).toBe(true);
  });

  it("number comparisons and between", () => {
    expect(evaluateFilterAgainstRow(lead(), cfg("and", [{ field: "lead_score", operator: "greater_than", value: 50 }]))).toBe(true);
    expect(evaluateFilterAgainstRow(lead(), cfg("and", [{ field: "lead_score", operator: "less_than", value: 50 }]))).toBe(false);
    expect(evaluateFilterAgainstRow(lead(), cfg("and", [{ field: "lead_score", operator: "between", value: 70, value2: 90 }]))).toBe(true);
  });

  it("is_empty / is_not_empty", () => {
    expect(evaluateFilterAgainstRow(lead({ call_outcome: null }), cfg("and", [{ field: "call_outcome", operator: "is_empty" }]))).toBe(true);
    expect(evaluateFilterAgainstRow(lead({ call_outcome: "x" }), cfg("and", [{ field: "call_outcome", operator: "is_not_empty" }]))).toBe(true);
  });

  it("missing values fail value-comparisons (not match)", () => {
    expect(evaluateFilterAgainstRow(lead({ lead_score: null }), cfg("and", [{ field: "lead_score", operator: "greater_than", value: 1 }]))).toBe(false);
  });

  it("meta.* fields read from the meta object", () => {
    expect(evaluateFilterAgainstRow(
      lead({ meta: { area: "Leeds" } }),
      cfg("and", [{ field: "meta.area", operator: "equals", value: "Leeds" }]),
    )).toBe(true);
  });
});

describe("evaluateFilterAgainstRow — derived booleans", () => {
  it("unassigned true/false", () => {
    const cond = (v: any) => cfg("and", [{ field: "unassigned", operator: "equals", value: v }]);
    expect(evaluateFilterAgainstRow(lead(), cond(true))).toBe(true);
    expect(evaluateFilterAgainstRow(lead({ assigned_to: "u1" }), cond(true))).toBe(false);
    expect(evaluateFilterAgainstRow(lead({ assigned_to: "u1" }), cond(false))).toBe(true);
  });

  it("assigned_to_me fails CLOSED without currentUserId", () => {
    const c = cfg("and", [{ field: "assigned_to_me", operator: "equals", value: true }]);
    expect(evaluateFilterAgainstRow(lead({ assigned_to: "u1" }), c)).toBe(false);
    expect(evaluateFilterAgainstRow(lead({ assigned_to: "u1" }), c, FILTER_FIELDS, { currentUserId: "u1" })).toBe(true);
    expect(evaluateFilterAgainstRow(lead({ assigned_to: "u2" }), c, FILTER_FIELDS, { currentUserId: "u1" })).toBe(false);
  });

  it("assigned_to exact match via text equals", () => {
    expect(evaluateFilterAgainstRow(
      lead({ assigned_to: "u9" }),
      cfg("and", [{ field: "assigned_to", operator: "equals", value: "u9" }]),
    )).toBe(true);
  });

  it("email/phone exists derived booleans", () => {
    expect(evaluateFilterAgainstRow(lead({ phone: "" }), cfg("and", [{ field: "phone_exists", operator: "equals", value: true }]))).toBe(false);
    expect(evaluateFilterAgainstRow(lead(), cfg("and", [{ field: "email_exists", operator: "equals", value: true }]))).toBe(true);
  });
});

describe("evaluateFilterAgainstRow — date boundaries & timezone", () => {
  it("before/after with UTC day boundaries by default", () => {
    const row = lead({ created_at: "2026-08-10T00:30:00Z" });
    expect(evaluateFilterAgainstRow(row, cfg("and", [{ field: "created_date", operator: "after", value: "2026-08-09" }]))).toBe(true);
    expect(evaluateFilterAgainstRow(row, cfg("and", [{ field: "created_date", operator: "before", value: "2026-08-10" }]))).toBe(false);
    expect(evaluateFilterAgainstRow(row, cfg("and", [{ field: "created_date", operator: "between", value: "2026-08-10", value2: "2026-08-10" }]))).toBe(true);
  });

  it("Europe/London (BST) shifts the day boundary an hour earlier", () => {
    // 2026-08-09T23:30:00Z is 2026-08-10 00:30 London time.
    const row = lead({ created_at: "2026-08-09T23:30:00Z" });
    const betweenAug10 = [{ field: "created_date", operator: "between", value: "2026-08-10", value2: "2026-08-10" }];
    expect(evaluateFilterAgainstRow(row, cfg("and", betweenAug10))).toBe(false); // UTC: still Aug 9
    expect(evaluateFilterAgainstRow(row, cfg("and", betweenAug10), FILTER_FIELDS, { timezone: "Europe/London" })).toBe(true);
  });
});

describe("notification engine lead-filter helpers", () => {
  it("LEAD_FILTERABLE_EVENTS contains exactly the lead events", () => {
    for (const k of ["lead_created", "lead_positive", "lead_assigned", "qualified_leads_generated", "appointments_booked"]) {
      expect(LEAD_FILTERABLE_EVENTS.has(k)).toBe(true);
    }
    expect(LEAD_FILTERABLE_EVENTS.has("campaign_completed")).toBe(false);
  });

  it("hasLeadFilterConditions detects real configs only", () => {
    expect(hasLeadFilterConditions(null)).toBe(false);
    expect(hasLeadFilterConditions({})).toBe(false);
    expect(hasLeadFilterConditions({ conditions: [] })).toBe(false);
    expect(hasLeadFilterConditions({ conditions: [{ field: "lead_status", operator: "equals", value: "x" }] })).toBe(true);
  });
});

describe("Europe/London DST transition day boundaries", () => {
  const between = (d: string) =>
    cfg("and", [{ field: "created_date", operator: "between", value: d, value2: d }]);
  const tz = { timezone: "Europe/London" };

  it("spring-forward (2026-03-29 is a 23-hour London day)", () => {
    // London day runs 00:00 GMT (=00:00Z) to 23:59:59.999 BST (=22:59:59.999Z)
    expect(evaluateFilterAgainstRow(lead({ created_at: "2026-03-29T22:30:00Z" }), between("2026-03-29"), FILTER_FIELDS, tz)).toBe(true);
    // 23:30Z is already 00:30 BST on Mar 30 — must NOT match Mar 29 (a naive +24h end would include it)
    expect(evaluateFilterAgainstRow(lead({ created_at: "2026-03-29T23:30:00Z" }), between("2026-03-29"), FILTER_FIELDS, tz)).toBe(false);
    expect(evaluateFilterAgainstRow(lead({ created_at: "2026-03-29T23:30:00Z" }), between("2026-03-30"), FILTER_FIELDS, tz)).toBe(true);
  });

  it("fall-back (2026-10-25 is a 25-hour London day)", () => {
    // London Oct 25 runs 00:00 BST (=Oct 24 23:00Z) to 23:59:59.999 GMT (=23:59:59.999Z)
    expect(evaluateFilterAgainstRow(lead({ created_at: "2026-10-25T23:30:00Z" }), between("2026-10-25"), FILTER_FIELDS, tz)).toBe(true); // naive +24h end (22:59:59.999Z) would omit this
    expect(evaluateFilterAgainstRow(lead({ created_at: "2026-10-24T23:30:00Z" }), between("2026-10-25"), FILTER_FIELDS, tz)).toBe(true);
    expect(evaluateFilterAgainstRow(lead({ created_at: "2026-10-26T00:30:00Z" }), between("2026-10-25"), FILTER_FIELDS, tz)).toBe(false);
  });
});

describe("campaign-mode dry-run validation", () => {
  it("validateFilterConfig rejects assigned_to_me when disallowed (scheduler contexts)", () => {
    const v = validateFilterConfig(
      { logic: "and", conditions: [{ field: "assigned_to_me", operator: "equals", value: true }] },
      { disallowFields: ["assigned_to_me"] },
    );
    expect(v.ok).toBe(false);
  });
});

describe("fail-closed on malformed persisted filters", () => {
  it("non-array conditions is invalid (would suppress delivery)", () => {
    const v = validateFilterConfig({ conditions: "bad" }, { allowMeta: true, allowOrLogic: true });
    expect(v.ok).toBe(false);
  });
  it("invalid logic with empty conditions is invalid", () => {
    const v = validateFilterConfig({ logic: "nope", conditions: [] }, { allowMeta: true, allowOrLogic: true });
    expect(v.ok).toBe(false);
  });
  it("validated empty config passes unfiltered (ok + zero conditions)", () => {
    const v = validateFilterConfig({ logic: "and", conditions: [] }, { allowMeta: true, allowOrLogic: true });
    expect(v.ok).toBe(true);
    expect(v.config?.conditions?.length ?? 0).toBe(0);
  });
});
