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
  getCampaignAnalyticsData,
  getFinancialAnalyticsData,
  getAnalyticsSnapshotForExec,
} from "@/lib/analytics-hub/analytics-hub.server";
import { WBAH_WORKSPACE_ID } from "@/lib/wbah-exclusion.shared";
import { ensureAutomatedCampaignReportSchedule } from "@/lib/analytics-hub/report-schedule-setup.server";
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

  it("event report kinds (campaign start/end prefs) are never due in the sweep", () => {
    const base = { frequency: "custom", schedule_config_json: { intervalHours: 1 }, last_run_at: null };
    expect(isDue({ ...base, report_type: "wbah_campaign_start" }, new Date())).toBe(false);
    expect(isDue({ ...base, report_type: "wbah_campaign_end" }, new Date())).toBe(false);
    // sanity: same shape without an event kind IS due
    expect(isDue({ ...base, report_type: "wbah_dialler_summary" }, new Date())).toBe(true);
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

  it("campaign analytics returns a schedule array with the expected shape", async () => {
    const empty: any = await getCampaignAnalyticsData(WS, { dateFilter: "30d" });
    expect(empty.error).toBeNull();
    expect(Array.isArray(empty.schedule)).toBe(true);
    expect(empty.schedule.length).toBe(0);

    // Insert a scheduled (__sched_v1__) campaign and assert derived fields.
    const sb: any = supabaseAdmin;
    const cfg = {
      pageType: "leads", leadStatusFilter: null, callTime: "09:00",
      timezone: "Europe/London", callFrequency: "custom", intervalDays: 3,
      voicemailEnabled: false, lastRunDate: "2026-01-01",
    };
    const { data: row, error } = await sb.from("campaigns").insert({
      workspace_id: WS, name: "sched-e2e", status: "active",
      description: "__sched_v1__" + JSON.stringify(cfg),
    }).select("id").single();
    expect(error).toBeNull();
    try {
      const d: any = await getCampaignAnalyticsData(WS, { dateFilter: "30d" });
      expect(d.error).toBeNull();
      const s = d.schedule.find((x: any) => x.id === row.id);
      expect(s).toBeTruthy();
      expect(s.callTime).toBe("09:00");
      expect(s.frequency).toBe("every 3 days");
      expect(s.lastRunDate).toBe("2026-01-01");
      expect(s.ranToday).toBe(false);
      // last run long past + active → due to run today
      expect(s.runsToday).toBe(true);
    } finally {
      await sb.from("campaigns").delete().eq("id", row.id);
    }
  });

  it("WBAH campaign analytics returns the dialler report, never WEBEE campaigns", async () => {
    const d: any = await getCampaignAnalyticsData(WBAH_WORKSPACE_ID, { dateFilter: "7d" });
    expect(d.mode).toBe("wbah_dialler");
    expect(d.campaigns.length).toBe(0);
    expect(d.schedule.length).toBe(0);
    expect(d.error).toBeNull();
    const w = d.wbah;
    expect(w).toBeTruthy();
    expect(typeof w.total).toBe("number");
    expect(w.total).toBeGreaterThan(0);
    expect(w.sentiment.positive + w.sentiment.neutral + w.sentiment.negative + w.sentiment.unknown).toBe(w.total);
    expect(Array.isArray(w.reasons)).toBe(true);
    expect(w.voicemail).toBeGreaterThanOrEqual(0);
    for (const c of w.converted) expect(String(c.id)).toBeTruthy();
  });

  it("wbah_dialler_summary report generates for WBAH with dialler metrics", async () => {
    const id = await generateAnalyticsReport({
      workspaceId: WBAH_WORKSPACE_ID,
      reportType: "wbah_dialler_summary",
      dateFilter: "7d",
      generatedBy: "system",
    });
    expect(id).toBeTruthy();
    const { data: row } = await sb
      .from("analytics_reports")
      .select("metrics_json, report_summary, report_name")
      .eq("id", id)
      .maybeSingle();
    const m = row?.metrics_json ?? {};
    expect(m.wbah_dialler_error).toBeUndefined();
    expect(typeof m.calls_dialled).toBe("number");
    expect(m.calls_dialled).toBeGreaterThan(0);
    expect(typeof m.voicemail_hits).toBe("number");
    expect(row.report_summary).toContain("dialled");
    await sb.from("analytics_reports").delete().eq("id", id);
  });

  it("wbah_dialler_summary is refused for non-WBAH workspaces", async () => {
    const id = await generateAnalyticsReport({
      workspaceId: WS,
      reportType: "wbah_dialler_summary",
      dateFilter: "7d",
    });
    expect(id).toBeNull();
  });

  it("ensureAutomatedCampaignReportSchedule is idempotent and WBAH-aware", async () => {
    // Standard workspace → daily_campaign_summary, explicit recipients.
    const r1 = await ensureAutomatedCampaignReportSchedule(WS, {
      recipients: ["e2e-anhub@example.com"],
      createdByUserId: ownerUserId,
    });
    expect(r1.ok).toBe(true);
    expect(r1.created).toBe(true);
    expect(r1.reportType).toBe("daily_campaign_summary");
    const r2 = await ensureAutomatedCampaignReportSchedule(WS, {
      recipients: ["e2e-anhub@example.com"],
    });
    expect(r2.ok).toBe(true);
    expect(r2.created).toBe(false);
    expect(r2.scheduleId).toBe(r1.scheduleId);

    // WBAH → wbah_dialler_summary; live schedule already exists → reused, never duplicated.
    const rw = await ensureAutomatedCampaignReportSchedule(WBAH_WORKSPACE_ID, {});
    expect(rw.ok).toBe(true);
    expect(rw.created).toBe(false);
    expect(rw.reportType).toBe("wbah_dialler_summary");
    expect(rw.recipients.length).toBeGreaterThan(0);
  });
});
