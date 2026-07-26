/**
 * Task #488 — acceptance tests for the channel work-order server cores.
 *
 * These exercise the real cores (createSalesPipelineWorkOrderCore etc.)
 * against a fake Supabase builder, with the mode gate and deliverability
 * service mocked. The intelligence-packet builder/validator run for real,
 * so readiness states here are the genuine quality-gate outputs.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/hivemind/mode-gate.server", () => ({
  assertProposalAllowed: vi.fn(async () => undefined),
}));

const deliverabilityMock = vi.hoisted(() => ({
  getEmailReadinessForWorkspace: vi.fn(async () => null as any),
}));
vi.mock("@/lib/hexmail/deliverability.server", () => deliverabilityMock);

import {
  createSalesPipelineWorkOrderCore,
  createFollowUpSequenceWorkOrderCore,
  createWhatsAppCampaignWorkOrderCore,
  createEmailCampaignWorkOrderCore,
  createCallCampaignWorkOrderCore,
} from "@/lib/hivemind/channel-work-orders.server";

const WS = "11111111-2222-3333-4444-555555555555";

interface TableSpec {
  rows?: any[];
  error?: { message: string } | null;
}

/** Minimal chainable/thenable fake of the Supabase query builder. */
function makeSb(tables: Record<string, TableSpec>) {
  const inserted: Record<string, any[]> = {};
  let idSeq = 0;
  const from = (table: string) => {
    const spec = tables[table] ?? { rows: [] };
    const state: any = { op: "select" };
    const result = () =>
      spec.error
        ? { data: null, error: spec.error }
        : { data: spec.rows ?? [], error: null };
    const b: any = {
      select: (..._a: any[]) => b,
      eq: (..._a: any[]) => b,
      in: (..._a: any[]) => b,
      order: (..._a: any[]) => b,
      limit: (..._a: any[]) => b,
      delete: () => { state.op = "delete"; return b; },
      insert: (row: any) => {
        state.op = "insert";
        state.row = { ...row, id: `${table}-${++idSeq}` };
        (inserted[table] ??= []).push(state.row);
        return b;
      },
      maybeSingle: async () => {
        const r = result();
        return { data: (r.data ?? [])[0] ?? null, error: r.error };
      },
      single: async () => {
        if (state.op === "insert") {
          if (spec.error) return { data: null, error: spec.error };
          return { data: state.row, error: null };
        }
        const r = result();
        return { data: (r.data ?? [])[0] ?? null, error: r.error };
      },
      then: (resolve: any, reject: any) => {
        if (state.op === "delete") return Promise.resolve({ data: null, error: null }).then(resolve, reject);
        return Promise.resolve(result()).then(resolve, reject);
      },
    };
    return b;
  };
  return { sb: { from } as any, inserted };
}

const lead = (over: Record<string, any> = {}) => ({
  id: `lead-${Math.random().toString(36).slice(2)}`,
  full_name: "Test Lead",
  phone: "+447700900001",
  email: "lead@example.com",
  status: "need_to_call",
  pipeline_stage: "lead",
  whatsapp_opt_in: true,
  last_contacted_at: null,
  updated_at: "2026-07-20T00:00:00Z",
  created_at: "2026-07-01T00:00:00Z",
  qualification_status: null,
  sale_amount: null,
  call_outcome: null,
  objections: null,
  external_source_id: null,
  source: "csv_import",
  state_name: null,
  meta: {},
  ...over,
});

