/**
 * E2E tests for workspace People Views + Campaign Filters.
 *
 * Runs against the REAL shared Supabase database (service role) using a
 * throw-away random workspace id, and cleans up everything it creates.
 *
 * Run: npx vitest run --config vitest.e2e.config.ts tests/e2e/people-views.e2e.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  validateFilterConfig,
  runFilterDryRun,
  DEFAULT_SAFETY,
} from "@/lib/people-views/filter-engine.server";
import {
  createPeopleView,
  updatePeopleView,
  duplicatePeopleView,
  listPeopleViews,
  listVersions,
  rollbackObject,
  createCampaignFilter,
  convertViewToCampaignFilter,
  dryRunAndRecord,
  runPeopleView,
} from "@/lib/people-views/people-views.server";

const sb = supabaseAdmin as any;
const WS = randomUUID();

const FILTER = {
  logic: "and" as const,
  conditions: [{ field: "lead_status", operator: "equals", value: "need_to_call" }],
};

beforeAll(async () => {
  // leads has a real FK to workspaces — create a throw-away workspace fixture
  const { data: anyWs, error: e0 } = await sb.from("workspaces").select("owner_id").limit(1).single();
  if (e0) throw new Error(e0.message);
  const { error } = await sb.from("workspaces").insert({
    id: WS,
    name: "E2E people-views test (safe to delete)",
    slug: `e2e-people-views-${WS.slice(0, 8)}`,
    owner_id: anyWs.owner_id,
  });
  if (error) throw new Error(error.message);
});

afterAll(async () => {
  await sb.from("workspace_view_audit_logs").delete().eq("workspace_id", WS);
  await sb.from("workspace_campaign_filters").delete().eq("workspace_id", WS);
  await sb.from("workspace_people_views").delete().eq("workspace_id", WS);
  await sb.from("leads").delete().eq("workspace_id", WS);
  await sb.from("workspaces").delete().eq("id", WS);
});

describe("filter engine", () => {
  it("accepts valid configs and rejects unknown fields", () => {
    expect(validateFilterConfig(FILTER).ok).toBe(true);
    const bad = validateFilterConfig({
      logic: "and",
      conditions: [{ field: "not_a_field", operator: "equals", value: "x" }],
    });
    expect(bad.ok).toBe(false);
    expect(bad.unknownFields).toContain("not_a_field");
    // meta.* custom fields are allowed
    const custom = validateFilterConfig({
      logic: "and",
      conditions: [{ field: "meta.industry", operator: "equals", value: "dental" }],
    });
    expect(custom.ok).toBe(true);
  });

  it("rejects invalid operators", () => {
    const bad = validateFilterConfig({
      logic: "and",
      conditions: [{ field: "lead_status", operator: "explode", value: "x" }],
    });
    expect(bad.ok).toBe(false);
  });

  it("dry-run returns counts against the real leads table", async () => {
    // seed 3 leads: 2 matching, 1 do_not_call (safety-excluded)
    const rows = [
      { workspace_id: WS, full_name: "A", phone: "+441111111111", status: "need_to_call", source: "import", source_detail: "e2e-seed" },
      { workspace_id: WS, full_name: "B", phone: "+442222222222", status: "need_to_call", source: "import", source_detail: "e2e-seed" },
      { workspace_id: WS, full_name: "C", phone: "+443333333333", status: "do_not_call", source: "import", source_detail: "e2e-seed" },
    ];
    const { error } = await sb.from("leads").insert(rows);
    expect(error).toBeNull();

    const res = await runFilterDryRun(sb, WS, FILTER, { mode: "view" });
    expect(res.totalMatching).toBe(2);
    expect(res.sample.length).toBeGreaterThan(0);

    // campaign mode excludes the do_not_call row via safety exclusions even
    // when the filter itself matches do_not_call
    const dncFilter = { logic: "and", conditions: [{ field: "lead_status", operator: "in_list", value: ["need_to_call", "do_not_call"] }] };
    const camp = await runFilterDryRun(sb, WS, dncFilter, { mode: "campaign", safety: DEFAULT_SAFETY });
    expect(camp.totalMatching).toBe(2);
    expect(camp.exclusionBreakdown.do_not_contact).toBe(1);
  });

  it("not_in_list is safe against hostile values (quotes, commas, parens)", async () => {
    const hostile = {
      logic: "and",
      conditions: [{
        field: "source_detail",
        operator: "not_in_list",
        value: ['weird"quote', "with,comma", "paren)break", 'back\\slash'],
      }],
    };
    // should not throw, and still matches all 3 seeded rows (source_detail=e2e-seed)
    const res = await runFilterDryRun(sb, WS, hostile, { mode: "view" });
    expect(res.totalMatching).toBe(3);
    // and excluding the real value works
    const res2 = await runFilterDryRun(sb, WS, {
      logic: "and",
      conditions: [{ field: "source_detail", operator: "not_in_list", value: ["e2e-seed", 'x"y'] }],
    }, { mode: "view" });
    expect(res2.totalMatching).toBe(0);
  });
});

describe("people views CRUD + versioning", () => {
  let viewId: string;

  it("member can create a draft but cannot activate", async () => {
    const v = await createPeopleView({
      workspaceId: WS, userId: null, role: "member",
      name: "E2E Booked", filterConfig: FILTER,
    });
    expect(v.status).toBe("draft");
    viewId = v.id;
    await expect(
      updatePeopleView({ workspaceId: WS, userId: null, role: "member", id: viewId, patch: { status: "active" } }),
    ).rejects.toThrow(/permission|allow|admin|owner|role/i);
  });

  it("admin can activate; update bumps version and keeps lineage", async () => {
    const activated = await updatePeopleView({
      workspaceId: WS, userId: null, role: "admin", id: viewId, patch: { status: "active" },
    });
    expect(activated.status).toBe("active");
    const v1 = activated.version;

    const updated = await updatePeopleView({
      workspaceId: WS, userId: null, role: "admin", id: viewId,
      patch: { filterConfig: { logic: "and", conditions: [{ field: "lead_status", operator: "equals", value: "qualified" }] } },
    });
    expect(updated.version).toBe(v1 + 1);

    const versions = await listVersions("people_view", WS, viewId);
    expect(versions.length).toBeGreaterThanOrEqual(1);

    // rollback to prior version restores the old filter
    const rolled = await rollbackObject({
      objectType: "people_view", workspaceId: WS, userId: null, role: "admin",
      id: viewId, versionId: versions[0].id,
    });
    expect(JSON.stringify(rolled.filter_config)).toContain("need_to_call");
  });

  it("duplicate name is refused; duplicate() creates a draft copy", async () => {
    await expect(
      createPeopleView({ workspaceId: WS, userId: null, role: "admin", name: "E2E Booked", filterConfig: FILTER, status: "active" }),
    ).rejects.toThrow(/already exists/i);

    const copy = await duplicatePeopleView({ workspaceId: WS, userId: null, role: "member", id: viewId });
    expect(copy.status).toBe("draft");
    expect(copy.name).not.toBe("E2E Booked");
  });

  it("runPeopleView returns matching rows only for this workspace", async () => {
    const res = await runPeopleView(WS, viewId, 50);
    expect(res.rows.every((r: any) => r.status === "need_to_call")).toBe(true);
    expect(res.rows.length).toBe(2);
  });

  it("dryRunAndRecord persists last_dry_run on the row + audit log", async () => {
    await dryRunAndRecord({ objectType: "people_view", workspaceId: WS, userId: null, id: viewId, filterConfig: FILTER });
    const { data } = await sb.from("workspace_people_views").select("last_dry_run, last_dry_run_at").eq("id", viewId).single();
    expect(data.last_dry_run.totalMatching).toBe(2);
    const { count } = await sb.from("workspace_view_audit_logs")
      .select("id", { count: "exact", head: true }).eq("workspace_id", WS);
    expect(count).toBeGreaterThan(0);
  });

  it("convertViewToCampaignFilter creates a linked draft filter", async () => {
    const f = await convertViewToCampaignFilter({ workspaceId: WS, userId: null, role: "admin", viewId });
    expect(f.status).toBe("draft");
    expect(f.name).toContain("campaign filter");
    // link is recorded in the audit trail
    const { data: audit } = await sb.from("workspace_view_audit_logs")
      .select("action_type, before_state").eq("workspace_id", WS)
      .eq("action_type", "convert_from_view").limit(1).single();
    expect(audit.before_state.viewId).toBe(viewId);
  });

  it("visible_to_roles gates list + run; sort_config is respected", async () => {
    // restrict the view to admins/owners only
    await sb.from("workspace_people_views")
      .update({ visible_to_roles: ["owner", "admin"], sort_config: { field: "full_name", direction: "asc" } })
      .eq("id", viewId);
    const memberList = await listPeopleViews(WS, false, "member");
    expect(memberList.find((v: any) => v.id === viewId)).toBeUndefined();
    await expect(runPeopleView(WS, viewId, 50, "member")).rejects.toThrow(/not visible/i);

    const adminRun = await runPeopleView(WS, viewId, 50, "admin");
    expect(adminRun.rows.map((r: any) => r.full_name)).toEqual(["A", "B"]);

    // restore
    await sb.from("workspace_people_views")
      .update({ visible_to_roles: ["owner", "admin", "member"], sort_config: {} })
      .eq("id", viewId);
  });

  it("lists are workspace-scoped", async () => {
    const other = await listPeopleViews(randomUUID());
    expect(other.length).toBe(0);
  });
});

describe("campaign filters", () => {
  it("create rejects invalid filter configs", async () => {
    await expect(
      createCampaignFilter({
        workspaceId: WS, userId: null, role: "admin", name: "Bad",
        filterConfig: { logic: "and", conditions: [{ field: "nope", operator: "equals", value: 1 }] },
      }),
    ).rejects.toThrow(/invalid|unknown/i);
  });
});
