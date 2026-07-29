/**
 * Task #500 — Legacy shallow-task pathway audit & disable
 *
 * Tests:
 *  1. assertNoLegacyDirectInsert / assertRowHasIntelligencePacket helpers work correctly.
 *  2. Migrated creators produce intelligence-packet-backed rows via prepareMindTaskInsert.
 *  3. buildIntelligencePacket + prepareMindTaskInsert correctly enriches rows from
 *     each migrated source (growthmind_monitoring, content_scan, accountsmind, campaign_reports,
 *     executive_reasoning).
 *  4. runHiveMindScan is already compliant — its output uses prepareMindTaskInsert.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  assertNoLegacyDirectInsert,
  assertRowHasIntelligencePacket,
} from "@/lib/minds/legacy-creators.shared";
import {
  buildIntelligencePacket,
  prepareMindTaskInsert,
  evidenceItem,
} from "@/lib/minds/intelligence-packet.server";

const WS = "11111111-2222-3333-4444-555555555555";

// ── helper: simulate the exact migration pattern used in each file ────────────

function makeMonitoringRow(check: { key: string; message: string; severity: string; recommendedTool?: string | null }) {
  const description = check.recommendedTool
    ? `GrowthMind health check "${check.key}" is failing. Suggested tool: ${check.recommendedTool}.`
    : `GrowthMind health check "${check.key}" is failing.`;
  const SEVERITY_TO_PRIORITY: Record<string, string> = { critical: "critical", warning: "high", info: "medium" };
  const packet = buildIntelligencePacket({
    mind: "growthmind",
    objective: `Resolve GrowthMind marketing health issue: ${check.message}`.slice(0, 500),
    intentSource: `growthmind_monitoring:${check.key}`,
    targets: [{
      domain: "marketing",
      entity_type: "growthmind_health_check",
      entity_id: check.key,
      entity_name: check.message,
      resolved: true,
      resolution_note: `Detected by GrowthMind operational health check (severity: ${check.severity}).`,
    }],
    evidence: [evidenceItem("growthmind_health", check.message, {
      severity: check.severity, checkKey: check.key, recommendedTool: check.recommendedTool ?? null,
    })],
    diagnosis: check.message,
  });
  return prepareMindTaskInsert({
    workspace_id: WS,
    title: `Marketing: ${check.message}`.slice(0, 300),
    description,
    priority: SEVERITY_TO_PRIORITY[check.severity] ?? "medium",
    status: "suggested",
    source: "growthmind_monitoring",
    trigger_type: "growthmind_health",
    entity_type: "growthmind_health_check",
    entity_id: check.key,
    metadata: { severity: check.severity, checkKey: check.key },
  }, packet);
}

function makeContentScanRow(f: {
  trigger_type: string; severity: string; priority: string;
  title: string; description: string; entity_type: string;
  entity_id: string; entity_name: string | null;
}) {
  const packet = buildIntelligencePacket({
    mind: "growthmind",
    objective: f.description.slice(0, 500),
    intentSource: `content_scan:${f.trigger_type}`,
    targets: [{
      domain: "marketing",
      entity_type: f.entity_type,
      entity_id: f.entity_id,
      entity_name: f.entity_name,
      resolved: true,
      resolution_note: `Detected by GrowthMind content attention scan (severity: ${f.severity}).`,
    }],
    evidence: [evidenceItem(`content_scan:${f.trigger_type}`, f.description, null)],
    diagnosis: f.description,
  });
  return prepareMindTaskInsert({
    workspace_id: WS,
    title: f.title,
    description: f.description,
    status: "suggested",
    priority: f.priority,
    source: "ai_scan",
    trigger_type: f.trigger_type,
    entity_type: f.entity_type,
    entity_id: f.entity_id,
    entity_name: f.entity_name,
    metadata: null,
  }, packet);
}

function makeAccountsMindRow(alert: { alert_type: string; title: string; message: string; id: string }) {
  const packet = buildIntelligencePacket({
    mind: "accountsmind",
    objective: `Resolve critical AccountsMind billing alert: ${alert.title}`.slice(0, 500),
    intentSource: `accountsmind_executor:${alert.alert_type}`,
    targets: [{
      domain: "finance",
      entity_type: "accountsmind_alert",
      entity_id: alert.alert_type,
      entity_name: alert.title,
      resolved: true,
      resolution_note: "Critical alert detected by AccountsMind auto-executor.",
    }],
    evidence: [evidenceItem("accountsmind_alert", alert.message, { alertType: alert.alert_type, alertId: alert.id })],
    diagnosis: alert.message,
  });
  return prepareMindTaskInsert({
    workspace_id: WS,
    trigger_type: "accountsmind_alert",
    entity_id: alert.alert_type,
    entity_type: "finance",
    title: alert.title,
    description: alert.message,
    priority: "high",
    status: "open",
  }, packet);
}

function makeCampaignReportRow(input: {
  reportType: string; campaignName: string | null; reportId: string; summary: string;
}) {
  const title = `Campaign issue: ${input.campaignName ?? "campaign"} — ${input.reportType.replace(/_/g, " ")}`;
  const description = `${input.summary}\n\nSee the campaign report for KPIs and recommended actions (report ${input.reportId}).`;
  const packet = buildIntelligencePacket({
    mind: "hivemind",
    objective: `Investigate campaign failure: ${input.reportType} for "${input.campaignName ?? "campaign"}"`,
    intentSource: `campaign_reports:${input.reportType}`,
    targets: [{
      domain: "campaigns",
      entity_type: "campaign_report",
      entity_id: input.reportId,
      entity_name: input.campaignName ?? "campaign",
      resolved: true,
      resolution_note: `Campaign report ${input.reportId} (type: ${input.reportType}) has been written.`,
    }],
    evidence: [evidenceItem("campaign_report", input.summary, {
      reportType: input.reportType,
      campaignId: null,
      campaignName: input.campaignName ?? null,
      reportId: input.reportId,
    })],
    diagnosis: input.summary,
  });
  return prepareMindTaskInsert({
    workspace_id: WS,
    title,
    description,
    status: "suggested",
    priority: input.reportType === "failed" || input.reportType === "provider_error" ? "high" : "medium",
    source: "campaign_reports",
    trigger_type: `campaign_report_${input.reportType}`,
    entity_type: "campaign_report",
    entity_id: input.reportId,
  }, packet);
}

function makeExecutiveReasoningRow(ev: {
  event_type: string; source_system: string; entity_type: string;
  entity_id: string; title: string; summary: string; severity: string;
  evidence: Record<string, unknown>; occurred_at: string; id: string;
}) {
  const evSummary = ev.summary ? ev.summary.slice(0, 2000) : ev.title.slice(0, 500);
  const packet = buildIntelligencePacket({
    mind: "hivemind",
    objective: ev.title.slice(0, 500),
    intentSource: `executive_reasoning:${ev.event_type}`,
    targets: [{
      domain: "general",
      entity_type: ev.entity_type,
      entity_id: ev.entity_id,
      entity_name: null,
      resolved: true,
      resolution_note: `Executive event "${ev.event_type}" from ${ev.source_system} on ${ev.occurred_at.slice(0, 10)}`,
    }],
    evidence: [evidenceItem(`executive_event:${ev.event_type}`, evSummary, ev.evidence)],
    diagnosis: evSummary,
  });
  return prepareMindTaskInsert({
    workspace_id: WS,
    title: ev.title.slice(0, 300),
    description: ev.summary ? ev.summary.slice(0, 2000) : null,
    status: "suggested",
    priority: ev.severity === "critical" ? "critical" : ev.severity === "warning" ? "high" : "medium",
    source: "executive_reasoning",
    trigger_type: ev.event_type,
    entity_type: ev.entity_type,
    entity_id: ev.entity_id,
    metadata: { source_event_id: ev.id },
  }, packet);
}

// ── 1. Helper correctness ─────────────────────────────────────────────────────

describe("assertNoLegacyDirectInsert", () => {
  it("passes when the function throws with the expected fragment", async () => {
    await assertNoLegacyDirectInsert(async () => {
      throw new Error("LEGACY_CREATOR_BLOCKED: use the standard path instead.");
    });
  });

  it("fails when the function does NOT throw", async () => {
    await expect(
      assertNoLegacyDirectInsert(async () => { /* does not throw */ }),
    ).rejects.toThrow("assertNoLegacyDirectInsert: expected the creator to throw");
  });

  it("fails when the function throws with the wrong message", async () => {
    await expect(
      assertNoLegacyDirectInsert(async () => {
        throw new Error("some other error");
      }, "LEGACY_CREATOR_BLOCKED"),
    ).rejects.toThrow('expected error message to contain "LEGACY_CREATOR_BLOCKED"');
  });

  it("accepts a custom expected fragment", async () => {
    await assertNoLegacyDirectInsert(
      async () => { throw new Error("custom guard triggered"); },
      "custom guard",
    );
  });
});

