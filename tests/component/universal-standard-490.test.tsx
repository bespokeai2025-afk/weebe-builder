/**
 * Task #490 — acceptance tests for the Universal Standard depth systems:
 *  - SystemMind agent↔CRM / workflow depth work orders
 *  - AccountsMind typed financial audit work orders
 *  - Legacy shallow-task migration classifier + migrator
 *  - HiveMind cross-channel objective orchestration
 *
 * Cores run against a fake Supabase builder with the mode gate mocked; the
 * intelligence-packet builder/validator run for real so readiness states are
 * genuine quality-gate outputs.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/hivemind/mode-gate.server", () => ({
  assertProposalAllowed: vi.fn(async () => undefined),
}));

import {
  createAgentCrmIntegrationWorkOrderCore,
  createWorkflowDepthWorkOrderCore,
  AGENT_CRM_STAGES,
  WORKFLOW_DEPTH_STAGES,
} from "@/lib/systemmind/systemmind-depth-work-orders.server";
import {
  createFinancialAuditWorkOrderCore,
  FINANCIAL_AUDIT_STAGES,
} from "@/lib/accountsmind/financial-audit-work-orders.server";
import {
  classifyLegacyTaskRows,
  migrateLegacyTasks,
  buildLegacyConversionPacket,
} from "@/lib/minds/legacy-task-migration.server";
import {
  createCrossChannelObjectiveWorkOrderCore,
  assessChannelEvidence,
} from "@/lib/hivemind/cross-channel-work-orders.server";
import { evidenceItem } from "@/lib/minds/intelligence-packet.server";
import { WBAH_WORKSPACE_ID } from "@/lib/wbah-exclusion.shared";

const WS = "11111111-2222-3333-4444-555555555555";

interface TableSpec {
  rows?: any[];
  error?: { message: string } | null;
}

/** Minimal chainable/thenable fake of the Supabase query builder. */
function makeSb(tables: Record<string, TableSpec>) {
  const inserted: Record<string, any[]> = {};
  const updated: Record<string, any[]> = {};
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
      eq: (..._a: any[]) => b,
      neq: (..._a: any[]) => b,
      in: (..._a: any[]) => b,
      // .is(col, null) / .not(col, "is", null) filter for real so the legacy
      // (packet IS NULL) vs modern (packet NOT NULL) queries stay distinct.
      is: (col: string, val: any) => { state.isNull ??= []; if (val === null) state.isNull.push(col); return b; },
      // gte/lt filter for real when the row actually has the column (so
      // month-window queries like the outgoings audit behave honestly).
      gte: (col: string, val: any) => { state.ranges ??= []; state.ranges.push((r: any) => r[col] == null || r[col] >= val); return b; },
      lt: (col: string, val: any) => { state.ranges ??= []; state.ranges.push((r: any) => r[col] == null || r[col] < val); return b; },
      not: (col: string, op: string, val: any) => { if (op === "is" && val === null) { state.notNull ??= []; state.notNull.push(col); } return b; },
      order: (..._a: any[]) => b,
      limit: (..._a: any[]) => b,
      delete: () => { state.op = "delete"; return b; },
      insert: (row: any) => {
        state.op = "insert";
        state.row = { ...row, id: `${table}-${++idSeq}` };
        (inserted[table] ??= []).push(state.row);
        return b;
      },
      update: (patch: any) => {
        state.op = "update";
        state.patch = patch;
        (updated[table] ??= []).push(patch);
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
          return Promise.resolve({ data: null, error: spec.error ?? null }).then(resolve, reject);
        }
        return Promise.resolve(result()).then(resolve, reject);
      },
    };
    return b;
  };
  return { sb: { from } as any, inserted, updated };
}

