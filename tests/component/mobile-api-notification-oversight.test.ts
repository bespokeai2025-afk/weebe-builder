/**
 * Task #578 — Mobile API contract & notification oversight.
 *
 * Covers:
 * - personal notification prefs: key validation, critical-mute rejection,
 *   dedupe, fail-open mute lookup
 * - isMutableEventKey semantics (critical events never mutable)
 * - v1 leads filter validation parity (registry-driven, assigned_to_me
 *   disallowed for API-key callers)
 * - notification catalogue applicability (applicableEventKeys)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── supabaseAdmin mock (chainable query builder) ─────────────────────────────
type Result = { data: any; error: any; count?: number | null };
let nextResults: Result[] = [];
const takeResult = (): Result => nextResults.shift() ?? { data: null, error: null };

function chain(): any {
  const p: any = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") {
          const r = takeResult();
          return (resolve: any) => resolve(r);
        }
        return (..._args: any[]) => p;
      },
    },
  );
  return p;
}

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: () => chain() },
}));

import {
  isMutableEventKey,
  getUserNotificationPrefsCore,
  updateUserNotificationPrefsCore,
  getMutedUserIds,
} from "@/lib/notifications/user-notification-prefs.server";
import {
  NOTIFICATION_EVENT_KEYS,
  severityForEvent,
  NOTIFICATION_EVENT_DEFS,
} from "@/lib/notifications/notification-engine.shared";
import { applicableEventKeys } from "@/lib/notifications/notification-capabilities.server";
import { validateFilterConfig } from "@/lib/people-views/filter-engine.server";

const WS = "00000000-0000-0000-0000-000000000001";
const USER = "00000000-0000-0000-0000-000000000002";

beforeEach(() => {
  nextResults = [];
});

describe("isMutableEventKey", () => {
  it("rejects unknown keys", () => {
    expect(isMutableEventKey("not_a_real_event")).toBe(false);
  });
  it("allows non-critical catalogue keys and blocks critical ones", () => {
    const critical = NOTIFICATION_EVENT_KEYS.filter((k) => severityForEvent(k) === "critical");
    const nonCritical = NOTIFICATION_EVENT_KEYS.filter((k) => severityForEvent(k) !== "critical");
    expect(nonCritical.length).toBeGreaterThan(0);
    for (const k of critical) expect(isMutableEventKey(k)).toBe(false);
    expect(isMutableEventKey(nonCritical[0])).toBe(true);
  });
});

describe("updateUserNotificationPrefsCore validation", () => {
  const mutable = NOTIFICATION_EVENT_KEYS.find((k) => severityForEvent(k) !== "critical")!;
  const critical = NOTIFICATION_EVENT_KEYS.find((k) => severityForEvent(k) === "critical");

  it("rejects unknown event keys explicitly", async () => {
    await expect(
      updateUserNotificationPrefsCore(WS, USER, ["bogus_event"]),
    ).rejects.toThrow(/Unknown notification event key/);
  });

  it("rejects critical events explicitly (never silently drops)", async () => {
    if (!critical) return; // catalogue has no critical events — nothing to assert
    await expect(
      updateUserNotificationPrefsCore(WS, USER, [critical]),
    ).rejects.toThrow(/Critical events cannot be muted/);
  });

  it("rejects non-array input", async () => {
    await expect(updateUserNotificationPrefsCore(WS, USER, "x" as any)).rejects.toThrow(/array/);
  });

  it("dedupes and saves valid keys", async () => {
    nextResults = [{ data: null, error: null }]; // upsert ok
    const out = await updateUserNotificationPrefsCore(WS, USER, [mutable, mutable]);
    expect(out.mutedEventKeys).toEqual([mutable]);
  });

  it("surfaces DB errors (no silent success)", async () => {
    nextResults = [{ data: null, error: { message: "boom" } }];
    await expect(updateUserNotificationPrefsCore(WS, USER, [mutable])).rejects.toThrow(/boom/);
  });
});

describe("getUserNotificationPrefsCore", () => {
  it("missing row → empty prefs", async () => {
    nextResults = [{ data: null, error: null }];
    const prefs = await getUserNotificationPrefsCore(WS, USER);
    expect(prefs.mutedEventKeys).toEqual([]);
    expect(prefs.updatedAt).toBeNull();
  });

  it("sanitizes stored garbage (unknown keys dropped on read)", async () => {
    const mutable = NOTIFICATION_EVENT_KEYS.find((k) => severityForEvent(k) !== "critical")!;
    nextResults = [
      { data: { muted_event_keys: [mutable, "junk_key", 42], updated_at: "2026-08-01T00:00:00Z" }, error: null },
    ];
    const prefs = await getUserNotificationPrefsCore(WS, USER);
    expect(prefs.mutedEventKeys).toEqual([mutable]);
  });
});

describe("getMutedUserIds (delivery-time filter)", () => {
  const mutable = NOTIFICATION_EVENT_KEYS.find((k) => severityForEvent(k) !== "critical")!;

  it("fails OPEN on lookup error (delivers to everyone)", async () => {
    nextResults = [{ data: null, error: { message: "db down" } }];
    const muted = await getMutedUserIds(WS, mutable, [USER]);
    expect(muted.size).toBe(0);
  });

  it("returns muted user ids on success", async () => {
    nextResults = [{ data: [{ user_id: USER, muted_event_keys: [mutable] }], error: null }];
    const muted = await getMutedUserIds(WS, mutable, [USER, "other"]);
    expect(muted.has(USER)).toBe(true);
    expect(muted.size).toBe(1);
  });

  it("critical events short-circuit to empty (never mutable)", async () => {
    const critical = NOTIFICATION_EVENT_KEYS.find((k) => severityForEvent(k) === "critical");
    if (!critical) return;
    const muted = await getMutedUserIds(WS, critical, [USER]);
    expect(muted.size).toBe(0); // no query consumed
  });

  it("empty user list short-circuits", async () => {
    const muted = await getMutedUserIds(WS, mutable, []);
    expect(muted.size).toBe(0);
  });
});

describe("v1 leads filter validation parity", () => {
  it("accepts a canonical registry filter", () => {
    const v = validateFilterConfig({
      logic: "and",
      conditions: [{ field: "lead_status", operator: "equals", value: "qualified" }],
    });
    expect(v.ok).toBe(true);
  });

  it("rejects assigned_to_me when disallowed (API-key callers)", () => {
    const v = validateFilterConfig(
      { logic: "and", conditions: [{ field: "assigned_to_me", operator: "equals", value: true }] },
      { disallowFields: ["assigned_to_me"] },
    );
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/assigned_to_me/);
  });

  it("rejects unknown fields", () => {
    const v = validateFilterConfig({
      logic: "and",
      conditions: [{ field: "definitely_not_a_field!", operator: "equals", value: "x" }],
    });
    expect(v.ok).toBe(false);
  });
});

describe("catalogue applicability", () => {
  it("applicableEventKeys filters by capability map", () => {
    const capsAllOff: any = {
      core: true, leads: false, campaigns: false, campaign_reports: false,
      follow_up: false, whatsapp: false, hivemind: false, growthmind: false,
      systemmind: false, accountsmind: false, reseller: false,
    };
    const keys = applicableEventKeys(capsAllOff);
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) expect(NOTIFICATION_EVENT_DEFS[k].capability).toBe("core");
    // leads events excluded
    expect(keys).not.toContain("qualified_leads_generated");
  });
});