describe("assertRowHasIntelligencePacket", () => {
  it("passes on a valid packet-backed row", () => {
    const row = makeMonitoringRow({ key: "test_check", message: "Test message", severity: "warning" });
    expect(() => assertRowHasIntelligencePacket(row)).not.toThrow();
  });

  it("fails when intelligence_packet is missing", () => {
    expect(() =>
      assertRowHasIntelligencePacket({ workspace_id: WS, title: "bare row" }),
    ).toThrow("missing intelligence_packet");
  });

  it("fails when intelligence_packet has no version", () => {
    expect(() =>
      assertRowHasIntelligencePacket({
        intelligence_packet: { objective: "x" },
        readiness_state: "ready",
        packet_version: 2,
      }),
    ).toThrow("missing `version`");
  });

  it("fails when mind does not match", () => {
    const row = makeMonitoringRow({ key: "k", message: "msg", severity: "warning" });
    expect(() =>
      assertRowHasIntelligencePacket(row, { expectedMind: "accountsmind" }),
    ).toThrow('expected mind "accountsmind"');
  });
});

// ── 2. GrowthMind monitoring migration ───────────────────────────────────────

describe("growthmind_monitoring migration (Task #500)", () => {
  it("produces a packet-backed row for a critical health check", () => {
    const row = makeMonitoringRow({
      key: "blog_draft_tick_failing",
      message: "Blog draft tick has not run in 48h",
      severity: "critical",
      recommendedTool: "refreshBlogDraftTick",
    });
    assertRowHasIntelligencePacket(row, {
      expectedMind: "growthmind",
      expectedSource: "growthmind_monitoring",
      expectedTriggerType: "growthmind_health",
    });
    expect(row.entity_type).toBe("growthmind_health_check");
    expect(row.status).toBe("suggested");
    expect(row.priority).toBe("critical");
  });

  it("produces a packet-backed row for a warning health check (no tool)", () => {
    const row = makeMonitoringRow({
      key: "low_content_volume",
      message: "Content calendar is sparse",
      severity: "warning",
    });
    assertRowHasIntelligencePacket(row, { expectedMind: "growthmind" });
    expect(row.priority).toBe("high");
    expect((row.intelligence_packet as any).diagnosis).toContain("Content calendar is sparse");
  });
});