// ── SystemMind agent↔CRM depth work order (section 14) ───────────────────────
describe("Agent↔CRM integration work order", () => {
  it("no CRM connected → integration_required, integration_missing blocker on every stage, blocked Apply", async () => {
    const { sb, inserted } = makeSb({
      agents: { rows: [{ id: "a1", name: "Ava", agent_type: "client_qualification", voice_provider: "retell", retell_agent_id: "agent_x" }] },
      systemmind_crm_connections: { rows: [] },
      systemmind_crm_discoveries: { rows: [] },
      systemmind_dynamic_variables: { rows: [] },
      systemmind_call_triggers: { rows: [] },
      systemmind_integration_errors: { rows: [] },
      work_orders: { rows: [] },
      hivemind_tasks: { rows: [] },
    });
    const res = await createAgentCrmIntegrationWorkOrderCore(sb, WS, null, {});
    expect(res.connected).toBe(false);
    expect(res.agentResolved).toBe(true);
    expect(inserted.work_orders![0].readiness_state).toBe("integration_required");

    const stageKeys = res.tasks.map((t: any) => t.metadata.approval_stage);
    expect(stageKeys).toEqual(AGENT_CRM_STAGES.map((s) => s.key));
    // Every stage carries the integration_missing blocker (never invented readiness).
    for (const t of res.tasks) {
      const blockers = t.intelligence_packet.blockers as Array<{ kind: string; detail: string }>;
      expect(blockers.some((b) => b.kind === "integration_missing")).toBe(true);
    }
    // Final Apply stage is additionally blocked behind prior approvals + sensitive.
    const apply = res.tasks[res.tasks.length - 1];
    expect(apply.metadata.final_send_stage).toBe(true);
    expect((apply.intelligence_packet.blockers as any[]).some((b) => /awaiting prior stage approvals/i.test(b.detail))).toBe(true);
    expect(apply.intelligence_packet.approval_scope.sensitive).toBe(true);
    // Depth content: complete implementation plan, not a shallow "connect CRM".
    const planTitles = (apply.intelligence_packet.plan_steps as any[]).map((p) => p.title.toLowerCase());
    for (const expected of ["architecture", "field mapping", "triggers", "test", "rollback", "apply"]) {
      expect(planTitles.join(" | ")).toContain(expected.split(" ")[0]);
    }
  });

  it("verified connection + discovery → field map verified against discovered fields, unmapped reported honestly", async () => {
    const { sb, inserted } = makeSb({
      agents: { rows: [{ id: "a1", name: "Ava", agent_type: "client_qualification", voice_provider: "retell", retell_agent_id: "agent_x" }] },
      systemmind_crm_connections: { rows: [{ id: "c1", provider: "hubspot", label: "Main", status: "verified", last_tested_at: "2026-07-01" }] },
      systemmind_crm_discoveries: {
        rows: [{
          connection_id: "c1", provider: "hubspot", object_count: 1, field_count: 2, discovered_at: "2026-07-02",
          snapshot: { objects: [{ key: "contact", fields: [{ key: "email", label: "Email", type: "string" }] }] },
        }],
      },
      systemmind_dynamic_variables: {
        rows: [
          { id: "v1", name: "caller_email", direction: "outbound", allow_write_to_crm: true, destination_object: "contact", destination_field: "email", data_type: "string" },
          { id: "v2", name: "budget", direction: "outbound", allow_write_to_crm: true, destination_object: "deal", destination_field: "amount", data_type: "number" },
        ],
      },
      systemmind_call_triggers: { rows: [{ id: "t1", name: "post-call", trigger_type: "call_ended", enabled: true }] },
      systemmind_integration_errors: { rows: [{ id: "e1", status: "open" }] },
      work_orders: { rows: [] },
      hivemind_tasks: { rows: [] },
    });
    const res = await createAgentCrmIntegrationWorkOrderCore(sb, WS, null, { agentName: "Ava" });
    expect(res.connected).toBe(true);
    expect(inserted.work_orders![0].readiness_state).toBe("ready_for_review");
    expect(res.fieldMap).toHaveLength(2);
    const mapped = res.fieldMap.find((m: any) => m.variable === "caller_email") as any;
    const unmapped = res.fieldMap.find((m: any) => m.variable === "budget") as any;
    expect(mapped.mapped).toBe(true);
    expect(mapped.crm_field_type).toBe("string");
    expect(unmapped.mapped).toBe(false);
    expect(unmapped.note).toMatch(/needs mapping review/i);
    // Work order records the field map + unmapped count.
    expect(inserted.work_orders![0].metadata.unmapped_fields).toBe(1);
  });

  it("only an UNVERIFIED connection present → still integration_required (never falsely connected)", async () => {
    const { sb, inserted } = makeSb({
      agents: { rows: [{ id: "a1", name: "Ava", agent_type: "client_qualification", voice_provider: "retell", retell_agent_id: "agent_x" }] },
      systemmind_crm_connections: { rows: [{ id: "c1", provider: "hubspot", label: "Main", status: "pending" }] },
      systemmind_crm_discoveries: { rows: [] },
      systemmind_dynamic_variables: { rows: [] },
      systemmind_call_triggers: { rows: [] },
      systemmind_integration_errors: { rows: [] },
      work_orders: { rows: [] },
      hivemind_tasks: { rows: [] },
    });
    const res = await createAgentCrmIntegrationWorkOrderCore(sb, WS, null, {});
    expect(res.connected).toBe(false);
    expect(inserted.work_orders![0].readiness_state).toBe("integration_required");
    for (const t of res.tasks) {
      const blockers = t.intelligence_packet.blockers as Array<{ kind: string }>;
      expect(blockers.some((b) => b.kind === "integration_missing")).toBe(true);
    }
  });

  it("ambiguous agent → target_resolution_required, target reported unresolved", async () => {
    const { sb, inserted } = makeSb({
      agents: { rows: [{ id: "a1", name: "Ava" }, { id: "a2", name: "Max" }] },
      systemmind_crm_connections: { rows: [{ id: "c1", provider: "hubspot", status: "verified" }] },
      systemmind_crm_discoveries: { rows: [] },
      systemmind_integration_errors: { rows: [] },
      work_orders: { rows: [] },
      hivemind_tasks: { rows: [] },
    });
    const res = await createAgentCrmIntegrationWorkOrderCore(sb, WS, null, {});
    expect(res.agentResolved).toBe(false);
    expect(inserted.work_orders![0].readiness_state).toBe("target_resolution_required");
    const agentTarget = (res.tasks[0].intelligence_packet.targets as any[]).find((t) => t.entity_type === "agent");
    expect(agentTarget.resolved).toBe(false);
    expect(agentTarget.resolution_note).toMatch(/no unique agent match/i);
  });

  it("WBAH workspace is hard-excluded", async () => {
    const { sb } = makeSb({});
    await expect(createAgentCrmIntegrationWorkOrderCore(sb, WBAH_WORKSPACE_ID, null, {})).rejects.toThrow(/wbah/i);
  });
});