describe("WhatsApp campaign core", () => {
  it("no WATI connection → integration_required, Follow-Up stage present, final Send blocked", async () => {
    const { sb, inserted } = makeSb({
      wati_connections: { rows: [] },
      wati_templates: { rows: [{ id: "t1", name: "hello", status: "APPROVED", category: "x", body: "hi" }] },
      leads: { rows: [lead({ phone: "+447700900001" }), lead({ phone: "+15551234567" })] },
      work_orders: { rows: [] },
      hivemind_tasks: { rows: [] },
    });
    const res = await createWhatsAppCampaignWorkOrderCore(sb, WS, null, {});
    expect(res.providerConnected).toBe(false);
    expect(inserted.work_orders![0].readiness_state).toBe("integration_required");

    const stageKeys = res.tasks.map((t: any) => t.metadata.approval_stage);
    expect(stageKeys).toEqual(["audience", "template", "schedule", "follow_up", "send"]);

    const finalTask = res.tasks[res.tasks.length - 1];
    expect(finalTask.metadata.final_send_stage).toBe(true);
    const blockers = finalTask.intelligence_packet.blockers as Array<{ kind: string; detail: string }>;
    expect(blockers.some((b) => b.kind === "integration_missing")).toBe(true);
    expect(blockers.some((b) => /awaiting prior stage approvals/i.test(b.detail))).toBe(true);
    // Non-final stages carry the integration blocker too — no fake ready state.
    expect(res.tasks[0].readiness_state).toBe("integration_required");
  });

  it("evidence includes sender account, country mix, volume and honest cost range", async () => {
    const { sb } = makeSb({
      wati_connections: { rows: [{ workspace_id: WS, tenant_id: "ten-1", api_host: "https://x.wati.io", status: "connected", last_tested_at: null, error_message: null }] },
      wati_templates: { rows: [] },
      leads: { rows: [lead({ phone: "+447700900001" }), lead({ phone: "+15551234567" }), lead({ phone: "0771234" })] },
      work_orders: { rows: [] },
      hivemind_tasks: { rows: [] },
    });
    const res = await createWhatsAppCampaignWorkOrderCore(sb, WS, null, {});
    const packet = res.tasks[0].intelligence_packet;
    const sources = packet.evidence.map((e: any) => e.source);
    expect(sources).toContain("wati_connections");
    expect(sources).toContain("cost_estimate");
    const wati = packet.evidence.find((e: any) => e.source === "wati_connections");
    expect(wati.data.tenant_id).toBe("ten-1");
    expect(wati.data.sender_number_known).toBe(false); // honest: number lives in WATI
    const countries = packet.evidence.find((e: any) => e.source === "leads" && e.data?.by_country);
    expect(countries.data.by_country["United Kingdom"]).toBe(1);
    expect(countries.data.by_country["US/Canada"]).toBe(1);
    expect(countries.data.unknown_prefix).toBe(1);
    const cost = packet.evidence.find((e: any) => e.source === "cost_estimate");
    expect(cost.data.messages).toBe(3);
    expect(cost.data.assumption).toBe(true);
    expect(packet.cost.known).toBe(false);
  });
});

describe("Email campaign core", () => {
  it("suppression list read error → throws (fail closed, no audience built)", async () => {
    deliverabilityMock.getEmailReadinessForWorkspace.mockResolvedValueOnce({ score: 90, grade: "A", issues: [] });
    const { sb, inserted } = makeSb({
      suppressed_emails: { error: { message: "permission denied" } },
      leads: { rows: [lead()] },
      hexmail_campaigns: { rows: [] },
      work_orders: { rows: [] },
      hivemind_tasks: { rows: [] },
    });
    await expect(createEmailCampaignWorkOrderCore(sb, WS, null, {}))
      .rejects.toThrow(/suppression list/i);
    expect(inserted.work_orders).toBeUndefined();
  });

  it("no verified sender domain → integration_required readiness", async () => {
    deliverabilityMock.getEmailReadinessForWorkspace.mockResolvedValueOnce(null);
    const { sb, inserted } = makeSb({
      suppressed_emails: { rows: [] },
      leads: { rows: [lead()] },
      hexmail_campaigns: { rows: [] },
      work_orders: { rows: [] },
      hivemind_tasks: { rows: [] },
    });
    const res = await createEmailCampaignWorkOrderCore(sb, WS, null, {});
    expect(res.deliverability).toBeNull();
    expect(inserted.work_orders![0].readiness_state).toBe("integration_required");
    const blockers = res.tasks[0].intelligence_packet.blockers as Array<{ kind: string }>;
    expect(blockers.some((b) => b.kind === "integration_missing")).toBe(true);
  });

  it("failing sender domain health (grade D/F) → blocked readiness with explicit blocker", async () => {
    deliverabilityMock.getEmailReadinessForWorkspace.mockResolvedValueOnce({
      score: 40, grade: "D", issues: ["SPF record missing", "12 bounces in last 30 days"],
    });
    const { sb, inserted } = makeSb({
      suppressed_emails: { rows: [] },
      leads: { rows: [lead()] },
      hexmail_campaigns: { rows: [] },
      work_orders: { rows: [] },
      hivemind_tasks: { rows: [] },
    });
    const res = await createEmailCampaignWorkOrderCore(sb, WS, null, {});
    expect(inserted.work_orders![0].readiness_state).toBe("blocked");
    const blockers = res.tasks[0].intelligence_packet.blockers as Array<{ kind: string; detail: string }>;
    const health = blockers.find((b) => /health check FAILED/i.test(b.detail));
    expect(health).toBeTruthy();
    expect(health!.detail).toMatch(/SPF record missing/);
    // Every stage carries the blocker — no fake ready state anywhere.
    for (const t of res.tasks) expect(t.readiness_state).toBe("blocked");
  });

  it("suppressed addresses are excluded from the audience with evidence", async () => {
    deliverabilityMock.getEmailReadinessForWorkspace.mockResolvedValueOnce({ score: 80, grade: "B", issues: [] });
    const { sb } = makeSb({
      suppressed_emails: { rows: [{ email: "blocked@example.com" }] },
      leads: { rows: [lead({ email: "ok@example.com" }), lead({ email: "blocked@example.com", phone: "+447700900002" })] },
      hexmail_campaigns: { rows: [] },
      work_orders: { rows: [] },
      hivemind_tasks: { rows: [] },
    });
    const res = await createEmailCampaignWorkOrderCore(sb, WS, null, {});
    expect(res.audienceSummary).toMatch(/1 suppressed/);
    expect(res.audienceSummary).toMatch(/^1 of 2/);
  });
});

