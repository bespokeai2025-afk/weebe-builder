/**
 * Universal Acceptance Test Matrix — Task #503
 *
 * Runs every work-order creation core against a consistent set of universal
 * architecture contracts.  Per-core business-logic details are tested in their
 * dedicated files; this matrix verifies only the contracts that EVERY core must
 * honour regardless of domain:
 *
 *  A — WBAH workspace is hard-excluded (assertNotWbahWorkspace fires before any DB)
 *  B — Work order carries a valid intelligence packet (version present)
 *  C — Every stage task carries its own intelligence packet
 *  D — Final-send stage(s) are NOT in an approvable readiness state and carry
 *      an "awaiting prior stage approvals" blocker
 *  E — All non-final stages ARE in an approvable readiness state
 *  F — Task insert failure triggers full rollback (no orphaned work order)
 *
 * Cores covered (12):
 *  HiveMind    — sales pipeline, follow-up sequence, WhatsApp campaign,
 *                email campaign, call campaign, cross-channel objective
 *  SystemMind  — agent↔CRM integration, workflow depth
 *  AccountsMind — invoice audit, renewals audit, outgoings audit, client costing
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/hivemind/mode-gate.server", () => ({
  assertProposalAllowed: vi.fn(async () => undefined),
}));

const deliverabilityMock = vi.hoisted(() => ({
  getEmailReadinessForWorkspace: vi.fn(async () => ({
    score: 85,
    grade: "B",
    issues: [],
  })),
}));
vi.mock("@/lib/hexmail/deliverability.server", () => deliverabilityMock);

vi.mock("@/lib/content-safety/universal-content-safety.server", () => ({
  runContentSafetyCheck: vi.fn(async () => ({
    passed: true,
    violations: [],
    warnings: [],
    violation_count: 0,
    checked_at: new Date().toISOString(),
  })),
  safetyCheckEvidenceItem: vi.fn((result: any) => ({
    source: "safety_check",
    description: "Content safety gate PASSED (test mock).",
    data: { passed: true, violation_count: 0, violations: [], warnings: [] },
    retrieved_at: new Date().toISOString(),
  })),
}));

import {
  createSalesPipelineWorkOrderCore,
  createFollowUpSequenceWorkOrderCore,
  createWhatsAppCampaignWorkOrderCore,
  createEmailCampaignWorkOrderCore,
  createCallCampaignWorkOrderCore,
} from "@/lib/hivemind/channel-work-orders.server";
import { createCrossChannelObjectiveWorkOrderCore } from "@/lib/hivemind/cross-channel-work-orders.server";
import {
  createAgentCrmIntegrationWorkOrderCore,
  createWorkflowDepthWorkOrderCore,
} from "@/lib/systemmind/systemmind-depth-work-orders.server";
import {
  createFinancialAuditWorkOrderCore,
  type FinancialAuditKind,
} from "@/lib/accountsmind/financial-audit-work-orders.server";
import { isApprovableReadiness } from "@/lib/minds/intelligence-packet.shared";
import { WBAH_WORKSPACE_ID } from "@/lib/wbah-exclusion.shared";

// ── Constants ────────────────────────────────────────────────────────────────

const WS = "11111111-2222-3333-4444-555555555555";

// ── Fake Supabase builder ────────────────────────────────────────────────────

interface TableSpec {
  rows?: any[];
  error?: { message: string } | null;
}

function makeSb(tables: Record<string, TableSpec>) {
  const inserted: Record<string, any[]> = {};
  const deleted: Record<string, true> = {};
  let idSeq = 0;

  const from = (table: string) => {
    const spec = tables[table] ?? { rows: [] };
    const state: any = { op: "select" };

    const result = () => {
      if (spec.error) return { data: null, error: spec.error };
      let rows = spec.rows ?? [];
      for (const col of state.isNull ?? []) rows = rows.filter((r: any) => r[col] == null);
      for (const col of state.notNull ?? []) rows = rows.filter((r: any) => r[col] != null);
      for (const f of state.ranges ?? []) rows = rows.filter(f);
      return { data: rows, error: null };
    };

    const b: any = {
      select: (..._a: any[]) => b,
      eq:     (..._a: any[]) => b,
      neq:    (..._a: any[]) => b,
      in:     (..._a: any[]) => b,
      is:     (col: string, val: any) => { if (val === null) (state.isNull ??= []).push(col); return b; },
      not:    (col: string, op: string, val: any) => { if (op === "is" && val === null) (state.notNull ??= []).push(col); return b; },
      gte:    (col: string, val: any) => { (state.ranges ??= []).push((r: any) => r[col] == null || r[col] >= val); return b; },
      lt:     (col: string, val: any) => { (state.ranges ??= []).push((r: any) => r[col] == null || r[col] < val); return b; },
      order:  (..._a: any[]) => b,
      limit:  (..._a: any[]) => b,
      delete: () => { state.op = "delete"; deleted[table] = true; return b; },
      update: (patch: any) => { state.op = "update"; state.patch = patch; return b; },
      insert: (row: any) => {
        state.op = "insert";
        state.row = { ...row, id: `${table}-${++idSeq}` };
        if (!spec.error) (inserted[table] ??= []).push(state.row);
        return b;
      },
      maybeSingle: async () => {
        if (state.op === "insert") {
          if (spec.error) return { data: null, error: spec.error };
          return { data: state.row, error: null };
        }
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
        if (state.op === "delete" || state.op === "update") {
          return Promise.resolve({ data: null, error: null }).then(resolve, reject);
        }
        return Promise.resolve(result()).then(resolve, reject);
      },
    };
    return b;
  };

  return { sb: { from } as any, inserted, deleted };
}

// ── Data factories ───────────────────────────────────────────────────────────

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

// ── Universal contract assertion helper ──────────────────────────────────────

/**
 * Asserts contracts B–E on a work-order creation result.
 * Contract A (WBAH) is tested separately for each core.
 * Contract F (rollback) is tested in a dedicated describe block.
 */