// ── SystemMind workflow depth work order ─────────────────────────────────────
describe("Workflow depth work order", () => {
  it("resolved workflow → 4 stages from real run evidence, blocked Apply", async () => {
    const { sb, inserted } = makeSb({
      workspace_workflows: { rows: [{ id: "w1", name: "Lead intake", status: "active", flow_definition: { nodes: [{}, {}, {}] }, updated_at: "2026-07-20" }] },
      workflow_runs: { rows: [{ id: "r1", status: "failed", created_at: "2026-07-25" }, { id: "r2", status: "completed", created_at: "2026-07-24" }] },
      work_orders: { rows: [] },
      hivemind_tasks: { rows: [] },
    });
    const res = await createWorkflowDepthWorkOrderCore(sb, WS, null, {});
    expect(res.workflowResolved).toBe(true);
    expect(inserted.work_orders![0].readiness_state).toBe("ready_for_review");
    expect(inserted.work_orders![0].metadata.failed_runs).toBe(1);
    expect(res.tasks.map((t: any) => t.metadata.approval_stage)).toEqual(WORKFLOW_DEPTH_STAGES.map((s) => s.key));
    const apply = res.tasks[res.tasks.length - 1];
    expect(apply.metadata.final_send_stage).toBe(true);
    expect((apply.intelligence_packet.blockers as any[]).some((b) => /awaiting prior stage approvals/i.test(b.detail))).toBe(true);
    // Evidence cites real run counts.
    const runEv = (res.tasks[0].intelligence_packet.evidence as any[]).find((e) => e.source === "workflow_runs");
    expect(runEv.description).toMatch(/2 recent run\(s\); 1 failed/i);
  });
});

