/**
 * E2E tests for the Analytics Hub (BI + reporting upgrade).
 *
 * Covers: report generation/storage, WBAH campaign-lifecycle isolation,
 * lifecycle-type mapping, feature gating on report emails, schedule due
 * logic, and analytics aggregation fail-closed behaviour.
 *
 * Runs against the REAL shared Supabase database (service role) using a
 * throw-away random workspace, and cleans up everything.
 *
 * Run: npx vitest run --config vitest.e2e.config.ts tests/e2e/analytics-hub.e2e.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  generateAnalyticsReport,
  campaignLifecycleToAnalyticsType,
  isCampaignLifecycleReportType,
  resolveReportDateRange,
} from "@/lib/analytics-hub/report-generator.server";
import { sendAnalyticsReportEmail } from "@/lib/analytics-hub/report-email.server";
import { isDue, processAnalyticsReportSchedules } from "@/lib/analytics-hub/report-schedule-tick";
import {
  getAnalyticsOverviewData,
  getFinancialAnalyticsData,
  getAnalyticsSnapshotForExec,
} from "@/lib/analytics-hub/analytics-hub.server";
import { WBAH_WORKSPACE_ID } from "@/lib/wbah-exclusion.shared";
import { invalidateEntitlementsCache } from "@/lib/packages/entitlements.server";

const sb = supabaseAdmin as any;
const WS = randomUUID();
let ownerUserId: string;

beforeAll(async () => {
  const { data: profiles } = await sb.from("profiles").select("user_id").limit(1);
  if (!profiles?.length) throw new Error("Need an existing user");
  ownerUserId = profiles[0].user_id;
  const { error } = await sb.from("workspaces").insert({
    id: WS,
    name: "E2E analytics-hub ws (safe to delete)",
    slug: `e2e-anhub-${WS.slice(0, 8)}`,
    owner_id: ownerUserId,
  });
  if (error) throw new Error(error.message);
  await sb.from("workspace_members").insert({ workspace_id: WS, user_id: ownerUserId, role: "owner" });
});

afterAll(async () => {
  await sb.from("analytics_report_schedules").delete().eq("workspace_id", WS);
  await sb.from("analytics_reports").delete().eq("workspace_id", WS);
  await sb.from("workspace_subscriptions").delete().eq("workspace_id", WS);
  await sb.from("workspace_access_audit_logs").delete().eq("workspace_id", WS);
  await sb.from("workspace_members").delete().eq("workspace_id", WS);
  await sb.from("workspaces").delete().eq("id", WS);
  invalidateEntitlementsCache();
});

describe("report generation + storage", () => {
  it("generates and stores a weekly_workspace report row", async () => {
    const id = await generateAnalyticsReport({
      workspaceId: WS,
      reportType: "weekly_workspace",
      dateFilter: "7d",
      generatedBy: "user",
      createdByUserId: ownerUserId,
    });
    expect(id).toBeTruthy();
    const { data: row } = await sb.from("analytics_reports").select("*").eq("id", id).maybeSingle();
    expect(row).toBeTruthy();
    expect(row.workspace_id).toBe(WS);
    expect(row.report_type).toBe("weekly_workspace");
    expect(row.report_status).toBe("generated");
    expect(row.report_summary).toBeTruthy();
    expect(row.date_range_start).toBeTruthy();
    expect(row.date_range_end).toBeTruthy();
  });

  it("never throws on a bogus workspace and returns a row or null", async () => {
    // Non-existent workspace: aggregations return zeroed structures; must not throw.
    await expect(
      generateAnalyticsReport({ workspaceId: randomUUID(), reportType: "monthly_roi" }),
    ).resolves.toBeDefined();
  });

  it("refuses campaign-lifecycle report kinds for the WBAH workspace", async () => {
    const id = await generateAnalyticsReport({
      workspaceId: WBAH_WORKSPACE_ID,
      reportType: "campaign_launch",
    });
    expect(id).toBeNull();
    const { count } = await sb
      .from("analytics_reports")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", WBAH_WORKSPACE_ID)
      .eq("report_type", "campaign_launch");
    expect(count ?? 0).toBe(0);
  });

  it("maps campaign lifecycle types → analytics report types", () => {
    expect(campaignLifecycleToAnalyticsType("activated")).toBe("campaign_launch");
    expect(campaignLifecycleToAnalyticsType("completed")).toBe("campaign_completion");
    expect(campaignLifecycleToAnalyticsType("failed")).toBe("campaign_failure");
    expect(isCampaignLifecycleReportType("campaign_kpi")).toBe(true);
    expect(isCampaignLifecycleReportType("weekly_workspace")).toBe(false);
  });

  it("resolveReportDateRange produces a sane window", () => {
    const { startIso, endIso } = resolveReportDateRange("7d");
    expect(new Date(startIso).getTime()).toBeLessThan(new Date(endIso).getTime());
    const days = (new Date(endIso).getTime() - new Date(startIso).getTime()) / 86400000;
    expect(days).toBeGreaterThanOrEqual(6);
    expect(days).toBeLessThanOrEqual(8);
  });
});

describe("report email gating (provider priority entry gate)", () => {
  it("blocks sending when the package lacks automated_report_emails", async () => {
    // Fresh workspace has no subscription → trial baseline without automated_report_emails.
    invalidateEntitlementsCache();
    const id = await generateAnalyticsReport({ workspaceId: WS, reportType: "agent_performance" });
    expect(id).toBeTruthy();
    const res = await sendAnalyticsReportEmail(id!, ["e2e-nobody@example.invalid"], {
      actingUserId: ownerUserId,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("feature_locked");
    expect(res.sent).toBe(0);
  });

  it("returns report_not_found for a missing report and never throws", async () => {
    const res = await sendAnalyticsReportEmail(randomUUID(), ["x@example.invalid"]);
    expect(res.ok).toBe(false);
    expect(res.error).toBe("report_not_found");
  });
});

describe("schedule due logic", () => {
  const at = (iso: string) => new Date(iso);

  it("daily: due once per UTC day at/after configured hour", () => {
    const s = { frequency: "daily", schedule_config_json: { hour: 8 }, last_run_at: null };
    expect(isDue(s, at("2026-07-16T07:59:00Z"))).toBe(false);
    expect(isDue(s, at("2026-07-16T08:01:00Z"))).toBe(true);
    const ran = { ...s, last_run_at: "2026-07-16T08:05:00Z" };
    expect(isDue(ran, at("2026-07-16T15:00:00Z"))).toBe(false);
    expect(isDue(ran, at("2026-07-17T09:00:00Z"))).toBe(true);
  });

  it("weekly: only on configured day-of-week", () => {
    // 2026-07-16 is a Thursday (4); Monday default is 1.
    const s = { frequency: "weekly", schedule_config_json: { dayOfWeek: 4, hour: 6 }, last_run_at: null };
    expect(isDue(s, at("2026-07-16T07:00:00Z"))).toBe(true);
    expect(isDue(s, at("2026-07-15T07:00:00Z"))).toBe(false);
    expect(isDue({ ...s, last_run_at: "2026-07-16T06:30:00Z" }, at("2026-07-16T09:00:00Z"))).toBe(false);
  });

  it("monthly: only on configured day-of-month", () => {
    const s = { frequency: "monthly", schedule_config_json: { dayOfMonth: 16, hour: 5 }, last_run_at: null };
    expect(isDue(s, at("2026-07-16T05:30:00Z"))).toBe(true);
    expect(isDue(s, at("2026-07-17T05:30:00Z"))).toBe(false);
  });

  it("custom: interval hours since last run", () => {
    const s = { frequency: "custom", schedule_config_json: { intervalHours: 6 }, last_run_at: null };
    expect(isDue(s, at("2026-07-16T00:00:00Z"))).toBe(true);
    const ran = { ...s, last_run_at: "2026-07-16T00:00:00Z" };
    expect(isDue(ran, at("2026-07-16T05:00:00Z"))).toBe(false);
    expect(isDue(ran, at("2026-07-16T06:01:00Z"))).toBe(true);
  });

  it("unknown frequency is never due", () => {
    expect(isDue({ frequency: "hourly", schedule_config_json: {} }, new Date())).toBe(false);
  });

  it("tick claims a due schedule (sets last_run_at) and never double-runs it", async () => {
    const { data: sched, error } = await sb
      .from("analytics_report_schedules")
      .insert({
        workspace_id: WS,
        name: "E2E custom schedule",
        report_type: "weekly_workspace",
        frequency: "custom",
        schedule_config_json: { intervalHours: 6 },
        recipients_json: [],
        enabled: true,
        created_by_user_id: ownerUserId,
      })
      .select("id")
      .maybeSingle();
    expect(error).toBeNull();

    const first = await processAnalyticsReportSchedules();
    expect(first.scanned).toBeGreaterThanOrEqual(1);

    const { data: after } = await sb
      .from("analytics_report_schedules")
      .select("last_run_at")
      .eq("id", sched.id)
      .maybeSingle();
    expect(after?.last_run_at).toBeTruthy();

    // Second tick: not due again (interval not elapsed) → last_run_at unchanged.
    await processAnalyticsReportSchedules();
    const { data: again } = await sb
      .from("analytics_report_schedules")
      .select("last_run_at")
      .eq("id", sched.id)
      .maybeSingle();
    expect(again?.last_run_at).toBe(after?.last_run_at);

    // Only one report row was generated for this schedule run.
    const { count } = await sb
      .from("analytics_reports")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", WS)
      .eq("report_type", "weekly_workspace")
      .eq("generated_by", "system");
    expect(count).toBe(1);
  });
});

describe("analytics aggregations (fail-closed, workspace-scoped)", () => {
  it("overview returns a zeroed structure for an empty workspace without throwing", async () => {
    const d: any = await getAnalyticsOverviewData(WS, { dateFilter: "30d" });
    expect(d).toBeTruthy();
    expect(Number(d.calls?.total ?? 0)).toBe(0);
    expect(Number(d.leads?.total ?? 0)).toBe(0);
  });

  it("financial returns a structure for an empty workspace", async () => {
    const d: any = await getFinancialAnalyticsData(WS, { dateFilter: "30d" });
    expect(d).toBeTruthy();
  });

  it("exec snapshot never throws", async () => {
    const snap: any = await getAnalyticsSnapshotForExec(WS);
    expect(snap).toBeTruthy();
  });
});
