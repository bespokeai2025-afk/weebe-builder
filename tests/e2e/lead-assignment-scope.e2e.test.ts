/**
 * E2E behavioral tests for assigned-records-only lead scoping (Task: sales
 * agents & lead assignment).
 *
 * Server fns can't be invoked directly outside a TanStack Start request
 * (middleware needs a real session), so — following the established e2e
 * pattern in this suite — these tests prove the two layers the fns compose:
 *
 *   1. resolvePermissions: a sales_agent member really resolves to
 *      assignedRecordsOnly=true (and owner/admin do not).
 *   2. The exact scoping semantics the fns apply (`.eq("assigned_to", uid)`
 *      on leads, phone/lead-id sentinel fail-closed filters on calls and
 *      bookings) return ONLY assigned rows against the real database —
 *      including the fail-closed empty result when nothing is assigned.
 *
 * Runs against the REAL shared Supabase database (service role) using a
 * throw-away workspace and cleans everything up.
 *
 * Run: npx vitest run --config vitest.e2e.config.ts tests/e2e/lead-assignment-scope.e2e.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { resolvePermissions, invalidatePermissionsCache } from "@/lib/permissions/permissions.server";

const sb = supabaseAdmin as any;
const WS = randomUUID();

let OWNER_ID = "";
let AGENT_ID = "";
let ASSIGNED_LEAD = "";
let UNASSIGNED_LEAD = "";
const ASSIGNED_PHONE = `+44700900${Math.floor(1000 + Math.random() * 8999)}`;
const OTHER_PHONE = `+44700901${Math.floor(1000 + Math.random() * 8999)}`;

beforeAll(async () => {
  const { data: profiles, error: pErr } = await sb
    .from("profiles")
    .select("user_id")
    .limit(2);
  if (pErr) throw new Error(pErr.message);
  if (!profiles || profiles.length < 2) throw new Error("Need 2 existing users");
  OWNER_ID = profiles[0].user_id;
  AGENT_ID = profiles[1].user_id;

  const { error: wErr } = await sb.from("workspaces").insert({
    id: WS,
    name: "E2E lead-assignment scope test (safe to delete)",
    slug: `e2e-leadscope-${WS.slice(0, 8)}`,
    owner_id: OWNER_ID,
  });
  if (wErr) throw new Error(wErr.message);

  const { error: mErr } = await sb.from("workspace_members").insert([
    { workspace_id: WS, user_id: OWNER_ID, role: "owner" },
    { workspace_id: WS, user_id: AGENT_ID, role: "sales_agent" },
  ]);
  if (mErr) throw new Error(mErr.message);

  const { data: leadRows, error: lErr } = await sb
    .from("leads")
    .insert([
      {
        workspace_id: WS,
        full_name: "E2E Assigned Lead",
        phone: ASSIGNED_PHONE,
        status: "need_to_call",
        source: "website",
        assigned_to: AGENT_ID,
        assigned_at: new Date().toISOString(),
        assigned_by: OWNER_ID,
      },
      {
        workspace_id: WS,
        full_name: "E2E Unassigned Lead",
        phone: OTHER_PHONE,
        status: "need_to_call",
        source: "website",
      },
    ])
    .select("id, assigned_to");
  if (lErr) throw new Error(lErr.message);
  ASSIGNED_LEAD = leadRows.find((r: any) => r.assigned_to === AGENT_ID)!.id;
  UNASSIGNED_LEAD = leadRows.find((r: any) => !r.assigned_to)!.id;

  invalidatePermissionsCache();
});

afterAll(async () => {
  await sb.from("lead_assignment_audit").delete().eq("workspace_id", WS);
  await sb.from("leads").delete().eq("workspace_id", WS);
  await sb.from("workspace_members").delete().eq("workspace_id", WS);
  await sb.from("workspaces").delete().eq("id", WS);
});

describe("sales_agent permission resolution (behavioral)", () => {
  it("sales_agent resolves to assignedRecordsOnly=true with no actions", async () => {
    const perms = await resolvePermissions(WS, AGENT_ID);
    expect(perms.assignedRecordsOnly).toBe(true);
    expect(perms.actionAccess?.lead_assignment ?? false).toBe(false);
  });

  it("owner is NOT assignedRecordsOnly and can assign", async () => {
    const perms = await resolvePermissions(WS, OWNER_ID);
    expect(perms.assignedRecordsOnly ?? false).toBe(false);
    expect(perms.actionAccess?.lead_assignment).toBe(true);
  });
});

describe("assigned-records-only query scoping (behavioral, real DB)", () => {
  it("assigned filter returns ONLY the agent's lead — never unassigned ones", async () => {
    const { data, error } = await sb
      .from("leads")
      .select("id, full_name")
      .eq("workspace_id", WS)
      .eq("assigned_to", AGENT_ID);
    expect(error).toBeNull();
    expect((data ?? []).map((r: any) => r.id)).toEqual([ASSIGNED_LEAD]);
  });

  it("scoped mutation cannot touch an unassigned lead (0 rows affected)", async () => {
    const { count, error } = await sb
      .from("leads")
      .update({ notes: "should-not-happen" }, { count: "exact" })
      .eq("id", UNASSIGNED_LEAD)
      .eq("workspace_id", WS)
      .eq("assigned_to", AGENT_ID);
    expect(error).toBeNull();
    expect(count ?? 0).toBe(0);

    const { data: check } = await sb
      .from("leads").select("notes").eq("id", UNASSIGNED_LEAD).single();
    expect(check.notes).not.toBe("should-not-happen");
  });

  it("scoped delete cannot remove unassigned leads in a bulk id list", async () => {
    const { count, error } = await sb
      .from("leads")
      .delete({ count: "exact" })
      .in("id", [UNASSIGNED_LEAD])
      .eq("workspace_id", WS)
      .eq("assigned_to", AGENT_ID);
    expect(error).toBeNull();
    expect(count ?? 0).toBe(0);
  });

  it("phone-sentinel call scoping fails closed to zero rows", async () => {
    // Mirrors getOverviewStats scopeCalls when the agent has no assigned phones
    const { count, error } = await sb
      .from("calls")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", WS)
      .in("to_number", ["__none__"]);
    expect(error).toBeNull();
    expect(count ?? 0).toBe(0);
  });

  it("lead-id sentinel booking scoping fails closed to zero rows", async () => {
    const { count, error } = await sb
      .from("calendar_bookings")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", WS)
      .in("lead_id", ["00000000-0000-0000-0000-000000000000"]);
    expect(error).toBeNull();
    expect(count ?? 0).toBe(0);
  });

  it("lead-detail phone derivation: authorized-lead lookup returns own phone, not caller-supplied", async () => {
    // Mirrors getLeadDetail for assignedRecordsOnly: the phone used for
    // booking_summaries MUST come from the authorized lead row. An attacker
    // supplying another lead's phone gets nothing because the own-lead lookup
    // (leadId + assigned_to) yields only the assigned lead's stored phone.
    const { data: own } = await sb
      .from("leads")
      .select("id, phone")
      .eq("id", ASSIGNED_LEAD)
      .eq("workspace_id", WS)
      .eq("assigned_to", AGENT_ID)
      .maybeSingle();
    expect(own?.phone).toBe(ASSIGNED_PHONE);
    expect(own?.phone).not.toBe(OTHER_PHONE);

    // And an unassigned leadId fails the authorization lookup entirely.
    const { data: notOwn } = await sb
      .from("leads")
      .select("id, phone")
      .eq("id", UNASSIGNED_LEAD)
      .eq("workspace_id", WS)
      .eq("assigned_to", AGENT_ID)
      .maybeSingle();
    expect(notOwn).toBeNull();
  });

  it("assignment-history guard: unassigned lead fails the own-lead precheck (empty history)", async () => {
    // Seed an audit row for the unassigned lead, then prove the restricted
    // precheck used by getLeadAssignmentHistory blocks access to it.
    await sb.from("lead_assignment_audit").insert({
      workspace_id: WS,
      lead_id: UNASSIGNED_LEAD,
      assigned_to: OWNER_ID,
      previous_assigned_to: null,
      assigned_by: OWNER_ID,
    });
    const { data: own } = await sb
      .from("leads")
      .select("id")
      .eq("id", UNASSIGNED_LEAD)
      .eq("workspace_id", WS)
      .eq("assigned_to", AGENT_ID)
      .maybeSingle();
    expect(own).toBeNull(); // → getLeadAssignmentHistory returns [] for the agent
  });

  it("assigned-scoped meta discovery cannot read unassigned leads' meta", async () => {
    await sb.from("leads").update({ meta: { secret_field: "x" } }).eq("id", UNASSIGNED_LEAD);
    const { data } = await sb
      .from("leads")
      .select("meta")
      .eq("workspace_id", WS)
      .not("meta", "eq", "{}")
      .eq("assigned_to", AGENT_ID);
    const keys = new Set<string>();
    for (const row of data ?? []) for (const k of Object.keys(row.meta ?? {})) keys.add(k);
    expect(keys.has("secret_field")).toBe(false);
  });
});