// ── AccountsMind typed financial audits (section 16) ─────────────────────────
describe("Financial audit work orders", () => {
  it("invoice audit: overdue invoice becomes a typed exception with exact cents + proposed action; Execute stage blocked + sensitive", async () => {
    const { sb, inserted } = makeSb({
      accountsmind_invoices: {
        rows: [
          { id: "i1", invoice_number: "INV-001", client_name: "Acme", status: "sent", total_cents: 120000, amount_paid_cents: 20000, currency: "GBP", due_date: "2026-06-01" },
          { id: "i2", invoice_number: "INV-002", client_name: "Beta", status: "paid", total_cents: 50000, amount_paid_cents: 50000, currency: "GBP", due_date: "2026-06-15" },
        ],
      },
      work_orders: { rows: [] },
      hivemind_tasks: { rows: [] },
    });
    const res = await createFinancialAuditWorkOrderCore(sb, WS, null, "invoice_audit", {});
    expect(res.audit.records_inspected).toBe(2);
    expect(res.audit.exceptions).toHaveLength(1);
    const ex = res.audit.exceptions[0];
    expect(ex.amount_cents).toBe(100000);
    expect(ex.issue).toMatch(/overdue/i);
    expect(ex.commercial_impact).toMatch(/£1000\.00/);
    expect(ex.proposed_action).toMatch(/payment reminder for invoice INV-001/i);
    expect(ex.approval_requirement).toMatch(/billing approval/i);
    expect(res.audit.totals.overdue_cents).toBe(100000);

    expect(res.tasks.map((t: any) => t.metadata.approval_stage)).toEqual(FINANCIAL_AUDIT_STAGES.map((s) => s.key));
    const execute = res.tasks[res.tasks.length - 1];
    expect(execute.metadata.final_send_stage).toBe(true);
    expect(execute.intelligence_packet.approval_scope.sensitive).toBe(true);
    expect((execute.intelligence_packet.blockers as any[]).some((b) => /awaiting prior stage approvals/i.test(b.detail))).toBe(true);
    // Typed audit recorded on the work order.
    expect(inserted.work_orders![0].metadata.audit.exception_count).toBe(1);
    expect(inserted.work_orders![0].metadata.audit.exceptions[0].record_id).toBe("i1");
  });

  it("renewals audit: inactive schedule and missed month are typed exceptions with schedule value", async () => {
    const { sb } = makeSb({
      accountsmind_recurring_invoices: {
        rows: [
          { id: "s1", name: "Retainer A", active: false, day_of_month: 1, last_generated_month: "2026-06", currency: "GBP", items_json: [{ unit_price_cents: 50000, quantity: 1 }] },
          { id: "s2", name: "Retainer B", active: true, day_of_month: 1, last_generated_month: "2026-06", currency: "GBP", items_json: [{ unit_price_cents: 30000, quantity: 2 }] },
        ],
      },
      work_orders: { rows: [] },
      hivemind_tasks: { rows: [] },
    });
    const res = await createFinancialAuditWorkOrderCore(sb, WS, null, "renewals_audit", {});
    expect(res.audit.records_inspected).toBe(2);
    const inactive = res.audit.exceptions.find((e) => e.record_id === "s1")!;
    expect(inactive.issue).toMatch(/inactive/i);
    expect(inactive.amount_cents).toBe(50000);
    const missed = res.audit.exceptions.find((e) => e.record_id === "s2")!;
    expect(missed.issue).toMatch(/has not generated/i);
    expect(missed.amount_cents).toBe(60000);
    expect(res.audit.totals.missed_this_month_cents).toBe(60000);
  });

  it("outgoings audit: new provider spend and >1.5× spikes become typed USD exceptions", async () => {
    const now = new Date();
    const thisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 2)).toISOString();
    const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 2)).toISOString();
    const { sb, inserted } = makeSb({
      provider_usage_log: {
        rows: [
          // Spike: 10 this month vs 4 last month (>1.5×).
          { provider_category: "voice", provider_name: "retell", cost_usd: 10, created_at: thisMonth },
          { provider_category: "voice", provider_name: "retell", cost_usd: 4, created_at: lastMonth },
          // New spend: no baseline last month.
          { provider_category: "llm", provider_name: "openai", cost_usd: 2.5, created_at: thisMonth },
          // Steady: 3 vs 3 — no exception.
          { provider_category: "whatsapp", provider_name: "twilio", cost_usd: 3, created_at: thisMonth },
          { provider_category: "whatsapp", provider_name: "twilio", cost_usd: 3, created_at: lastMonth },
        ],
      },
      work_orders: { rows: [] },
      hivemind_tasks: { rows: [] },
    });
    const res = await createFinancialAuditWorkOrderCore(sb, WS, null, "outgoings_audit", {});
    expect(res.audit.kind).toBe("outgoings_audit");
    expect(res.audit.currency).toBe("USD");
    const spike = res.audit.exceptions.find((e: any) => e.record_id === "voice:retell") as any;
    const fresh = res.audit.exceptions.find((e: any) => e.record_id === "llm:openai") as any;
    const steady = res.audit.exceptions.find((e: any) => e.record_id === "whatsapp:twilio");
    expect(spike.amount_cents).toBe(1000);
    expect(spike.issue).toMatch(/1\.5×/);
    expect(fresh.amount_cents).toBe(250);
    expect(fresh.issue).toMatch(/no spend last month/i);
    expect(steady).toBeUndefined();
    expect(res.audit.totals.month_to_date_cents).toBe(1550);
    expect(inserted.work_orders!.length).toBe(1);
  });

  it("clean audit → honest 'no exceptions' diagnosis, still review-gated", async () => {
    const { sb } = makeSb({
      accountsmind_invoices: { rows: [] },
      work_orders: { rows: [] },
      hivemind_tasks: { rows: [] },
    });
    const res = await createFinancialAuditWorkOrderCore(sb, WS, null, "invoice_audit", {});
    expect(res.audit.exceptions).toHaveLength(0);
    expect(res.tasks[0].intelligence_packet.diagnosis).toMatch(/no exceptions found/i);
  });

  it("WBAH workspace is hard-excluded", async () => {
    const { sb } = makeSb({});
    await expect(createFinancialAuditWorkOrderCore(sb, WBAH_WORKSPACE_ID, null, "invoice_audit", {})).rejects.toThrow(/wbah/i);
  });
});