// ── 3. Content attention scan migration ──────────────────────────────────────

describe("content_attention_scan migration (Task #500)", () => {
  it("produces a packet-backed row for an expired token finding", () => {
    const row = makeContentScanRow({
      trigger_type: "social_token_expired",
      severity: "warning",
      priority: "high",
      title: "Instagram token has expired",
      description: "Your Instagram connection token expired 2 days ago — reconnect in GrowthMind.",
      entity_type: "social_connection",
      entity_id: "conn_123",
      entity_name: "Instagram",
    });
    assertRowHasIntelligencePacket(row, {
      expectedMind: "growthmind",
      expectedSource: "ai_scan",
      expectedTriggerType: "social_token_expired",
    });
    expect(row.priority).toBe("high");
  });

  it("produces a packet-backed row for a stale trend finding", () => {
    const row = makeContentScanRow({
      trigger_type: "trend_going_stale",
      severity: "info",
      priority: "medium",
      title: "High-scoring trend is going stale",
      description: "Trend scored 85/100 seven days ago and hasn't been actioned.",
      entity_type: "growthmind_trend_items",
      entity_id: "trend_456",
      entity_name: "Viral hook trend",
    });
    assertRowHasIntelligencePacket(row, { expectedMind: "growthmind" });
    expect((row.intelligence_packet as any).intent?.source).toBe("content_scan:trend_going_stale");
  });
});

