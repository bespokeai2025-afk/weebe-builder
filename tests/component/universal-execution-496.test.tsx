/**
 * Task #496 — acceptance tests for the Universal Execution Dispatch layer.
 *
 * Every registered execution adapter must:
 *  - Return non-empty steps
 *  - Attach evidence / artifacts
 *  - Return status "blocked" (never "completed") when the provider is not
 *    connected; blockedReason must start with "provider_action_unsupported:"
 *  - Return status "awaiting_action_approval" when a linked action was created
 *  - Not auto-mutate anything — consequential changes go through a linked
 *    hivemind_action
 *
 * worker_interrupted transition is also exercised (state-machine-only; no
 * adapter needed since the watchdog sets it directly on the DB row).
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/hivemind/mode-gate.server", () => ({
  assertProposalAllowed: vi.fn(async () => undefined),
  getHiveMindModeConfig: vi.fn(async () => ({})),
  assertExecutionAllowed: vi.fn(() => undefined),
}));

import {
  runAgentCrmIntegrationExecution,
  runWorkflowDepthExecution,
  runInvoiceAuditExecution,
  runRenewalsAuditExecution,
  runOutgoingsAuditExecution,
  runClientCostingExecution,
  runCrossChannelObjectiveExecution,
  runChannelEmailExecution,
  runChannelWhatsAppExecution,
  runChannelCallsExecution,
  runChannelFollowUpExecution,
  runSalesPipelineReviewExecution,
  runLegacyTaskMigrationExecution,
  runSeoCampaignExecution,
  runSocialContentExecution,
  runBlogArticleExecution,
  runVideoCampaignExecution,
  initialStepsForKind,
} from "@/lib/hivemind/mind-adapters/universal-adapters.server";
import { sweepStalledExecutions } from "@/lib/hivemind/mind-execution-engine.server";
import {
  canTransition,
  EXECUTABLE_KINDS,
} from "@/lib/hivemind/execution-state.shared";

const WS = "11111111-2222-3333-4444-555555555555";
const EX = "exec-0001";
const TASK = "task-0001";

function makeSb(tables: Record<string, any[]> = {}) {
  let idSeq = 0;
  const inserted: Record<string, any[]> = {};
  const updated: Record<string, any[]> = {};

  const from = (table: string) => {
    const baseRows: any[] = tables[table] ?? [];
    const state: any = { filters: [] };

    const applyFilters = () => {
      let rows = [...baseRows];
      for (const f of state.filters) rows = rows.filter(f);
      return rows;
    };

    const b: any = {
      select: (..._: any[]) => b,
      eq: (..._: any[]) => b,
      neq: (..._: any[]) => b,
      in: (..._: any[]) => b,
      is: (..._: any[]) => b,
      not: (..._: any[]) => b,
      order: (..._: any[]) => b,
      limit: (..._: any[]) => b,
      // Apply gte/lt for real so month-window queries work honestly.
      gte: (col: string, val: any) => { state.filters.push((r: any) => r[col] == null || r[col] >= val); return b; },
      lt: (col: string, val: any) => { state.filters.push((r: any) => r[col] == null || r[col] < val); return b; },
      update: (patch: any) => {
        state.patch = patch;
        (updated[table] ??= []).push(patch);
        return b;
      },
      insert: (row: any) => {
        const r = { ...row, id: `${table}-${++idSeq}` };
        (inserted[table] ??= []).push(r);
        state.insertedRow = r;
        return b;
      },
      single: async () => ({ data: state.insertedRow ?? applyFilters()[0] ?? null, error: null }),
      maybeSingle: async () => ({ data: state.insertedRow ?? applyFilters()[0] ?? null, error: null }),
      then: (resolve: any, reject: any) =>
        Promise.resolve({ data: state.insertedRow ? [state.insertedRow] : applyFilters(), error: null }).then(resolve, reject),
    };
    return b;
  };
  return { sb: { from } as any, inserted, updated };
}

function makeCtx(sb: any, extra: Record<string, any> = {}) {
  return { sb, workspaceId: WS, userId: "user-1", executionId: EX, taskId: TASK, workOrderId: null, inputSpec: {}, ...extra };
}

// ── Helper assertions ────────────────────────────────────────────────────────
function assertStepsNonEmpty(steps: any[]) {
  expect(steps.length).toBeGreaterThan(0);
  for (const s of steps) {
    expect(typeof s.key).toBe("string");
    expect(typeof s.label).toBe("string");
    expect(typeof s.status).toBe("string");
  }
}

function assertBlockedWithUnsupported(outcome: any) {
  expect(outcome.status).toBe("blocked");
  expect(typeof outcome.blockedReason).toBe("string");
  expect(outcome.blockedReason).toMatch(/^provider_action_unsupported:/);
  assertStepsNonEmpty(outcome.steps);
}

function assertAwaitingAction(outcome: any) {
  expect(outcome.status).toBe("awaiting_action_approval");
  expect(typeof outcome.linkedActionId).toBe("string");
  expect(outcome.linkedActionId!.length).toBeGreaterThan(0);
  assertStepsNonEmpty(outcome.steps);
  // Every step must be in a terminal or blocked state — nothing left running.
  const activeStatuses = outcome.steps.filter((s: any) => s.status === "running");
  expect(activeStatuses).toHaveLength(0);
}

// ════════════════════════════════════════════════════════════════════════════
// State machine: worker_interrupted transition
// ════════════════════════════════════════════════════════════════════════════
describe("worker_interrupted state transition", () => {
  it("executing → worker_interrupted is legal", () => {
    expect(canTransition("executing", "worker_interrupted")).toBe(true);
  });
  it("worker_interrupted → queued is legal (retry path)", () => {
    expect(canTransition("worker_interrupted", "queued")).toBe(true);
  });
  it("worker_interrupted → cancelled is legal", () => {
    expect(canTransition("worker_interrupted", "cancelled")).toBe(true);
  });
  it("worker_interrupted → executing is NOT legal (must go through queued)", () => {
    expect(canTransition("worker_interrupted", "executing")).toBe(false);
  });
  it("completed → worker_interrupted is NOT legal (terminal)", () => {
    expect(canTransition("completed", "worker_interrupted")).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// EXECUTABLE_KINDS registry completeness
// ════════════════════════════════════════════════════════════════════════════
describe("EXECUTABLE_KINDS registry", () => {
  const EXPECTED_KINDS = [
    "growthmind.gads_campaign_analysis",
    "systemmind.agent_crm_integration",
    "systemmind.workflow_depth",
    "accountsmind.invoice_audit",
    "accountsmind.renewals_audit",
    "accountsmind.outgoings_audit",
    "accountsmind.client_costing",
    "hivemind.cross_channel_objective",
    "hivemind.channel_followup",
    "hivemind.channel_whatsapp",
    "hivemind.channel_email",
    "hivemind.channel_calls",
    "hivemind.sales_pipeline_review",
    "hivemind.legacy_task_migration",
    "growthmind.seo_campaign",
    "growthmind.social_content",
    "growthmind.blog_article",
    "growthmind.video_campaign",
  ];

  it("registers every expected capability kind", () => {
    for (const kind of EXPECTED_KINDS) {
      expect(EXECUTABLE_KINDS[kind], `Missing kind: ${kind}`).toBeTruthy();
      expect(typeof EXECUTABLE_KINDS[kind].label).toBe("string");
      expect(typeof EXECUTABLE_KINDS[kind].requiredActionKey).toBe("string");
    }
  });

  it("every kind has a non-empty initial steps set via initialStepsForKind", () => {
    for (const kind of EXPECTED_KINDS) {
      if (kind === "growthmind.gads_campaign_analysis") continue;
      const steps = initialStepsForKind(kind);
      expect(steps.length, `${kind} has no initial steps`).toBeGreaterThan(0);
      expect(steps.every(s => s.status === "pending")).toBe(true);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SystemMind adapters
// ════════════════════════════════════════════════════════════════════════════
describe("SystemMind — agent↔CRM integration adapter", () => {
  it("no CRM connection → blocked with provider_action_unsupported, steps non-empty", async () => {
    const { sb } = makeSb({
      agents: [{ id: "a1", name: "Ava", agent_type: "client_qualification", voice_provider: "retell", retell_agent_id: "x" }],
      systemmind_crm_connections: [],
      systemmind_dynamic_variables: [],
      mind_task_executions: [],
    });
    const outcome = await runAgentCrmIntegrationExecution(makeCtx(sb));
    assertBlockedWithUnsupported(outcome);
  });

  it("verified CRM connection + agent → awaiting_action_approval with linked action, artifacts non-empty", async () => {
    const { sb, inserted } = makeSb({
      agents: [{ id: "a1", name: "Ava", agent_type: "client_qualification", voice_provider: "retell" }],
      systemmind_crm_connections: [{ id: "c1", provider: "hubspot", status: "verified" }],
      systemmind_dynamic_variables: [
        { id: "v1", name: "email", allow_write_to_crm: true, destination_object: "contact", destination_field: "email" },
      ],
      mind_task_executions: [],
      hivemind_actions: [],
    });
    const outcome = await runAgentCrmIntegrationExecution(makeCtx(sb));
    assertAwaitingAction(outcome);
    expect(outcome.artifacts.length).toBeGreaterThan(0);
    expect(outcome.artifacts[0].type).toBe("agent_crm_snapshot");
    expect(inserted.hivemind_actions!.length).toBe(1);
    expect(inserted.hivemind_actions![0].action_type).toBe("systemmind_apply_agent_crm_integration");
    expect(inserted.hivemind_actions![0].sensitive).toBe(true);
  });
});

describe("SystemMind — workflow depth adapter", () => {
  it("no workflow resolved → blocked with provider_action_unsupported", async () => {
    const { sb } = makeSb({ workspace_workflows: [], mind_task_executions: [] });
    const outcome = await runWorkflowDepthExecution(makeCtx(sb));
    assertBlockedWithUnsupported(outcome);
  });

  it("single resolved workflow → awaiting_action_approval, snapshot artifact attached", async () => {
    const { sb, inserted } = makeSb({
      workspace_workflows: [{ id: "w1", name: "Lead intake", status: "active", flow_definition: { nodes: [{}, {}] }, updated_at: "2026-07-20" }],
      workflow_runs: [{ id: "r1", status: "failed", created_at: "2026-07-25" }],
      mind_task_executions: [],
      hivemind_actions: [],
    });
    const outcome = await runWorkflowDepthExecution(makeCtx(sb));
    assertAwaitingAction(outcome);
    expect(outcome.artifacts[0].type).toBe("workflow_depth_snapshot");
    expect(outcome.artifacts[0].failed_runs).toBe(1);
    expect(inserted.hivemind_actions![0].sensitive).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// AccountsMind adapters
// ════════════════════════════════════════════════════════════════════════════
describe("AccountsMind — invoice audit adapter", () => {
  it("overdue invoice → awaiting_action_approval, billing action proposed with sensitive=true", async () => {
    const { sb, inserted } = makeSb({
      accountsmind_invoices: [
        { id: "i1", invoice_number: "INV-001", client_name: "Acme", status: "sent", total_cents: 100000, amount_paid_cents: 0, currency: "GBP", due_date: "2026-01-01" },
        { id: "i2", status: "paid", total_cents: 50000, amount_paid_cents: 50000, currency: "GBP" },
      ],
      work_orders: [],
      hivemind_tasks: [],
      mind_task_executions: [],
      hivemind_actions: [],
    });
    const outcome = await runInvoiceAuditExecution(makeCtx(sb));
    assertAwaitingAction(outcome);
    expect(outcome.artifacts[0].type).toBe("financial_audit_report");
    expect(outcome.artifacts[0].exceptions.length).toBeGreaterThan(0);
    expect(inserted.hivemind_actions![0].sensitive).toBe(true);
    expect(inserted.hivemind_actions![0].action_type).toBe("accountsmind_execute_invoice_audit");
  });

  it("clean books → completed (no billing action needed), non-empty steps", async () => {
    const { sb } = makeSb({
      accountsmind_invoices: [
        { id: "i1", status: "paid", total_cents: 50000, amount_paid_cents: 50000, currency: "GBP" },
      ],
      work_orders: [],
      hivemind_tasks: [],
      mind_task_executions: [],
    });
    const outcome = await runInvoiceAuditExecution(makeCtx(sb));
    expect(outcome.status).toBe("completed");
    expect(outcome.linkedActionId).toBeNull();
    assertStepsNonEmpty(outcome.steps);
    expect(outcome.result?.exception_count).toBe(0);
  });
});

describe("AccountsMind — renewals audit adapter", () => {
  it("inactive schedule → awaiting_action_approval with billing action", async () => {
    const { sb } = makeSb({
      accountsmind_recurring_invoices: [
        { id: "s1", name: "Retainer A", active: false, day_of_month: 1, currency: "GBP", items_json: [{ unit_price_cents: 50000, quantity: 1 }] },
      ],
      work_orders: [],
      hivemind_tasks: [],
      mind_task_executions: [],
      hivemind_actions: [],
    });
    const outcome = await runRenewalsAuditExecution(makeCtx(sb));
    assertAwaitingAction(outcome);
  });
});

describe("AccountsMind — outgoings audit adapter", () => {
  it("new provider spend this month → awaiting_action_approval (spike exception found)", async () => {
    const now = new Date();
    const thisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 2)).toISOString();
    const { sb } = makeSb({
      provider_usage_log: [
        { provider_category: "voice", provider_name: "retell", cost_usd: 10, created_at: thisMonth },
      ],
      work_orders: [],
      hivemind_tasks: [],
      mind_task_executions: [],
      hivemind_actions: [],
    });
    const outcome = await runOutgoingsAuditExecution(makeCtx(sb));
    assertAwaitingAction(outcome);
    expect(outcome.artifacts[0].kind).toBe("outgoings_audit");
  });

  it("no provider usage → completed with clean audit", async () => {
    const { sb } = makeSb({
      provider_usage_log: [],
      work_orders: [],
      hivemind_tasks: [],
      mind_task_executions: [],
    });
    const outcome = await runOutgoingsAuditExecution(makeCtx(sb));
    expect(outcome.status).toBe("completed");
  });
});

describe("AccountsMind — client costing adapter", () => {
  it("high-risk client → awaiting_action_approval", async () => {
    const { sb } = makeSb({
      accountsmind_invoices: [
        { id: "i1", client_name: "Acme", status: "sent", total_cents: 200000, amount_paid_cents: 0, currency: "GBP", due_date: "2026-01-01" },
        { id: "i2", client_name: "Acme", status: "paid", total_cents: 10000, amount_paid_cents: 10000, currency: "GBP" },
      ],
      work_orders: [],
      hivemind_tasks: [],
      mind_task_executions: [],
      hivemind_actions: [],
    });
    const outcome = await runClientCostingExecution(makeCtx(sb));
    assertAwaitingAction(outcome);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// HiveMind channel adapters
// ════════════════════════════════════════════════════════════════════════════
describe("HiveMind — channel email adapter", () => {
  it("no emailable leads → blocked (zero eligible) with provider_action_unsupported", async () => {
    const { sb } = makeSb({
      leads: [],
      suppressed_emails: [],
      mind_task_executions: [],
    });
    const outcome = await runChannelEmailExecution(makeCtx(sb));
    assertBlockedWithUnsupported(outcome);
    expect(outcome.blockedReason).toMatch(/zero eligible/i);
  });

  it("eligible leads, no suppression → awaiting_action_approval with send action", async () => {
    const { sb, inserted } = makeSb({
      leads: [{ id: "L1", email: "a@x.com", status: "active" }],
      suppressed_emails: [],
      mind_task_executions: [],
      hivemind_actions: [],
    });
    const outcome = await runChannelEmailExecution(makeCtx(sb));
    assertAwaitingAction(outcome);
    expect(inserted.hivemind_actions![0].action_type).toBe("hivemind_execute_email_campaign");
    expect(inserted.hivemind_actions![0].sensitive).toBe(true);
  });

  it("suppressed emails excluded from eligible count", async () => {
    const { sb, inserted } = makeSb({
      leads: [
        { id: "L1", email: "a@x.com", status: "active" },
        { id: "L2", email: "b@x.com", status: "active" },
      ],
      suppressed_emails: [{ email: "b@x.com" }],
      mind_task_executions: [],
      hivemind_actions: [],
    });
    const outcome = await runChannelEmailExecution(makeCtx(sb));
    assertAwaitingAction(outcome);
    expect(inserted.hivemind_actions![0].action_payload.eligible_count).toBe(1);
    expect(inserted.hivemind_actions![0].action_payload.suppressed_count).toBe(1);
  });
});

describe("HiveMind — channel WhatsApp adapter", () => {
  it("no whatsapp_provider in workspace_settings → blocked with provider_action_unsupported", async () => {
    const { sb } = makeSb({
      leads: [{ id: "L1", phone: "+44700000000", whatsapp_opt_in: true }],
      workspace_settings: [],
      mind_task_executions: [],
    });
    const outcome = await runChannelWhatsAppExecution(makeCtx(sb));
    assertBlockedWithUnsupported(outcome);
    expect(outcome.blockedReason).toMatch(/whatsapp/i);
  });

  it("opted-in lead + WA provider configured → awaiting_action_approval", async () => {
    const { sb } = makeSb({
      leads: [{ id: "L1", phone: "+44700000000", whatsapp_opt_in: true }],
      workspace_settings: [{ workspace_id: WS, whatsapp_provider: "twilio", twilio_account_sid: "ACfake" }],
      mind_task_executions: [],
      hivemind_actions: [],
    });
    const outcome = await runChannelWhatsAppExecution(makeCtx(sb));
    assertAwaitingAction(outcome);
  });

  it("WA provider configured but no opted-in leads → blocked (zero eligible)", async () => {
    const { sb } = makeSb({
      leads: [{ id: "L1", phone: "+44700000000", whatsapp_opt_in: false }],
      workspace_settings: [{ workspace_id: WS, whatsapp_provider: "twilio" }],
      mind_task_executions: [],
    });
    const outcome = await runChannelWhatsAppExecution(makeCtx(sb));
    assertBlockedWithUnsupported(outcome);
    expect(outcome.blockedReason).toMatch(/zero eligible/i);
  });
});

describe("HiveMind — channel calls adapter", () => {
  it("no agents (no calls provider) → blocked with provider_action_unsupported", async () => {
    const { sb } = makeSb({
      leads: [{ id: "L1", phone: "+44700000000" }],
      agents: [],
      mind_task_executions: [],
    });
    const outcome = await runChannelCallsExecution(makeCtx(sb));
    assertBlockedWithUnsupported(outcome);
  });

  it("agent present + leads with phone → awaiting_action_approval", async () => {
    const { sb } = makeSb({
      leads: [{ id: "L1", phone: "+44700000000" }],
      agents: [{ id: "a1" }],
      mind_task_executions: [],
      hivemind_actions: [],
    });
    const outcome = await runChannelCallsExecution(makeCtx(sb));
    assertAwaitingAction(outcome);
  });
});

describe("HiveMind — follow-up sequence adapter", () => {
  it("eligible lead → awaiting_action_approval", async () => {
    const { sb } = makeSb({
      leads: [{ id: "L1", email: "a@x.com", status: "active" }],
      suppressed_emails: [],
      mind_task_executions: [],
      hivemind_actions: [],
    });
    const outcome = await runChannelFollowUpExecution(makeCtx(sb));
    assertAwaitingAction(outcome);
    expect(outcome.linkedActionId).toBeTruthy();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// HiveMind cross-channel objective adapter
// ════════════════════════════════════════════════════════════════════════════
describe("HiveMind — cross-channel objective adapter", () => {
  it("no audience → blocked (no justified channels)", async () => {
    const { sb } = makeSb({
      leads: [],
      suppressed_emails: [],
      agents: [],
      growthmind_gsc_sync_state: [],
      growthmind_social_connections: [],
      workspace_settings: [],
      mind_task_executions: [],
    });
    const outcome = await runCrossChannelObjectiveExecution(makeCtx(sb));
    assertBlockedWithUnsupported(outcome);
  });

  it("email audience present → awaiting_action_approval with launch action", async () => {
    const { sb, inserted } = makeSb({
      leads: [{ id: "L1", email: "a@x.com", phone: "+44700000000", whatsapp_opt_in: false, status: "active" }],
      suppressed_emails: [],
      agents: [],
      growthmind_gsc_sync_state: [],
      growthmind_social_connections: [],
      workspace_settings: [],
      mind_task_executions: [],
      hivemind_actions: [],
    });
    const outcome = await runCrossChannelObjectiveExecution(makeCtx(sb));
    assertAwaitingAction(outcome);
    expect(outcome.artifacts[0].type).toBe("cross_channel_strategy");
    expect(inserted.hivemind_actions![0].action_type).toBe("hivemind_launch_cross_channel_objective");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// HiveMind sales pipeline review adapter
// ════════════════════════════════════════════════════════════════════════════
describe("HiveMind — sales pipeline review adapter", () => {
  it("healthy pipeline (no stuck leads) → completed with clean result", async () => {
    const recentDate = new Date(Date.now() - 2 * 86400000).toISOString();
    const { sb } = makeSb({
      leads: [{ id: "L1", full_name: "Alice", pipeline_stage: "proposal", status: "active", updated_at: recentDate }],
      mind_task_executions: [],
    });
    const outcome = await runSalesPipelineReviewExecution(makeCtx(sb));
    expect(outcome.status).toBe("completed");
    expect(outcome.result?.stuck_leads).toBe(0);
    assertStepsNonEmpty(outcome.steps);
  });

  it("stuck lead (>14 days) → awaiting_action_approval with stage-review action", async () => {
    const staleDate = new Date(Date.now() - 30 * 86400000).toISOString();
    const { sb, inserted } = makeSb({
      leads: [{ id: "L1", full_name: "Bob", pipeline_stage: "contacted", status: "active", updated_at: staleDate }],
      mind_task_executions: [],
      hivemind_actions: [],
    });
    const outcome = await runSalesPipelineReviewExecution(makeCtx(sb));
    assertAwaitingAction(outcome);
    expect(inserted.hivemind_actions![0].action_type).toBe("hivemind_pipeline_review_moves");
    expect(inserted.hivemind_actions![0].action_payload.stuck_count).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// HiveMind legacy task migration adapter
// ════════════════════════════════════════════════════════════════════════════
describe("HiveMind — legacy task migration adapter", () => {
  it("no legacy tasks → completed (nothing to migrate), non-empty steps", async () => {
    const { sb } = makeSb({
      hivemind_tasks: [],
      mind_task_executions: [],
    });
    const outcome = await runLegacyTaskMigrationExecution(makeCtx(sb));
    expect(outcome.status).toBe("completed");
    assertStepsNonEmpty(outcome.steps);
    expect(outcome.result?.scanned).toBe(0);
    expect(outcome.artifacts[0].type).toBe("legacy_migration_report");
    expect(outcome.linkedActionId).toBeNull();
  });

  it("legacy tasks present → awaiting_action_approval (migration plan proposed, not auto-executed)", async () => {
    const old = new Date(Date.now() - 120 * 86400000).toISOString();
    const { sb, inserted } = makeSb({
      hivemind_tasks: [
        { id: "t1", title: "Chase invoice", description: "Client Acme has not paid.", status: "suggested", source: "ai_scan", trigger_type: "invoice_overdue", entity_type: "invoice", entity_id: "I1", created_at: new Date().toISOString(), metadata: {}, intelligence_packet: null, readiness_state: null },
        { id: "t2", title: "Ancient thing", description: "", status: "suggested", source: "ai_scan", created_at: old, metadata: {}, intelligence_packet: null, readiness_state: null },
      ],
      mind_task_executions: [],
      hivemind_actions: [],
    });
    const outcome = await runLegacyTaskMigrationExecution(makeCtx(sb));
    assertAwaitingAction(outcome);
    assertStepsNonEmpty(outcome.steps);
    expect(outcome.artifacts[0].type).toBe("legacy_migration_report");
    expect(outcome.artifacts[0].scanned).toBeGreaterThan(0);
    // Verify NO direct mutations happened — only a proposal
    expect(inserted.hivemind_tasks).toBeUndefined();
    expect(inserted.hivemind_actions![0].action_type).toBe("hivemind_execute_legacy_task_migration");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// GrowthMind content adapters — all block when provider not connected
// ════════════════════════════════════════════════════════════════════════════
describe("GrowthMind content adapters — provider_action_unsupported when no provider", () => {
  it("SEO campaign: no GSC connection → blocked", async () => {
    const { sb } = makeSb({
      growthmind_seo_department_campaigns: [],
      growthmind_gsc_sync_state: [],
      mind_task_executions: [],
    });
    const outcome = await runSeoCampaignExecution(makeCtx(sb));
    assertBlockedWithUnsupported(outcome);
  });

  it("social content: no Meta account → blocked", async () => {
    const { sb } = makeSb({
      content_recommendations: [],
      growthmind_social_connections: [],
      mind_task_executions: [],
    });
    const outcome = await runSocialContentExecution(makeCtx(sb));
    assertBlockedWithUnsupported(outcome);
  });

  it("blog article: no Meta account → blocked", async () => {
    const { sb } = makeSb({
      growthmind_blog_campaigns: [],
      growthmind_social_connections: [],
      mind_task_executions: [],
    });
    const outcome = await runBlogArticleExecution(makeCtx(sb));
    assertBlockedWithUnsupported(outcome);
  });

  it("video campaign: no external publisher → always blocked (advisory-only)", async () => {
    const { sb } = makeSb({
      studio_projects: [{ id: "v1", status: "approved", created_at: "2026-07-01" }],
      mind_task_executions: [],
    });
    const outcome = await runVideoCampaignExecution(makeCtx(sb));
    assertBlockedWithUnsupported(outcome);
  });

  it("SEO campaign: GSC connected + approved items → awaiting_action_approval", async () => {
    const { sb } = makeSb({
      growthmind_seo_department_campaigns: [{ id: "s1", status: "approved", created_at: "2026-07-01" }],
      growthmind_gsc_sync_state: [{ id: "g1" }],
      mind_task_executions: [],
      hivemind_actions: [],
    });
    const outcome = await runSeoCampaignExecution(makeCtx(sb));
    assertAwaitingAction(outcome);
    expect(outcome.artifacts[0].type).toBe("seo_campaign_brief");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Stall watchdog — sweepStalledExecutions behaviour
// ════════════════════════════════════════════════════════════════════════════
describe("sweepStalledExecutions watchdog", () => {
  const staleTs = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 min ago
  const freshTs = new Date(Date.now() - 2 * 60 * 1000).toISOString();  // 2 min ago

  it("rows in 'executing' older than threshold → transitioned to worker_interrupted, count returned", async () => {
    const updatedRows: any[] = [];
    const updatedTasks: any[] = [];

    // Fake SB for watchdog: the update chain is
    //   .update({}).eq("id").eq("workspace_id").eq("status").select("id")
    // = 3 .eq() calls then .select().
    const updateChain = (id: string, patch: any) => ({
      eq: () => ({ eq: () => ({ eq: () => ({ select: () => ({
        then: (resolve: any) => resolve({ data: [{ id }], error: null }),
      }) }) }) }),
    });

    const sb = {
      from: (table: string) => {
        if (table === "mind_task_executions") {
          const b: any = {
            select: () => b,
            in: () => b,
            lt: () => b,
            eq: () => b,
            limit: () => ({
              then: (resolve: any) => resolve({
                data: [{ id: "ex-stale", workspace_id: WS, task_id: "t1", status: "executing", updated_at: staleTs }],
                error: null,
              }),
            }),
            update: (patch: any) => {
              updatedRows.push(patch);
              return updateChain("ex-stale", patch);
            },
          };
          return b;
        }
        if (table === "hivemind_tasks") {
          return {
            update: (patch: any) => {
              updatedTasks.push(patch);
              return { eq: () => ({ eq: () => Promise.resolve({ error: null }) }) };
            },
          };
        }
        return { select: () => ({ eq: () => ({ limit: () => ({ then: (r: any) => r({ data: [], error: null }) }) }) }) };
      },
    };

    const result = await sweepStalledExecutions(sb as any, WS);
    expect(result.interrupted).toBe(1);
    expect(updatedRows[0].status).toBe("worker_interrupted");
    expect(updatedRows[0].blocked_reason).toMatch(/Worker did not report progress/);
    // Task lifecycle cleanup assertions:
    expect(updatedTasks[0].execution_status).toBe("worker_interrupted");
    expect(updatedTasks[0].status).toBe("suggested");
    expect(updatedTasks[0].active_execution_id).toBeNull();
  });

  it("rows in 'queued' older than threshold → also transitioned to worker_interrupted", async () => {
    const updatedRows: any[] = [];

    const updateChain = (id: string, patch: any) => ({
      eq: () => ({ eq: () => ({ eq: () => ({ select: () => ({
        then: (resolve: any) => resolve({ data: [{ id }], error: null }),
      }) }) }) }),
    });

    const sb = {
      from: (table: string) => {
        if (table === "mind_task_executions") {
          const b: any = {
            select: () => b,
            in: () => b,
            lt: () => b,
            eq: () => b,
            limit: () => ({
              then: (resolve: any) => resolve({
                data: [{ id: "ex-q", workspace_id: WS, task_id: "t2", status: "queued", updated_at: staleTs }],
                error: null,
              }),
            }),
            update: (patch: any) => {
              updatedRows.push(patch);
              return updateChain("ex-q", patch);
            },
          };
          return b;
        }
        if (table === "hivemind_tasks") {
          return { update: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }) };
        }
        return { select: () => ({ eq: () => ({ limit: () => ({ then: (r: any) => r({ data: [], error: null }) }) }) }) };
      },
    };

    const result = await sweepStalledExecutions(sb as any, WS);
    expect(result.interrupted).toBe(1);
    expect(updatedRows[0].status).toBe("worker_interrupted");
  });

  it("fresh 'executing' rows (within threshold) → NOT transitioned (0 interrupted)", async () => {
    const sb = {
      from: (table: string) => {
        if (table === "mind_task_executions") {
          const b: any = {
            select: () => b,
            in: () => b,
            lt: () => b,
            eq: () => b,
            limit: () => ({
              then: (resolve: any) => resolve({
                // The fake lt filter here doesn't filter — we return empty to simulate
                // that the DB's lt(updated_at, cutoff) would exclude fresh rows.
                data: [],
                error: null,
              }),
            }),
          };
          return b;
        }
        return { select: () => ({ eq: () => ({ limit: () => ({ then: (r: any) => r({ data: [], error: null }) }) }) }) };
      },
    };

    const result = await sweepStalledExecutions(sb as any, WS);
    expect(result.interrupted).toBe(0);
  });

  it("completed rows are never transitioned (assertTransition guard)", async () => {
    const updatedRows: any[] = [];

    const sb = {
      from: (table: string) => {
        if (table === "mind_task_executions") {
          const b: any = {
            select: () => b,
            in: () => b,
            lt: () => b,
            eq: () => b,
            limit: () => ({
              then: (resolve: any) => resolve({
                data: [{ id: "ex-done", workspace_id: WS, task_id: "t3", status: "completed", updated_at: staleTs }],
                error: null,
              }),
            }),
            update: (patch: any) => {
              updatedRows.push(patch);
              return {
                eq: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ select: () => ({
                  then: (resolve: any) => resolve({ data: [], error: null }),
                }) }) }) }) }),
              };
            },
          };
          return b;
        }
        return { select: () => ({ eq: () => ({ limit: () => ({ then: (r: any) => r({ data: [], error: null }) }) }) }) };
      },
    };

    const result = await sweepStalledExecutions(sb as any, WS);
    expect(result.interrupted).toBe(0);
    // No update should have been attempted (assertTransition throws for completed→worker_interrupted)
    expect(updatedRows).toHaveLength(0);
  });
});