// ── Legacy shallow-task migration (section 20) ───────────────────────────────
describe("Legacy task classifier", () => {
  const base = { status: "suggested", source: "ai_scan", created_at: new Date().toISOString(), metadata: {} };

  it("classifies all seven classes deterministically", () => {
    const old = new Date(Date.now() - 120 * 86400000).toISOString();
    const rows = [
      { ...base, id: "t-invalid", title: "" },
      { ...base, id: "t-human", title: "Call the accountant", source: "manual" },
      { ...base, id: "t-closed", title: "Old closed row", status: "completed" },
      { ...base, id: "t-dup-old", title: "Follow up lead X", trigger_type: "followup", entity_type: "lead", entity_id: "L1", created_at: "2026-01-01" },
      { ...base, id: "t-dup-new", title: "Follow up lead X again", trigger_type: "followup", entity_type: "lead", entity_id: "L1", created_at: "2026-07-01", description: "Chase lead X about the proposal we sent." },
      { ...base, id: "t-superseded", title: "Review pipeline stage", trigger_type: "pipeline_review", entity_type: "workspace", entity_id: "W1", description: "Legacy pipeline check with plenty of detail." },
      { ...base, id: "t-modern", title: "Modern pipeline review", trigger_type: "pipeline_review", entity_type: "workspace", entity_id: "W1", intelligence_packet: { version: 1 } },
      { ...base, id: "t-stale", title: "Ancient reminder about something", created_at: old },
      { ...base, id: "t-thin", title: "Check", description: "" },
      { ...base, id: "t-conv", title: "Chase overdue invoice INV-9", description: "Client Acme has not paid invoice INV-9; chase before month end.", trigger_type: "invoice_overdue", entity_type: "invoice", entity_id: "I9" },
    ];
    const map = Object.fromEntries(classifyLegacyTaskRows(rows).map((c) => [c.taskId, c.klass]));
    expect(map["t-invalid"]).toBe("invalid");
    expect(map["t-human"]).toBe("human_task");
    expect(map["t-closed"]).toBe("obsolete");
    expect(map["t-dup-old"]).toBe("duplicate");
    expect(map["t-superseded"]).toBe("superseded");
    expect(map["t-stale"]).toBe("obsolete");
    expect(map["t-thin"]).toBe("missing_context");
    expect(map["t-conv"]).toBe("convertible");
  });

  it("conversion packet is built ONLY from the row's own fields and is never executable", () => {
    const row = {
      id: "t1", title: "Chase overdue invoice INV-9", mind: "accountsmind",
      description: "Client Acme has not paid invoice INV-9; chase before month end.",
      trigger_type: "invoice_overdue", entity_type: "invoice", entity_id: "I9",
      created_at: "2026-05-01", source: "ai_scan",
    };
    const packet = buildLegacyConversionPacket(row);
    expect(packet.intent.source).toBe("legacy_migration:convert");
    expect(packet.evidence[0].description).toContain("INV-9");
    expect(packet.approval_scope.kind).toBe("review");
    expect(packet.limitations.join(" ")).toMatch(/never executable/i);
  });

  it("migrateLegacyTasks converts convertible rows (informational only) and dismisses obsolete rows", async () => {
    const old = new Date(Date.now() - 120 * 86400000).toISOString();
    const { sb, updated } = makeSb({
      hivemind_tasks: {
        rows: [
          { id: "t-conv", title: "Chase overdue invoice INV-9", description: "Client Acme has not paid invoice INV-9; chase before month end.", status: "suggested", source: "ai_scan", trigger_type: "invoice_overdue", entity_type: "invoice", entity_id: "I9", created_at: new Date().toISOString(), metadata: {}, intelligence_packet: null, readiness_state: null },
          { id: "t-stale", title: "Ancient reminder about something", description: "", status: "suggested", source: "ai_scan", created_at: old, metadata: {}, intelligence_packet: null, readiness_state: null },
        ],
      },
    });
    const res = await migrateLegacyTasks(sb, WS, {});
    expect(res.scanned).toBe(2);
    expect(res.converted).toBe(1);
    expect(res.disabled).toBe(1);
    const patches = updated.hivemind_tasks!;
    const convPatch = patches.find((p) => p.intelligence_packet);
    expect(convPatch.task_category).toBe("informational");
    expect(convPatch.action_kind).toBeNull();
    expect(convPatch.metadata.legacy_migration.class).toBe("convertible");
    const dismissPatch = patches.find((p) => p.status === "dismissed");
    expect(dismissPatch.metadata.legacy_migration.class).toBe("obsolete");
  });

  it("migrateLegacyTasks dismisses open duplicate and superseded rows with their labels", async () => {
    const { sb, updated } = makeSb({
      hivemind_tasks: {
        rows: [
          { id: "t-dup-old", title: "Follow up lead X", status: "suggested", source: "ai_scan", trigger_type: "followup", entity_type: "lead", entity_id: "L1", created_at: "2026-01-01", metadata: {}, intelligence_packet: null, readiness_state: null },
          { id: "t-dup-new", title: "Follow up lead X again", description: "Chase lead X about the proposal we sent.", status: "suggested", source: "ai_scan", trigger_type: "followup", entity_type: "lead", entity_id: "L1", created_at: "2026-07-01", metadata: {}, intelligence_packet: null, readiness_state: null },
          { id: "t-superseded", title: "Review pipeline stage", description: "Legacy pipeline check with plenty of detail.", status: "suggested", source: "ai_scan", trigger_type: "pipeline_review", entity_type: "workspace", entity_id: "W1", created_at: "2026-07-01", metadata: {}, intelligence_packet: null, readiness_state: null },
          { id: "t-modern", title: "Modern pipeline review", status: "suggested", source: "ai_scan", trigger_type: "pipeline_review", entity_type: "workspace", entity_id: "W1", created_at: "2026-07-02", metadata: {}, intelligence_packet: { version: 1 }, readiness_state: "ready_for_review" },
        ],
      },
    });
    const res = await migrateLegacyTasks(sb, WS, {});
    // t-modern already has a packet, so only the 3 legacy rows are scanned.
    expect(res.scanned).toBe(3);
    const patches = updated.hivemind_tasks!;
    const dismissed = patches.filter((p) => p.status === "dismissed");
    const dismissedClasses = dismissed.map((p) => p.metadata.legacy_migration.class).sort();
    expect(dismissedClasses).toContain("duplicate");
    expect(dismissedClasses).toContain("superseded");
    // Dismissed rows are never made executable.
    for (const p of dismissed) {
      expect(p.intelligence_packet).toBeUndefined();
      expect(p.action_kind ?? null).toBeNull();
    }
  });

  it("WBAH workspace is hard-excluded from migration", async () => {
    const { sb } = makeSb({});
    await expect(migrateLegacyTasks(sb, WBAH_WORKSPACE_ID, {})).rejects.toThrow(/wbah/i);
  });
});