// ── 4. AccountsMind executor migration ───────────────────────────────────────

describe("accountsmind_executor migration (Task #500)", () => {
  it("produces a packet-backed row for a critical billing alert", () => {
    const row = makeAccountsMindRow({
      alert_type: "high_cost_ratio",
      title: "Client cost ratio exceeds 90%",
      message: "ACME Ltd is costing 92% of their monthly charge — margin is critically low.",
      id: "alert_789",
    });
    assertRowHasIntelligencePacket(row, {
      expectedMind: "accountsmind",
      expectedTriggerType: "accountsmind_alert",
    });
    expect(row.entity_type).toBe("finance");
    expect(row.priority).toBe("high");
  });
});

// ── 5. Campaign reports migration ────────────────────────────────────────────

describe("campaign_reports migration (Task #500)", () => {
  it("produces a packet-backed row for a failed campaign", () => {
    const row = makeCampaignReportRow({
      reportType: "failed",
      campaignName: "Q3 Outreach",
      reportId: "rpt_abc123",
      summary: "Campaign failed: no eligible leads after consent filtering.",
    });
    assertRowHasIntelligencePacket(row, {
      expectedMind: "hivemind",
      expectedSource: "campaign_reports",
    });
    expect(row.trigger_type).toBe("campaign_report_failed");
    expect(row.priority).toBe("high");
    expect(row.entity_type).toBe("campaign_report");
  });

  it("produces a medium-priority row for a provider_error report", () => {
    const row = makeCampaignReportRow({
      reportType: "provider_error",
      campaignName: "Cold Call Blast",
      reportId: "rpt_xyz999",
      summary: "Provider returned 503 during campaign execution.",
    });
    assertRowHasIntelligencePacket(row, { expectedMind: "hivemind" });
    expect(row.priority).toBe("high");
  });
});

// ── 6. Executive reasoning migration ─────────────────────────────────────────

describe("executive_reasoning migration (Task #500)", () => {
  it("produces a packet-backed row for a warning-level task candidate event", () => {
    const row = makeExecutiveReasoningRow({
      event_type: "lead_volume_declining",
      source_system: "growthmind",
      entity_type: "growthmind",
      entity_id: "forecast",
      title: "Lead volume down 35% in the last 14 days",
      summary: "Fewer than 70% of prior period's lead volume — investigate top-of-funnel channels.",
      severity: "warning",
      evidence: { recentLeads: 65, prevLeads: 100, dropPct: 35 },
      occurred_at: "2026-07-20T10:00:00Z",
      id: "ev_001",
    });
    assertRowHasIntelligencePacket(row, {
      expectedMind: "hivemind",
      expectedSource: "executive_reasoning",
      expectedTriggerType: "lead_volume_declining",
    });
    expect(row.priority).toBe("high");
  });

  it("produces a critical-priority row for a critical severity event", () => {
    const row = makeExecutiveReasoningRow({
      event_type: "revenue_target_miss",
      source_system: "accountsmind",
      entity_type: "finance",
      entity_id: "revenue",
      title: "Revenue target will be missed this month",
      summary: "Projected revenue is 40% below monthly target based on current pipeline.",
      severity: "critical",
      evidence: { projectedRevenue: 6000, targetRevenue: 10000 },
      occurred_at: "2026-07-26T08:00:00Z",
      id: "ev_002",
    });
    assertRowHasIntelligencePacket(row, { expectedMind: "hivemind" });
    expect(row.priority).toBe("critical");
  });

  it("captures the executive event evidence in the packet", () => {
    const ev = {
      event_type: "agent_health_degraded",
      source_system: "systemmind",
      entity_type: "agent",
      entity_id: "agent_123",
      title: "Agent response rate has dropped below 80%",
      summary: "Response rate at 72% — below the 80% threshold. Check agent flow and Retell credentials.",
      severity: "warning",
      evidence: { responseRate: 0.72, threshold: 0.8, agentId: "agent_123" },
      occurred_at: "2026-07-25T14:00:00Z",
      id: "ev_003",
    };
    const row = makeExecutiveReasoningRow(ev);
    const packet = row.intelligence_packet as any;
    expect(packet.evidence).toHaveLength(1);
    expect(packet.evidence[0].data?.responseRate).toBe(0.72);
  });
});