describe("Call campaign core", () => {
  it("ambiguous agent name → returns candidates, creates NO records", async () => {
    const { sb, inserted } = makeSb({
      agents: { rows: [
        { id: "a1", name: "Ava Sales", status: "active", settings: {}, retell_agent_id: "r1" },
        { id: "a2", name: "Ava Support", status: "active", settings: {}, retell_agent_id: "r2" },
      ] },
      leads: { rows: [lead()] },
      work_orders: { rows: [] },
      hivemind_tasks: { rows: [] },
    });
    const res = await createCallCampaignWorkOrderCore(sb, WS, null, { agentName: "ava" });
    expect(res.workOrder).toBeNull();
    expect(res.agentStatus).toBe("ambiguous");
    expect(res.agentCandidates.length).toBe(2);
    expect(inserted.work_orders).toBeUndefined();
    expect(inserted.hivemind_tasks).toBeUndefined();
  });

  it("evidence resolves caller number, script version, retry/concurrency policy, CRM mapping and real cost basis", async () => {
    const { sb, inserted } = makeSb({
      agents: { rows: [{
        id: "a1", name: "Ava Sales", status: "active", settings: {}, retell_agent_id: "r1",
        flow_data: { nodes: [{ id: "n1" }, { id: "n2", type: "calcom_booking" }], edges: [] },
        updated_at: "2026-07-10T00:00:00Z", voice_provider: "retell", inbound_phone_number: null,
      }] },
      phone_numbers: { rows: [{ id: "p1", phone_number: "+441134960000", friendly_name: "Main", provider: "twilio", agent_id: "a1", is_active: true }] },
      campaigns: { rows: [{ id: "c1", name: "Q2 outreach", status: "completed", retry_config: { max_retries: 2, concurrency: 3, voicemail: "hangup" }, schedule_config: { window: "09:00-17:00" }, phone_number_id: "p1" }] },
      calls: { rows: [
        { duration_seconds: 120, cost_cents: 50 },
        { duration_seconds: 60, cost_cents: 30 },
      ] },
      leads: { rows: [
        lead({ phone: "+447700900001", external_source_id: "crm-9" }),
        lead({ phone: "+447700900002", email: "x@example.com" }),
      ] },
      work_orders: { rows: [] },
      hivemind_tasks: { rows: [] },
    });
    const res = await createCallCampaignWorkOrderCore(sb, WS, null, { agentName: "Ava Sales", dailyVolume: 25 });
    expect(res.agentStatus).toBe("resolved");
    expect(inserted.work_orders![0].readiness_state).toBe("ready_for_change_approval");
    const wm = inserted.work_orders![0].metadata;
    expect(wm.caller_number).toBe("+441134960000");
    expect(wm.concurrency).toBe(3);
    expect(wm.crm_linked_leads).toBe(1);
    expect(wm.cost_estimate.basis).toBe("recent_call_history");
    expect(wm.cost_estimate.avg_cost_cents).toBe(40);
    expect(wm.cost_estimate.estimated_total_cents).toBe(80);

    const packet = res.tasks[0].intelligence_packet;
    const bySource = (s: string) => packet.evidence.filter((e: any) => e.source === s);
    const agentEv = bySource("agents")[0];
    expect(agentEv.data.selected.script_flow_nodes).toBe(2);
    expect(agentEv.data.selected.script_last_edited_at).toBe("2026-07-10T00:00:00Z");
    expect(agentEv.data.selected.calendar_linked).toBe(true);
    const numEv = bySource("phone_numbers")[0];
    expect(numEv.data.resolved).toBe("+441134960000");
    expect(numEv.data.agent_assigned).toBe(true);
    const polEv = bySource("campaigns")[0];
    expect(polEv.data.concurrency).toBe(3);
    expect(polEv.data.retry_config.max_retries).toBe(2);
    const crmEv = packet.evidence.find((e: any) => e.source === "leads" && e.data?.crm_linked !== undefined);
    expect(crmEv.data.crm_linked).toBe(1);
    expect(crmEv.data.local_only).toBe(1);
    const costEv = bySource("calls")[0];
    expect(costEv.data.cost_estimate.basis).toBe("recent_call_history");
  });

  it("no active caller number → integration_required with explicit blocker", async () => {
    const { sb, inserted } = makeSb({
      agents: { rows: [{ id: "a1", name: "Ava Sales", status: "active", settings: {}, retell_agent_id: "r1", flow_data: { nodes: [] }, updated_at: "2026-07-10T00:00:00Z", voice_provider: "retell", inbound_phone_number: null }] },
      phone_numbers: { rows: [] },
      campaigns: { rows: [] },
      calls: { rows: [] },
      leads: { rows: [lead()] },
      work_orders: { rows: [] },
      hivemind_tasks: { rows: [] },
    });
    const res = await createCallCampaignWorkOrderCore(sb, WS, null, { agentName: "Ava Sales" });
    expect(inserted.work_orders![0].readiness_state).toBe("integration_required");
    const blockers = res.tasks[0].intelligence_packet.blockers as Array<{ kind: string; detail: string }>;
    expect(blockers.some((b) => b.kind === "integration_missing" && /caller number/i.test(b.detail))).toBe(true);
  });
});