// ── Cross-channel orchestration (section 21) ─────────────────────────────────
describe("Cross-channel objective orchestration", () => {
  const richTables = () => ({
    leads: {
      rows: [
        { id: "l1", email: "a@x.com", phone: "+447700900001", whatsapp_opt_in: false, status: "need_to_call" },
        { id: "l2", email: "b@x.com", phone: null, whatsapp_opt_in: false, status: "need_to_call" },
        { id: "l3", email: null, phone: "+447700900003", whatsapp_opt_in: false, status: "need_to_call" },
      ],
    },
    suppressed_emails: { rows: [{ email: "b@x.com" }] },
    workspace_settings: { rows: [{ whatsapp_provider: null }] },
    agents: { rows: [{ id: "a1", name: "Ava", retell_agent_id: "agent_x" }] },
    growthmind_social_connections: { rows: [] },
    growthmind_gsc_sync_state: { rows: [] },
    work_orders: { rows: [] },
    hivemind_tasks: { rows: [] },
  });

  it("assessChannelEvidence justifies only channels backed by real evidence", async () => {
    const { sb } = makeSb(richTables());
    const a = await assessChannelEvidence(sb, WS, evidenceItem);
    const byCh = Object.fromEntries(a.map((x) => [x.channel, x]));
    expect(byCh.email.justified).toBe(true);
    expect(byCh.email.reason).toMatch(/1 contactable lead/i); // b@x.com suppressed
    expect(byCh.calls.justified).toBe(true);
    expect(byCh.whatsapp.justified).toBe(false);
    expect(byCh.whatsapp.reason).toMatch(/no whatsapp provider/i);
    expect(byCh.social.justified).toBe(false);
    expect(byCh.seo.justified).toBe(false);
    expect(byCh.seo.reason).toMatch(/not connected/i);
  });

  it("creates ONE parent work order + strategy task + dependency-linked children ONLY for justified channels", async () => {
    const { sb, inserted } = makeSb(richTables());
    const res = await createCrossChannelObjectiveWorkOrderCore(sb, WS, null, {
      objective: "Generate more WEBEE Receptionist leads in the UK",
    });
    // ONE parent work order.
    expect(inserted.work_orders).toHaveLength(1);
    expect(inserted.work_orders![0].metadata.orchestration_kind).toBe("cross_channel_objective");
    // Justified: email + calls only; others skipped with reasons.
    expect(res.justified.map((j) => j.channel).sort()).toEqual(["calls", "email"]);
    expect(res.skipped.map((s) => s.channel).sort()).toEqual(["seo", "social", "whatsapp"]);
    expect(inserted.work_orders![0].metadata.skipped_channels).toHaveLength(3);
    for (const s of inserted.work_orders![0].metadata.skipped_channels) {
      expect(s.reason.length).toBeGreaterThan(10);
    }
    // Strategy first; children depend on it.
    expect(res.channelTasks).toHaveLength(2);
    for (const t of res.channelTasks) {
      expect(t.dependencies).toEqual([String(res.strategyTask.id)]);
      expect(t.work_order_id).toBe(res.workOrder.id);
      // Channel task carries its own channel-specific evidence + own approval.
      expect(t.intelligence_packet.approval_scope.summary).toMatch(/channel plan/i);
      expect((t.intelligence_packet.blockers as any[]).some((b) => /awaiting channel strategy approval/i.test(b.detail))).toBe(true);
    }
    // Shared success criteria + reporting recorded on the parent.
    expect(inserted.work_orders![0].metadata.shared_success_criteria.length).toBeGreaterThan(0);
    expect(inserted.work_orders![0].metadata.reporting_plan).toMatch(/every 7 days/i);
    // Never authorises sending: strategy approval scope is review, not send.
    expect(res.strategyTask.intelligence_packet.approval_scope.kind).toBe("review");
  });

  it("no justified channels → parent blocked with honest blocker, zero child tasks", async () => {
    const t = richTables();
    t.leads = { rows: [] };
    t.agents = { rows: [] };
    const { sb, inserted } = makeSb(t);
    const res = await createCrossChannelObjectiveWorkOrderCore(sb, WS, null, {
      objective: "Generate more WEBEE Receptionist leads in the UK",
    });
    expect(res.justified).toHaveLength(0);
    expect(res.channelTasks).toHaveLength(0);
    expect(inserted.work_orders![0].readiness_state).toBe("blocked");
    expect((inserted.work_orders![0].intelligence_packet.blockers as any[])[0].detail).toMatch(/no channel is currently evidence-justified/i);
  });

  it("rejects vague objectives and WBAH", async () => {
    const { sb } = makeSb(richTables());
    await expect(createCrossChannelObjectiveWorkOrderCore(sb, WS, null, { objective: "leads" })).rejects.toThrow(/objective/i);
    await expect(createCrossChannelObjectiveWorkOrderCore(sb, WBAH_WORKSPACE_ID, null, { objective: "Generate more leads in the UK now" })).rejects.toThrow(/wbah/i);
  });
});