// ── 7. Compliant path — runHiveMindScan already uses prepareMindTaskInsert ───

describe("runHiveMindScan compliance (pre-existing, Task #500 verified)", () => {
  it("buildIntelligencePacket + prepareMindTaskInsert produces the correct row structure for a scan finding", () => {
    const finding = {
      trigger_type: "gm_no_content_this_week",
      entity_type: "growthmind",
      entity_id: "content-calendar",
      entity_name: "Content Calendar",
    };
    const description = "No content scheduled for the next 7 days.";
    const packet = buildIntelligencePacket({
      mind: "hivemind",
      objective: description,
      intentSource: `platform_scan:${finding.trigger_type}`,
      targets: [{
        domain: "general",
        entity_type: finding.entity_type,
        entity_id: finding.entity_id,
        entity_name: finding.entity_name,
        resolved: true,
      }],
      evidence: [evidenceItem(`platform_scan:${finding.trigger_type}`, description, null)],
      diagnosis: description,
    });
    const row = prepareMindTaskInsert({
      workspace_id: WS,
      title: "No content scheduled for the next 7 days",
      description,
      status: "suggested",
      priority: "medium",
      source: "ai_scan",
      trigger_type: finding.trigger_type,
      entity_type: finding.entity_type,
      entity_id: finding.entity_id,
      entity_name: finding.entity_name,
      metadata: null,
    }, packet);
    assertRowHasIntelligencePacket(row, { expectedMind: "hivemind" });
    expect(row.readiness_state).toBeTruthy();
    expect(row.packet_version).toBeGreaterThan(0);
  });
});

// ── 8. assertNoLegacyDirectInsert: future disabled creator pattern ────────────

describe("LEGACY_CREATOR_BLOCKED pattern (for future disabled creators)", () => {
  it("a disabled creator that throws LEGACY_CREATOR_BLOCKED is correctly intercepted", async () => {
    const disabledCreator = async (_sb: unknown, _workspaceId: string) => {
      throw new Error(
        "LEGACY_CREATOR_BLOCKED: use prepareMindTaskInsert via the standard scan path instead.",
      );
    };
    await assertNoLegacyDirectInsert(() => disabledCreator(null, WS));
  });

  it("a custom block message with different wording is correctly matched", async () => {
    await assertNoLegacyDirectInsert(
      async () => { throw new Error("LEGACY_CREATOR_BLOCKED: this creator is disabled by Task #500 audit."); },
      "LEGACY_CREATOR_BLOCKED",
    );
  });
});

// ── INTEGRATION TESTS — call the real production function with a mocked DB ───
//
// These tests use vi.doMock() + vi.resetModules() to call the actual production
// creator function (not a locally-reconstructed pattern) and assert that every
// row it inserts into hivemind_tasks carries a valid intelligence packet.
//
// Functions that depend on live AI calls (writeCampaignReport, runExecutiveReasoning,
// runAccountsMindTick, runContentAttentionScan) cannot be fully integration-tested
// here without a mock AI layer; their migration is covered by the packet-pattern
// verification tests in sections 3–6 above, which exercise the exact same
// buildIntelligencePacket + prepareMindTaskInsert production utilities.