describe("Sales pipeline core", () => {
  it("evidence carries deal value, lost reasons, CRM sync state and critical field gaps", async () => {
    const { sb } = makeSb({
      leads: { rows: [
        lead({ pipeline_stage: "sale_done", sale_amount: 5000, external_source_id: "crm-1" }),
        lead({ pipeline_stage: "lost", call_outcome: "price too high" }),
        lead({ pipeline_stage: "lost", call_outcome: null, objections: null }),
        lead({ full_name: null, pipeline_stage: null }),
      ] },
      work_orders: { rows: [] },
      hivemind_tasks: { rows: [] },
    });
    const res = await createSalesPipelineWorkOrderCore(sb, WS, null, {});
    expect(res.analysis.dealValue.totalKnown).toBe(5000);
    expect(res.analysis.dealValue.wonValue).toBe(5000);
    expect(res.analysis.lostReasons["price too high"]).toBe(1);
    expect(res.analysis.lostWithoutReason).toBe(1);
    expect(res.analysis.syncState).toEqual({ externallySynced: 1, localOnly: 3 });
    expect(res.analysis.missingCriticalFields.name).toBe(1);

    const ev = res.tasks[0].intelligence_packet.evidence.find((e: any) => e.source === "leads");
    expect(ev.data.deal_value.totalKnown).toBe(5000);
    expect(ev.data.lost_reasons["price too high"]).toBe(1);
    expect(ev.data.crm_sync_state.externallySynced).toBe(1);
    expect(ev.data.missing_critical_fields.name).toBe(1);
    // Record-tied proposals include the lost-reason backfill action.
    const changes = res.tasks[0].intelligence_packet.proposed_changes as Array<{ target: string }>;
    expect(changes.some((c) => /no recorded reason/i.test(c.target))).toBe(true);
  });
});

describe("Follow-up sequence core", () => {
  it("evidence reports per-lead timezone / preferred-channel signals with honest unknown counts", async () => {
    const { sb } = makeSb({
      suppressed_emails: { rows: [] },
      leads: { rows: [
        lead({ meta: { timezone: "Europe/London", preferred_contact: "email" }, phone: "+447700900001", email: "a@example.com" }),
        lead({ meta: {}, state_name: "California", phone: "+15551230001", email: "b@example.com" }),
        lead({ meta: {}, phone: "+447700900333", email: "c@example.com" }),
      ] },
      work_orders: { rows: [] },
      hivemind_tasks: { rows: [] },
    });
    const res = await createFollowUpSequenceWorkOrderCore(sb, WS, null, { channels: ["email", "call"], touches: 2 });
    const packet = res.tasks[0].intelligence_packet;
    const pref = packet.evidence.find((e: any) => e.data?.preferred_channels);
    expect(pref).toBeTruthy();
    expect(pref.data.timezones["Europe/London"]).toBe(1);
    expect(pref.data.timezones["state:California"]).toBe(1);
    expect(pref.data.unknown_timezone).toBe(1);
    expect(pref.data.preferred_channels["email"]).toBe(1);
    expect(pref.data.unknown_preferred_channel).toBe(2);
    // Final Send stage remains blocked.
    const finalTask = res.tasks[res.tasks.length - 1];
    expect(finalTask.readiness_state).toBe("blocked");
  });
});