function expectUniversalContracts(result: { workOrder: any; tasks: any[] }) {
  const { workOrder, tasks } = result;

  // B: work order has an intelligence packet with a version string.
  expect(workOrder).toBeDefined();
  expect(workOrder.intelligence_packet).toBeDefined();
  expect(workOrder.intelligence_packet.version).toBeTruthy();

  // C: every stage task has its own intelligence packet.
  expect(tasks.length).toBeGreaterThanOrEqual(1);
  for (const t of tasks) {
    expect(t.intelligence_packet).toBeDefined();
    expect(t.intelligence_packet.version).toBeTruthy();
  }

  // D: final-send stage(s) are NOT approvable + carry the "awaiting" blocker.
  for (const t of tasks.filter((t: any) => t.metadata?.final_send_stage)) {
    expect(isApprovableReadiness(t.readiness_state)).toBe(false);
    const blockers = (t.intelligence_packet.blockers ?? []) as Array<{ kind: string; detail: string }>;
    expect(blockers.some((b) => /awaiting prior stage approvals/i.test(b.detail))).toBe(true);
  }

  // E: non-final stages are approvable.
  for (const t of tasks.filter((t: any) => !t.metadata?.final_send_stage)) {
    expect(isApprovableReadiness(t.readiness_state)).toBe(true);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HiveMind cores
// ═══════════════════════════════════════════════════════════════════════════════

describe("Contract matrix — Sales pipeline review (HiveMind)", () => {
  it("A: WBAH workspace is hard-excluded", async () => {
    const { sb } = makeSb({});
    await expect(createSalesPipelineWorkOrderCore(sb, WBAH_WORKSPACE_ID, null)).rejects.toThrow(/wbah/i);
  });

  it("B–E: universal contracts hold on a populated pipeline", async () => {
    const { sb, inserted } = makeSb({
      leads: { rows: [lead(), lead({ status: "qualified", pipeline_stage: "qualified" })] },
      work_orders: { rows: [] },
      hivemind_tasks: { rows: [] },
    });
    const res = await createSalesPipelineWorkOrderCore(sb, WS, null);
    expect(res.workOrder).toBeDefined();
    expectUniversalContracts({ workOrder: inserted.work_orders![0], tasks: res.tasks });
  });
});

describe("Contract matrix — Follow-up sequence (HiveMind)", () => {
  it("A: WBAH workspace is hard-excluded", async () => {
    const { sb } = makeSb({});
    await expect(createFollowUpSequenceWorkOrderCore(sb, WBAH_WORKSPACE_ID, null)).rejects.toThrow(/wbah/i);
  });

  it("B–E: universal contracts hold — 4 stage tasks, final Send blocked", async () => {
    const { sb, inserted } = makeSb({
      leads: { rows: [lead(), lead()] },
      suppressed_emails: { rows: [] },
      work_orders: { rows: [] },
      hivemind_tasks: { rows: [] },
    });
    const res = await createFollowUpSequenceWorkOrderCore(sb, WS, null, { channels: ["call", "email"], touches: 2 });
    expectUniversalContracts({ workOrder: inserted.work_orders![0], tasks: res.tasks });
    expect(res.tasks).toHaveLength(4);
    const finalTask = res.tasks[res.tasks.length - 1];
    expect(finalTask.metadata.approval_stage).toBe("send");
    expect(finalTask.metadata.final_send_stage).toBe(true);
  });
});

describe("Contract matrix — WhatsApp campaign (HiveMind)", () => {
  it("A: WBAH workspace is hard-excluded", async () => {
    const { sb } = makeSb({});
    await expect(createWhatsAppCampaignWorkOrderCore(sb, WBAH_WORKSPACE_ID, null)).rejects.toThrow(/wbah/i);
  });

  it("B–E: universal contracts hold — connected provider, opted-in leads", async () => {
    const { sb, inserted } = makeSb({
      wati_connections: { rows: [{ workspace_id: WS, tenant_id: "ten-1", api_host: "https://x.wati.io", status: "connected", last_tested_at: null, error_message: null }] },
      wati_templates: { rows: [{ id: "t1", name: "welcome", status: "approved", category: "MARKETING", body: "Hello {{1}}, we have a special offer for you today!" }] },
      leads: { rows: [lead({ whatsapp_opt_in: true, phone: "+447700900001" })] },
      work_orders: { rows: [] },
      hivemind_tasks: { rows: [] },
    });
    const res = await createWhatsAppCampaignWorkOrderCore(sb, WS, null);
    expectUniversalContracts({ workOrder: inserted.work_orders![0], tasks: res.tasks });
    expect(res.providerConnected).toBe(true);
    const finalTask = res.tasks[res.tasks.length - 1];
    expect(finalTask.metadata.final_send_stage).toBe(true);
  });

  it("B–E: universal contracts hold even when no provider connected (integration_required)", async () => {
    const { sb, inserted } = makeSb({
      wati_connections: { rows: [] },
      wati_templates: { rows: [] },
      leads: { rows: [lead()] },
      work_orders: { rows: [] },
      hivemind_tasks: { rows: [] },
    });
    const res = await createWhatsAppCampaignWorkOrderCore(sb, WS, null);
    expect(inserted.work_orders![0].readiness_state).toBe("integration_required");
    expect(res.tasks).toHaveLength(5);
    for (const t of res.tasks) {
      expect(t.intelligence_packet).toBeDefined();
    }
    const finalTask = res.tasks[res.tasks.length - 1];
    expect(finalTask.metadata.final_send_stage).toBe(true);
  });
});

describe("Contract matrix — Email campaign (HiveMind)", () => {
  it("A: WBAH workspace is hard-excluded", async () => {
    const { sb } = makeSb({});
    await expect(createEmailCampaignWorkOrderCore(sb, WBAH_WORKSPACE_ID, null)).rejects.toThrow(/wbah/i);
  });

  it("B–E: universal contracts hold — deliverability present, emailable leads", async () => {
    deliverabilityMock.getEmailReadinessForWorkspace.mockResolvedValueOnce({ score: 90, grade: "A", issues: [] });
    const { sb, inserted } = makeSb({
      suppressed_emails: { rows: [] },
      leads: { rows: [lead({ email: "test@example.com" })] },
      hexmail_campaigns: { rows: [] },
      hexmail_templates: { rows: [{ id: "et1", name: "outreach", type: "email", status: "active", content: "Hi {{name}}, we wanted to reach out about our services.", subject: "Quick note from WEBEE" }] },
      work_orders: { rows: [] },
      hivemind_tasks: { rows: [] },
    });
    const res = await createEmailCampaignWorkOrderCore(sb, WS, null);
    expectUniversalContracts({ workOrder: inserted.work_orders![0], tasks: res.tasks });
    const finalTask = res.tasks[res.tasks.length - 1];
    expect(finalTask.metadata.final_send_stage).toBe(true);
  });
});

describe("Contract matrix — Call campaign (HiveMind)", () => {
  it("A: WBAH workspace is hard-excluded", async () => {
    const { sb } = makeSb({});
    await expect(createCallCampaignWorkOrderCore(sb, WBAH_WORKSPACE_ID, null)).rejects.toThrow(/wbah/i);
  });

  it("B–E: universal contracts hold — one agent, leads with phones", async () => {
    const { sb, inserted } = makeSb({
      agents: { rows: [{ id: "a1", name: "Ava", retell_agent_id: "agent_x", voice_provider: "retell", inbound_phone_number: "+441632000001", updated_at: "2026-07-01", flow_data: { nodes: [{ type: "conversation", content: "Hello, I'm Ava from WEBEE. How can I help you today?" }] } }] },
      phone_numbers: { rows: [] },
      campaigns: { rows: [] },
      leads: { rows: [lead({ phone: "+447700900001" }), lead({ phone: "+447700900002" })] },
      suppressed_emails: { rows: [] },
      work_orders: { rows: [] },
      hivemind_tasks: { rows: [] },
    });
    const res = await createCallCampaignWorkOrderCore(sb, WS, null);
    expect(res.workOrder).toBeDefined();
    expectUniversalContracts({ workOrder: inserted.work_orders![0], tasks: res.tasks });
    const finalTask = res.tasks[res.tasks.length - 1];
    expect(finalTask.metadata.final_send_stage).toBe(true);
  });
});

describe("Contract matrix — Cross-channel objective (HiveMind)", () => {
  it("A: WBAH workspace is hard-excluded", async () => {
    const { sb } = makeSb({});
    await expect(createCrossChannelObjectiveWorkOrderCore(sb, WBAH_WORKSPACE_ID, null, { objective: "Generate 100 new leads in Q3" })).rejects.toThrow(/wbah/i);
  });

  it("B–E: universal contracts hold — email channel justified by real lead rows", async () => {
    const { sb, inserted } = makeSb({
      leads: { rows: [lead({ email: "a@example.com" }), lead({ email: "b@example.com" })] },
      suppressed_emails: { rows: [] },
      workspace_settings: { rows: [{ workspace_id: WS, whatsapp_provider: null }] },
      agents: { rows: [] },
      growthmind_social_connections: { rows: [] },
      growthmind_gsc_sync_state: { rows: [] },
      work_orders: { rows: [] },
      hivemind_tasks: { rows: [] },
    });
    const res = await createCrossChannelObjectiveWorkOrderCore(sb, WS, null, {
      objective: "Acquire 50 new leads in the UK market through targeted outreach",
    });
    expect(res.justified.length).toBeGreaterThanOrEqual(1);
    // Strategy task is the only non-final, independently-approvable stage in cross-channel.
    // Channel tasks are intentionally blocked (awaiting strategy approval) — Contract E
    // does not apply to them; they are verified separately below.
    expectUniversalContracts({ workOrder: inserted.work_orders![0], tasks: [res.strategyTask] });
    expect(res.strategyTask.metadata.final_send_stage).toBe(false);
    expect(isApprovableReadiness(res.strategyTask.readiness_state)).toBe(true);
    // Channel tasks carry packets (Contract C) but are correctly blocked pending strategy.
    for (const t of res.channelTasks) {
      expect(t.intelligence_packet).toBeDefined();
      expect(t.intelligence_packet.version).toBeTruthy();
      expect(isApprovableReadiness(t.readiness_state)).toBe(false);
    }
  });

  it("B–E: contracts hold even with no justified channels — parent blocked, zero child tasks", async () => {
    const { sb, inserted } = makeSb({
      leads: { rows: [] },
      suppressed_emails: { rows: [] },
      workspace_settings: { rows: [] },
      agents: { rows: [] },
      growthmind_social_connections: { rows: [] },
      growthmind_gsc_sync_state: { rows: [] },
      work_orders: { rows: [] },
      hivemind_tasks: { rows: [] },
    });
    const res = await createCrossChannelObjectiveWorkOrderCore(sb, WS, null, {
      objective: "Acquire 50 new leads in the UK market through targeted outreach",
    });
    expect(res.justified).toHaveLength(0);
    expect(res.channelTasks).toHaveLength(0);
    expect(inserted.work_orders![0].readiness_state).toBe("blocked");
    expect(res.strategyTask.intelligence_packet).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SystemMind cores
// ═══════════════════════════════════════════════════════════════════════════════

describe("Contract matrix — Agent↔CRM integration (SystemMind)", () => {
  it("A: WBAH workspace is hard-excluded", async () => {
    const { sb } = makeSb({});
    await expect(createAgentCrmIntegrationWorkOrderCore(sb, WBAH_WORKSPACE_ID, null)).rejects.toThrow(/wbah/i);
  });

  it("B–E: universal contracts hold — 5 stages, Apply stage blocked + sensitive", async () => {
    const { sb, inserted } = makeSb({
      agents: { rows: [{ id: "a1", name: "Ava", agent_type: "client_qualification", voice_provider: "retell", retell_agent_id: "agent_x" }] },
      systemmind_crm_connections: { rows: [{ id: "c1", provider: "hubspot", label: "Main", status: "verified", last_tested_at: "2026-07-01" }] },
      systemmind_crm_discoveries: { rows: [] },
      systemmind_dynamic_variables: { rows: [] },
      systemmind_call_triggers: { rows: [] },
      systemmind_integration_errors: { rows: [] },
      work_orders: { rows: [] },
      hivemind_tasks: { rows: [] },
    });
    const res = await createAgentCrmIntegrationWorkOrderCore(sb, WS, null);
    expect(res.tasks).toHaveLength(5);
    expectUniversalContracts({ workOrder: inserted.work_orders![0], tasks: res.tasks });
    const applyTask = res.tasks[res.tasks.length - 1];
    expect(applyTask.metadata.approval_stage).toBe("apply");
    expect(applyTask.intelligence_packet.approval_scope.sensitive).toBe(true);
  });
});

describe("Contract matrix — Workflow depth review (SystemMind)", () => {
  it("A: WBAH workspace is hard-excluded", async () => {
    const { sb } = makeSb({});
    await expect(createWorkflowDepthWorkOrderCore(sb, WBAH_WORKSPACE_ID, null)).rejects.toThrow(/wbah/i);
  });

  it("B–E: universal contracts hold — 4 stages, Apply stage blocked + sensitive", async () => {
    const { sb, inserted } = makeSb({
      workspace_workflows: { rows: [{ id: "w1", name: "Lead intake", status: "active", flow_definition: { nodes: [{}, {}] }, updated_at: "2026-07-20" }] },
      workflow_runs: { rows: [{ id: "r1", status: "completed", created_at: "2026-07-25" }] },
      work_orders: { rows: [] },
      hivemind_tasks: { rows: [] },
    });
    const res = await createWorkflowDepthWorkOrderCore(sb, WS, null);
    expect(res.tasks).toHaveLength(4);
    expectUniversalContracts({ workOrder: inserted.work_orders![0], tasks: res.tasks });
    const applyTask = res.tasks[res.tasks.length - 1];
    expect(applyTask.metadata.approval_stage).toBe("apply");
    expect(applyTask.intelligence_packet.approval_scope.sensitive).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// AccountsMind financial audit cores
// ═══════════════════════════════════════════════════════════════════════════════

const FINANCIAL_AUDIT_KINDS: FinancialAuditKind[] = [
  "invoice_audit",
  "renewals_audit",
  "outgoings_audit",
  "client_costing_audit",
];

const AUDIT_TABLE_DATA: Record<FinancialAuditKind, Record<string, TableSpec>> = {
  invoice_audit: {
    accountsmind_invoices: {
      rows: [{ id: "i1", invoice_number: "INV-001", client_name: "Acme", status: "sent",
               total_cents: 100000, amount_paid_cents: 0, currency: "GBP",
               due_date: "2025-01-01", issue_date: "2024-12-01", paid_at: null,
               storage_path: "invoices/i1.pdf" }],
    },
  },
  renewals_audit: {
    accountsmind_recurring_invoices: {
      rows: [{ id: "r1", name: "Monthly retainer", active: true, day_of_month: 1,
               last_generated_month: "2025-01-01", currency: "GBP",
               items_json: [{ unit_price_cents: 50000, quantity: 1 }], due_days: 14 }],
    },
  },
  outgoings_audit: {
    provider_usage_log: {
      rows: [
        { provider_category: "voice", provider_name: "retell", cost_usd: 10, created_at: new Date().toISOString() },
      ],
    },
  },
  client_costing_audit: {
    accountsmind_invoices: {
      rows: [{ id: "i2", invoice_number: "INV-002", client_name: "Beta", status: "sent",
               total_cents: 200000, amount_paid_cents: 0, currency: "GBP",
               due_date: "2025-01-01", issue_date: "2024-12-01", paid_at: null,
               storage_path: "invoices/i2.pdf" }],
    },
  },
};

describe("Contract matrix — AccountsMind financial audit cores", () => {
  it("A: WBAH workspace is hard-excluded (invoice_audit representative)", async () => {
    const { sb } = makeSb({});
    await expect(createFinancialAuditWorkOrderCore(sb, WBAH_WORKSPACE_ID, null, "invoice_audit")).rejects.toThrow(/wbah/i);
  });

  for (const kind of FINANCIAL_AUDIT_KINDS) {
    it(`B–E: universal contracts hold for ${kind} — 3 stages, Execute stage blocked + sensitive`, async () => {
      const baseTables = AUDIT_TABLE_DATA[kind];
      const { sb, inserted } = makeSb({
        ...baseTables,
        work_orders: { rows: [] },
        hivemind_tasks: { rows: [] },
      });
      const res = await createFinancialAuditWorkOrderCore(sb, WS, null, kind);
      expect(res.tasks).toHaveLength(3);
      expectUniversalContracts({ workOrder: inserted.work_orders![0], tasks: res.tasks });
      const executeTask = res.tasks[res.tasks.length - 1];
      expect(executeTask.metadata.approval_stage).toBe("execute");
      expect(executeTask.intelligence_packet.approval_scope.sensitive).toBe(true);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Contract F — Rollback: task insert failure must clean up the work order
// ═══════════════════════════════════════════════════════════════════════════════

describe("Contract F — Rollback on task insert failure", () => {
  it("sales pipeline: hivemind_tasks insert error → work order deleted, error re-thrown", async () => {
    const { sb, inserted, deleted } = makeSb({
      leads: { rows: [lead()] },
      work_orders: { rows: [] },
      hivemind_tasks: { error: { message: "DB constraint violation" } },
    });
    await expect(createSalesPipelineWorkOrderCore(sb, WS, null)).rejects.toThrow(/DB constraint violation/i);
    expect(deleted["work_orders"]).toBe(true);
    expect(inserted["hivemind_tasks"]).toBeUndefined();
  });

  it("follow-up sequence: mid-chain task failure → work order and prior tasks deleted", async () => {
    const { sb, inserted, deleted } = makeSb({
      leads: { rows: [lead()] },
      suppressed_emails: { rows: [] },
      work_orders: { rows: [] },
      hivemind_tasks: { error: { message: "RLS policy violation" } },
    });
    await expect(createFollowUpSequenceWorkOrderCore(sb, WS, null)).rejects.toThrow(/RLS policy violation/i);
    expect(deleted["work_orders"]).toBe(true);
    expect(inserted["hivemind_tasks"]).toBeUndefined();
  });

  it("agent↔CRM integration: task insert error → work order deleted", async () => {
    const { sb, inserted, deleted } = makeSb({
      agents: { rows: [{ id: "a1", name: "Ava", agent_type: "client_qualification", voice_provider: "retell", retell_agent_id: "agent_x" }] },
      systemmind_crm_connections: { rows: [] },
      systemmind_crm_discoveries: { rows: [] },
      systemmind_dynamic_variables: { rows: [] },
      systemmind_call_triggers: { rows: [] },
      systemmind_integration_errors: { rows: [] },
      work_orders: { rows: [] },
      hivemind_tasks: { error: { message: "foreign key violation" } },
    });
    await expect(createAgentCrmIntegrationWorkOrderCore(sb, WS, null)).rejects.toThrow(/foreign key violation/i);
    expect(deleted["work_orders"]).toBe(true);
  });

  it("invoice audit: task insert error → work order deleted", async () => {
    const { sb, inserted, deleted } = makeSb({
      accountsmind_invoices: { rows: [] },
      work_orders: { rows: [] },
      hivemind_tasks: { error: { message: "timeout" } },
    });
    await expect(createFinancialAuditWorkOrderCore(sb, WS, null, "invoice_audit")).rejects.toThrow(/timeout/i);
    expect(deleted["work_orders"]).toBe(true);
  });
});