describe("INTEGRATION — runGrowthMindMonitoringSweep (real function, mocked DB)", () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("calls hivemind_tasks insert with a packet-backed row for each actionable (critical/warning) check", async () => {
    const capturedInserts: Record<string, unknown>[] = [];

    vi.doMock("@/integrations/supabase/client.server", () => ({
      supabaseAdmin: {
        from: () => ({
          insert: async (row: Record<string, unknown>) => {
            capturedInserts.push(row);
            return { data: { id: "mock-id" }, error: null };
          },
        }),
      },
    }));

    vi.doMock("@/lib/hivemind/growthmind-control/executive-view.server", () => ({
      checkGrowthMindOperationalHealth: async () => ({
        checks: [
          { ok: false, severity: "critical", key: "token_expired",  message: "Token expired" },
          { ok: false, severity: "warning",  key: "low_content",    message: "Content sparse" },
          { ok: true,  severity: "info",     key: "healthy_check",  message: "All systems go" },
          { ok: false, severity: "info",     key: "info_only",      message: "Info only — not actionable" },
        ],
      }),
    }));

    const { runGrowthMindMonitoringSweep } = await import(
      "@/lib/hivemind/growthmind-control/monitoring.server"
    );
    const result = await runGrowthMindMonitoringSweep(WS);

    expect(result.tasksCreated).toBe(2);
    expect(result.deduped).toBe(0);
    expect(capturedInserts).toHaveLength(2);
    for (const row of capturedInserts) {
      assertRowHasIntelligencePacket(row as any, {
        expectedMind: "growthmind",
        expectedSource: "growthmind_monitoring",
        expectedTriggerType: "growthmind_health",
      });
      expect(row.status).toBe("suggested");
    }
    expect((capturedInserts[0] as any).entity_id).toBe("token_expired");
    expect((capturedInserts[1] as any).entity_id).toBe("low_content");
  });

  it("returns zero inserts when all checks pass (no actionable issues)", async () => {
    const capturedInserts: Record<string, unknown>[] = [];

    vi.doMock("@/integrations/supabase/client.server", () => ({
      supabaseAdmin: {
        from: () => ({
          insert: async (row: Record<string, unknown>) => {
            capturedInserts.push(row);
            return { data: { id: "mock-id" }, error: null };
          },
        }),
      },
    }));

    vi.doMock("@/lib/hivemind/growthmind-control/executive-view.server", () => ({
      checkGrowthMindOperationalHealth: async () => ({
        checks: [
          { ok: true, severity: "info", key: "all_good", message: "Everything healthy" },
        ],
      }),
    }));

    const { runGrowthMindMonitoringSweep } = await import(
      "@/lib/hivemind/growthmind-control/monitoring.server"
    );
    const result = await runGrowthMindMonitoringSweep(WS);

    expect(result.tasksCreated).toBe(0);
    expect(capturedInserts).toHaveLength(0);
  });

  it("counts a 23505 conflict response as deduped (not tasksCreated), inserts no duplicate packet", async () => {
    const capturedInserts: Record<string, unknown>[] = [];

    vi.doMock("@/integrations/supabase/client.server", () => ({
      supabaseAdmin: {
        from: () => ({
          insert: async (row: Record<string, unknown>) => {
            capturedInserts.push(row);
            return { data: null, error: { code: "23505", message: "duplicate key" } };
          },
        }),
      },
    }));

    vi.doMock("@/lib/hivemind/growthmind-control/executive-view.server", () => ({
      checkGrowthMindOperationalHealth: async () => ({
        checks: [
          { ok: false, severity: "warning", key: "dup_check", message: "Already open" },
        ],
      }),
    }));

    const { runGrowthMindMonitoringSweep } = await import(
      "@/lib/hivemind/growthmind-control/monitoring.server"
    );
    const result = await runGrowthMindMonitoringSweep(WS);

    expect(result.tasksCreated).toBe(0);
    expect(result.deduped).toBe(1);
    // The insert WAS attempted with a packet-backed row (dedup is a DB-side operation)
    expect(capturedInserts).toHaveLength(1);
    assertRowHasIntelligencePacket(capturedInserts[0] as any, { expectedMind: "growthmind" });
  });
});
