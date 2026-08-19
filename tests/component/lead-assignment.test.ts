/**
 * Sales agent role + lead assignment — shared-model contract tests.
 *
 * Guards the invariants the assignment feature relies on:
 *   • sales_agent is a built-in role with assignedRecordsOnly=true and no
 *     access to settings/team/billing surfaces or high-risk actions.
 *   • lead_assignment is a registered ActionKey with a label and a package
 *     feature mapping (so entitlement caps resolve instead of failing).
 *   • lead_assigned stays a registered notification event (person-directed
 *     emits depend on it).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ROLE_KEYS,
  ROLE_LABELS,
  ACTION_KEYS,
  ACTION_LABELS,
  DEFAULT_ROLE_PERMISSIONS,
  PAGE_KEYS,
} from "@/lib/permissions/permissions.shared";
import { ACTION_FEATURE_MAP } from "@/lib/packages/packages.shared";
import { NOTIFICATION_EVENT_DEFS } from "@/lib/notifications/notification-engine.shared";

describe("sales_agent role", () => {
  const role = DEFAULT_ROLE_PERMISSIONS.sales_agent;

  it("is a registered built-in role with a label", () => {
    expect(ROLE_KEYS).toContain("sales_agent");
    expect(ROLE_LABELS.sales_agent).toBe("Sales Agent");
    expect(role).toBeDefined();
  });

  it("only sees assigned records", () => {
    expect(role.assignedRecordsOnly).toBe(true);
  });

  it("has no access to sensitive surfaces", () => {
    for (const page of ["settings", "team_access", "billing", "phone_numbers", "systemmind"] as const) {
      expect(role.pageAccess[page] ?? "hidden").toBe("hidden");
    }
  });

  it("can work leads and pipeline", () => {
    expect(role.pageAccess.leads).toBe("edit");
    expect(role.pageAccess.pipeline).toBe("edit");
  });

  it("has every high-risk action denied (including lead_assignment)", () => {
    for (const a of ACTION_KEYS) {
      expect(role.actionAccess[a] ?? false).toBe(false);
    }
  });

  it("defines a page level for every page key (no undefined gaps)", () => {
    for (const p of PAGE_KEYS) {
      expect(role.pageAccess[p]).toBeDefined();
    }
  });
});

describe("lead_assignment action key", () => {
  it("is registered with a label", () => {
    expect(ACTION_KEYS).toContain("lead_assignment");
    expect(ACTION_LABELS.lead_assignment).toBeTruthy();
  });

  it("maps to a package feature so entitlement caps resolve", () => {
    expect(ACTION_FEATURE_MAP.lead_assignment).toBe("leads");
  });

  it("admins/owner/manager get lead_assignment by default; restricted roles don't", () => {
    expect(DEFAULT_ROLE_PERMISSIONS.owner.actionAccess.lead_assignment).toBe(true);
    expect(DEFAULT_ROLE_PERMISSIONS.admin.actionAccess.lead_assignment).toBe(true);
    expect(DEFAULT_ROLE_PERMISSIONS.viewer.actionAccess.lead_assignment ?? false).toBe(false);
    expect(DEFAULT_ROLE_PERMISSIONS.reports_only.actionAccess.lead_assignment ?? false).toBe(false);
    expect(DEFAULT_ROLE_PERMISSIONS.suspended.actionAccess.lead_assignment ?? false).toBe(false);
  });
});

describe("assignedRecordsOnly enforcement (source contract)", () => {
  // Server-fn behavior tests need live DB fixtures; this source-level contract
  // guards the invariant that every lead-touching server function keeps its
  // assigned-records-only scoping. If a guard is removed, these fail loudly.
  const read = (p: string) => readFileSync(p, "utf8");

  it("leads.functions.ts guards every lead mutation/read path", () => {
    const src = read("src/lib/dashboard/leads.functions.ts");
    // One guard per function that the security review flagged.
    const fns = [
      "setLeadStatus", "deleteLead", "removeLeads", "upsertLead",
      "startQualificationCallsForLeads", "scheduleQualificationCalls",
      "fireScheduledCalls", "getOverviewStats", "listLeads",
    ];
    for (const fn of fns) {
      const start = src.indexOf(`export const ${fn}`);
      expect(start, `${fn} missing`).toBeGreaterThan(-1);
      const body = src.slice(start, src.indexOf("export const", start + 10) === -1
        ? undefined
        : src.indexOf("export const", start + 10));
      expect(
        /assignedRecordsOnly|assignedOnly|scopeLeads/.test(body),
        `${fn} lost its assignedRecordsOnly guard`,
      ).toBe(true);
    }
  });

  it("pipeline.functions.ts guards detail + mutations", () => {
    const src = read("src/lib/pipeline/pipeline.functions.ts");
    for (const fn of ["getLeadDetail", "setSaleDoneAmount", "setLeadPipelineStage", "getPipelineLeads"]) {
      const start = src.indexOf(`export const ${fn}`);
      expect(start, `${fn} missing`).toBeGreaterThan(-1);
      const next = src.indexOf("export const", start + 10);
      const body = src.slice(start, next === -1 ? undefined : next);
      expect(
        /assignedRecordsOnly|assignedOnly/.test(body),
        `${fn} lost its assignedRecordsOnly guard`,
      ).toBe(true);
    }
  });

  it("assignLeads writes audit before the lead update (audit-first)", () => {
    // Core logic moved into the shared server core (used by web + v1 API).
    const src = read("src/lib/leads/lead-assignment.server.ts");
    const auditIdx = src.indexOf('from("lead_assignment_audit")');
    const updateIdx = src.indexOf("assigned_at: data.assignedTo");
    expect(auditIdx).toBeGreaterThan(-1);
    expect(updateIdx).toBeGreaterThan(-1);
    expect(auditIdx).toBeLessThan(updateIdx);
  });
});

describe("lead_assigned notification event", () => {
  it("stays registered in the catalogue", () => {
    const def = (NOTIFICATION_EVENT_DEFS as any).lead_assigned;
    expect(def).toBeDefined();
    expect(def?.category).toBe("Leads");
  });
});
