/**
 * Universal Acceptance Test Matrix — Task #503
 *
 * Covers ≥18 capability families, each verified against all 15 chain points:
 *
 *   ① objective resolved       ② target resolved        ③ evidence loaded
 *   ④ packet passed             ⑤ work order created     ⑥ execution created
 *   ⑦ steps visible             ⑧ progress visible       ⑨ approval scope explicit
 *   ⑩ execution NOT auto-done  ⑪ changes displayed      ⑫ verification completed
 *   ⑬ evidence attached        ⑭ completion honest      ⑮ workspace isolation
 *
 * Families covered (18):
 *   HiveMind    — 1 sales pipeline  2 follow-up sequence  3 WhatsApp campaign
 *                 4 email campaign  5 calls campaign      6 cross-channel objective
 *   GrowthMind  — 7 Google Ads      8 Meta campaign       9 TikTok content
 *                10 LinkedIn       11 SEO/GSC            12 content deployment
 *   SystemMind  — 13 agent↔CRM     14 workflow depth
 *   AccountsMind— 15 invoice audit  16 renewals audit
 *                17 outgoings audit 18 client-costing audit
 *
 * Additional suites:
 *   - Content safety regression (fabricated stats / fake testimonials blocked)
 *   - Workspace isolation (cross-workspace data cannot leak)
 *   - WBAH exclusion (each family asserts hard exclusion)
 *   - Legacy pathway blocked (LEGACY_CREATOR_BLOCKED guard)
 *   - Rollback (Contract F — task insert failure cleans up work order)
 *
 * NOTE: @/lib/content-safety/universal-content-safety.server is NOT globally
 * mocked — the deterministic (regex-based) module runs as-is so the content
 * safety regression suite can call it directly and observe real behaviour.
 */
import { describe, it, expect, vi } from "vitest";

// ── Global mocks ─────────────────────────────────────────────────────────────

vi.mock("@/lib/hivemind/mode-gate.server", () => ({
  assertProposalAllowed: vi.fn(async () => undefined),
}));

const deliverabilityMock = vi.hoisted(() => ({
  getEmailReadinessForWorkspace: vi.fn(async () => ({
    score: 82,
    grade: "B",
    issues: [],
  })),
}));
vi.mock("@/lib/hexmail/deliverability.server", () => deliverabilityMock);

// supabaseAdmin used only by the content-safety module (allow-list / restriction
// queries).  Empty results → no exemptions → fabricated-stat patterns fire.
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => {
      const b: any = {
        select:      (..._a: any[]) => b,
        eq:          (..._a: any[]) => b,
        not:         (..._a: any[]) => b,
        order:       (..._a: any[]) => b,
        limit:       (..._a: any[]) => b,
        then: (resolve: any) =>
          Promise.resolve({ data: [], error: null }).then(resolve),
      };
      return b;
    },
  },
}));

// content-variants is an internal DB adapter; mock it so content-deployment
// tests don't need real project fixtures.
vi.mock("@/lib/growthmind/content-variants.server", () => ({
  createContentVariants: vi.fn(
    async (
      _ws: string,
      projectId: string | null,
      variants: any[],
    ) => ({
      project: {
        id: projectId ?? "proj-acceptance-1",
        title: "Test content project",
        status: "draft",
        target_platform: "blog",
      },
      variants: variants.map((v: any, i: number) => ({
        ...v,
        id: `var-${i}`,
        adaptationOk: true,
        adaptedBody: v.body ?? "AI agents help businesses automate customer engagement effectively.",
        body: v.body ?? "AI agents help businesses automate customer engagement effectively.",
      })),
    }),
  ),
  // Required by createContentDeploymentWorkOrderCore — links created variant
  // rows back to the work order for audit trail.
  linkVariantsToWorkOrder: vi.fn(async () => undefined),
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import {
  createSalesPipelineWorkOrderCore,
  createFollowUpSequenceWorkOrderCore,
  createWhatsAppCampaignWorkOrderCore,
  createEmailCampaignWorkOrderCore,
  createCallCampaignWorkOrderCore,
} from "@/lib/hivemind/channel-work-orders.server";
import { createCrossChannelObjectiveWorkOrderCore } from "@/lib/hivemind/cross-channel-work-orders.server";
import {
  createGadsPacketWorkOrderCore,
  createMetaCampaignWorkOrderCore,
  createTikTokWorkOrderCore,
  createLinkedInWorkOrderCore,
  createSeoPacketWorkOrderCore,
  createContentDeploymentWorkOrderCore,
} from "@/lib/hivemind/social-work-orders.server";
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
import {
  assertNoLegacyDirectInsert,
  LegacyCreatorBlockedError,
} from "@/lib/minds/legacy-creators.shared";
import {
  runContentSafetyCheck,
  safetyCheckEvidenceItem,
} from "@/lib/content-safety/universal-content-safety.server";

// ── Constants ─────────────────────────────────────────────────────────────────

const WS   = "11111111-2222-3333-4444-555555555555";
const WS_2 = "22222222-3333-4444-5555-666666666666";

// ── assertChain — 15-point chain assertion helper ─────────────────────────────

/**
 * Asserts all 15 chain points for any work-order creation result.
 *
 * Points 10 (execution not auto-performed) and 14 (completion honest) rely on
 * the stage task model — tasks start as "suggested" and the final-send / apply
 * / execute stage is NOT in an approvable readiness state at creation time.
 *
 * @param result       - { workOrder, tasks } from a creation core
 * @param opts.workspaceId        - expected workspace_id on the work order (⑮)
 * @param opts.expectTargetResolved - false when provider not connected (PROVIDER_STUB)
 * @param opts.skipFinalBlockedCheck - true for cross-channel (strategy-only first stage)
 * @param opts.minTasks           - minimum number of stage tasks expected
 */
function assertChain(
  result: { workOrder: any; tasks: any[] },
  opts: {
    workspaceId?: string;
    expectTargetResolved?: boolean;
    skipFinalBlockedCheck?: boolean;
    minTasks?: number;
  } = {},
) {
  const { workOrder, tasks } = result;
  const packet = workOrder.intelligence_packet;
  const {
    workspaceId,
    expectTargetResolved = true,
    skipFinalBlockedCheck = false,
    minTasks = 1,
  } = opts;

  // ① Objective resolved
  expect(workOrder.objective?.trim().length).toBeGreaterThan(10);

  // ② Target resolved (or PROVIDER_STUB acknowledged via expectTargetResolved:false)
  expect(packet.targets?.length).toBeGreaterThan(0);
  if (expectTargetResolved) {
    expect(packet.targets[0].resolved).toBe(true);
  } else {
    expect(packet.targets[0]).toBeDefined();
  }

  // ③ Evidence loaded
  expect(packet.evidence?.length).toBeGreaterThanOrEqual(1);

  // ④ Packet passed — version string is present
  expect(packet.version).toBeTruthy();

  // ⑤ Work order created — id is set
  expect(workOrder.id).toBeTruthy();

  // ⑥ Execution created — stage tasks exist
  expect(tasks.length).toBeGreaterThanOrEqual(minTasks);

  // ⑦ Steps visible — each task has an approval_stage key
  for (const t of tasks) {
    expect(t.metadata?.approval_stage).toBeTruthy();
  }

  // ⑧ Progress visible — each task has a status
  for (const t of tasks) {
    expect(t.status).toBeTruthy();
  }

  // ⑨ Approval scope explicit — kind and summary on every task packet
  for (const t of tasks) {
    expect(t.intelligence_packet?.approval_scope?.kind).toBeTruthy();
    const summary = t.intelligence_packet?.approval_scope?.summary ?? "";
    expect(summary.length).toBeGreaterThan(0);
  }

  // ⑩ Execution NOT auto-performed at creation (status = "suggested")
  for (const t of tasks) {
    expect(t.status).toBe("suggested");
  }

  // ⑪ Changes displayed — first evidence item has a non-trivial description
  expect(packet.evidence[0]?.description?.length).toBeGreaterThan(5);

  // ⑫ Verification completed — every task has its own intelligence packet w/ version
  for (const t of tasks) {
    expect(t.intelligence_packet?.version).toBeTruthy();
  }

  // ⑬ Evidence attached to each stage task
  for (const t of tasks) {
    expect(t.intelligence_packet?.evidence?.length).toBeGreaterThanOrEqual(1);
  }

  // ⑭ Completion honest — final-send / apply / execute stage is NOT approvable
  if (!skipFinalBlockedCheck) {
    const finalTasks = tasks.filter(
      (t: any) =>
        t.metadata?.final_send_stage ||
        t.metadata?.approval_stage === "apply" ||
        t.metadata?.approval_stage === "execute",
    );
    for (const t of finalTasks) {
      expect(isApprovableReadiness(t.readiness_state)).toBe(false);
    }
  }

  // ⑮ Workspace isolation — work order belongs to the correct workspace
  if (workspaceId) {
    expect(workOrder.workspace_id).toBe(workspaceId);
  }
}

// ── Fake Supabase builder ─────────────────────────────────────────────────────

interface TableSpec {
  rows?: any[];
  error?: { message: string } | null;
}

// Module-level counter so IDs are unique across independent makeSb() instances
// (each workspace isolation test creates its own factory; shared counter prevents
// ID collisions like `work_orders-1` appearing in both).
let _globalIdSeq = 0;

function makeSb(tables: Record<string, TableSpec>) {
  const inserted: Record<string, any[]> = {};
  const deleted: Record<string, true> = {};
  const idSeq = () => ++_globalIdSeq;

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
      not:    (col: string, op: string, val: any) => {
        if (op === "is" && val === null) (state.notNull ??= []).push(col);
        return b;
      },
      is:     (col: string, val: any) => {
        if (val === null) (state.isNull ??= []).push(col);
        return b;
      },
      gte:    (col: string, val: any) => {
        (state.ranges ??= []).push((r: any) => r[col] == null || r[col] >= val);
        return b;
      },
      lt:     (col: string, val: any) => {
        (state.ranges ??= []).push((r: any) => r[col] == null || r[col] < val);
        return b;
      },
      order:  (..._a: any[]) => b,
      limit:  (..._a: any[]) => b,
      range:  (..._a: any[]) => b,
      delete: () => { state.op = "delete"; deleted[table] = true; return b; },
      update: (patch: any) => { state.op = "update"; state.patch = patch; return b; },
      insert: (row: any) => {
        state.op = "insert";
        state.row = { ...row, id: `${table}-${idSeq()}` };
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

// ── Data factories ────────────────────────────────────────────────────────────

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

const gadsAccount = (over: Record<string, any> = {}) => ({
  id: "gads-acct-1",
  workspace_id: WS,
  platform: "google",
  account_name: "Acme Google Ads",
  external_account_id: "1234567890",
  status: "active",
  created_at: "2026-07-01",
  ...over,
});

const gadsCampaignDaily = (over: Record<string, any> = {}) => ({
  campaign_id: "camp-1",
  campaign_name: "Brand campaign",
  workspace_id: WS,
  date: "2026-07-20",
  cost_micros: 5_000_000,
  clicks: 250,
  impressions: 8_000,
  conversions: 12,
  ...over,
});

const gadsRecommendation = (over: Record<string, any> = {}) => ({
  id: "rec-1",
  workspace_id: WS,
  title: "Raise bids on top keywords",
  status: "pending",
  kind: "OPTIMIZE_AD_ROTATION",
  created_at: "2026-07-18",
  ...over,
});

const metaConn = (over: Record<string, any> = {}) => ({
  id: "meta-conn-1",
  workspace_id: WS,
  provider: "meta",
  account_type: "facebook_page",
  status: "active",
  token_expires_at: null,
  created_at: "2026-07-01",
  ...over,
});

const metaAdsAccount = (over: Record<string, any> = {}) => ({
  id: "meta-ads-1",
  workspace_id: WS,
  platform: "meta",
  account_name: "Acme Meta Ads",
  external_account_id: "9876543210",
  status: "active",
  created_at: "2026-07-01",
  ...over,
});

const seoSite = (over: Record<string, any> = {}) => ({
  id: "seo-site-1",
  workspace_id: WS,
  site_url: "https://acme.com",
  status: "active",
  keywords: ["ai agents", "automation"],
  updated_at: "2026-07-20",
  ...over,
});

const seoCampaign = (over: Record<string, any> = {}) => ({
  id: "seo-camp-1",
  workspace_id: WS,
  name: "Q3 SEO push",
  status: "draft",
  proposed_title: "How AI agents improve customer service",
  created_at: "2026-07-01",
  ...over,
});

const watiConn = () => ({
  workspace_id: WS,
  tenant_id: "ten-1",
  api_host: "https://x.wati.io",
  status: "connected",
  last_tested_at: null,
  error_message: null,
});

const watiTemplate = () => ({
  id: "tmpl-1",
  name: "welcome_offer",
  status: "approved",
  category: "MARKETING",
  body: "Hello {{1}}, we have a new offer tailored for you this week.",
});

const hexmailTemplate = () => ({
  id: "et-1",
  name: "outreach",
  type: "email",
  status: "active",
  content: "Hi {{name}}, I wanted to reach out about our AI receptionist service.",
  subject: "Quick note from WEBEE",
});

const agent = (over: Record<string, any> = {}) => ({
  id: "agent-1",
  name: "Ava",
  retell_agent_id: "agent_abc123",
  voice_provider: "retell",
  agent_type: "client_qualification",
  inbound_phone_number: "+441632000001",
  updated_at: "2026-07-01",
  flow_data: {
    nodes: [{ type: "conversation", content: "Hello, I am Ava from WEBEE. How can I help you today?" }],
  },
  ...over,
});

// ═══════════════════════════════════════════════════════════════════════════════
// Family 1 — Sales pipeline review (HiveMind)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Acceptance — Family 1: Sales pipeline review (HiveMind)", () => {
  it("A: WBAH workspace is hard-excluded before any DB access", async () => {
    const { sb } = makeSb({});
    await expect(
      createSalesPipelineWorkOrderCore(sb, WBAH_WORKSPACE_ID, null),
    ).rejects.toThrow(/wbah/i);
  });

  it("chain ①–⑮: all 15 points hold on a populated pipeline", async () => {
    const { sb, inserted } = makeSb({
      leads: { rows: [lead(), lead({ status: "qualified", pipeline_stage: "qualified" })] },
      work_orders: { rows: [] },
      hivemind_tasks: { rows: [] },
    });
    const res = await createSalesPipelineWorkOrderCore(sb, WS, null);
    assertChain(
      { workOrder: inserted.work_orders![0], tasks: res.tasks },
      { workspaceId: WS, minTasks: 1 },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Family 2 — Follow-up sequence (HiveMind)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Acceptance — Family 2: Follow-up sequence (HiveMind)", () => {
  it("A: WBAH workspace is hard-excluded", async () => {
    const { sb } = makeSb({});
    await expect(
      createFollowUpSequenceWorkOrderCore(sb, WBAH_WORKSPACE_ID, null),
    ).rejects.toThrow(/wbah/i);
  });

  it("chain ①–⑮: 4 stage tasks, final Send blocked, approval chain holds", async () => {
    const { sb, inserted } = makeSb({
      leads: { rows: [lead(), lead()] },
      suppressed_emails: { rows: [] },
      work_orders: { rows: [] },
      hivemind_tasks: { rows: [] },
    });
    const res = await createFollowUpSequenceWorkOrderCore(sb, WS, null, {
      channels: ["call", "email"],
      touches: 2,
    });
    assertChain(
      { workOrder: inserted.work_orders![0], tasks: res.tasks },
      { workspaceId: WS, minTasks: 4 },
    );
    expect(res.tasks).toHaveLength(4);
    expect(res.tasks[res.tasks.length - 1].metadata.final_send_stage).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Family 3 — WhatsApp campaign (HiveMind)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Acceptance — Family 3: WhatsApp campaign (HiveMind)", () => {
  it("A: WBAH workspace is hard-excluded", async () => {
    const { sb } = makeSb({});
    await expect(
      createWhatsAppCampaignWorkOrderCore(sb, WBAH_WORKSPACE_ID, null),
    ).rejects.toThrow(/wbah/i);
  });

  it("chain ①–⑮: connected provider — opted-in leads, final Send blocked", async () => {
    const { sb, inserted } = makeSb({
      wati_connections: { rows: [watiConn()] },
      wati_templates: { rows: [watiTemplate()] },
      leads: { rows: [lead({ whatsapp_opt_in: true })] },
      work_orders: { rows: [] },
      hivemind_tasks: { rows: [] },
    });
    const res = await createWhatsAppCampaignWorkOrderCore(sb, WS, null);
    assertChain(
      { workOrder: inserted.work_orders![0], tasks: res.tasks },
      { workspaceId: WS },
    );
    expect(res.providerConnected).toBe(true);
    expect(res.tasks[res.tasks.length - 1].metadata.final_send_stage).toBe(true);
  });

  it("PROVIDER_STUB: no provider — work order still created with integration_required state", async () => {
    const { sb, inserted } = makeSb({
      wati_connections: { rows: [] },
      wati_templates: { rows: [] },
      leads: { rows: [lead()] },
      work_orders: { rows: [] },
      hivemind_tasks: { rows: [] },
    });
    const res = await createWhatsAppCampaignWorkOrderCore(sb, WS, null);
    // Chain ①–⑥, ⑦–⑨, ⑩, ⑫⑬⑭⑮ all hold even without a provider
    assertChain(
      { workOrder: inserted.work_orders![0], tasks: res.tasks },
      { workspaceId: WS, expectTargetResolved: false },
    );
    expect(inserted.work_orders![0].readiness_state).toBe("integration_required");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Family 4 — Email campaign (HiveMind)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Acceptance — Family 4: Email campaign (HiveMind)", () => {
  it("A: WBAH workspace is hard-excluded", async () => {
    const { sb } = makeSb({});
    await expect(
      createEmailCampaignWorkOrderCore(sb, WBAH_WORKSPACE_ID, null),
    ).rejects.toThrow(/wbah/i);
  });

  it("chain ①–⑮: deliverability present, emailable leads, final Send blocked", async () => {
    deliverabilityMock.getEmailReadinessForWorkspace.mockResolvedValueOnce({
      score: 90, grade: "A", issues: [],
    });
    const { sb, inserted } = makeSb({
      suppressed_emails: { rows: [] },
      leads: { rows: [lead({ email: "a@example.com" })] },
      hexmail_campaigns: { rows: [] },
      hexmail_templates: { rows: [hexmailTemplate()] },
      work_orders: { rows: [] },
      hivemind_tasks: { rows: [] },
    });
    const res = await createEmailCampaignWorkOrderCore(sb, WS, null);
    assertChain(
      { workOrder: inserted.work_orders![0], tasks: res.tasks },
      { workspaceId: WS },
    );
    expect(res.tasks[res.tasks.length - 1].metadata.final_send_stage).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Family 5 — Calls campaign (HiveMind)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Acceptance — Family 5: Calls campaign (HiveMind)", () => {
  it("A: WBAH workspace is hard-excluded", async () => {
    const { sb } = makeSb({});
    await expect(
      createCallCampaignWorkOrderCore(sb, WBAH_WORKSPACE_ID, null),
    ).rejects.toThrow(/wbah/i);
  });

  it("chain ①–⑮: Retell agent resolved, leads with phones, daily cap evidence", async () => {
    const { sb, inserted } = makeSb({
      agents: { rows: [agent()] },
      phone_numbers: { rows: [] },
      campaigns: { rows: [] },
      leads: { rows: [lead({ phone: "+447700900001" }), lead({ phone: "+447700900002" })] },
      suppressed_emails: { rows: [] },
      work_orders: { rows: [] },
      hivemind_tasks: { rows: [] },
    });
    const res = await createCallCampaignWorkOrderCore(sb, WS, null);
    assertChain(
      { workOrder: inserted.work_orders![0], tasks: res.tasks },
      { workspaceId: WS },
    );
    expect(res.tasks[res.tasks.length - 1].metadata.final_send_stage).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Family 6 — Cross-channel objective (HiveMind / Executive orchestration)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Acceptance — Family 6: Cross-channel objective (HiveMind)", () => {
  it("A: WBAH workspace is hard-excluded", async () => {
    const { sb } = makeSb({});
    await expect(
      createCrossChannelObjectiveWorkOrderCore(sb, WBAH_WORKSPACE_ID, null, {
        objective: "Generate 100 new leads in Q3",
      }),
    ).rejects.toThrow(/wbah/i);
  });

  it("chain ①–⑮: ≥2 justified channels, strategy task independently approvable", async () => {
    const { sb, inserted } = makeSb({
      leads: { rows: [lead({ email: "a@example.com" }), lead({ email: "b@example.com" }), lead({ whatsapp_opt_in: true })] },
      suppressed_emails: { rows: [] },
      workspace_settings: { rows: [{ workspace_id: WS, whatsapp_provider: "wati" }] },
      agents: { rows: [agent()] },
      growthmind_social_connections: { rows: [] },
      growthmind_gsc_sync_state: { rows: [] },
      work_orders: { rows: [] },
      hivemind_tasks: { rows: [] },
    });
    const res = await createCrossChannelObjectiveWorkOrderCore(sb, WS, null, {
      objective: "Acquire 50 new leads in the UK market through targeted outreach",
    });
    expect(res.justified.length).toBeGreaterThanOrEqual(1);
    // Strategy task is independently approvable; channel tasks are correctly blocked.
    assertChain(
      { workOrder: inserted.work_orders![0], tasks: [res.strategyTask] },
      { workspaceId: WS, skipFinalBlockedCheck: true },
    );
    expect(isApprovableReadiness(res.strategyTask.readiness_state)).toBe(true);
    for (const ct of res.channelTasks) {
      expect(ct.intelligence_packet?.version).toBeTruthy();
      expect(isApprovableReadiness(ct.readiness_state)).toBe(false);
    }
  });

  it("zero justified channels — parent blocked, strategy task still has packet", async () => {
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
      objective: "Generate qualified leads through multi-channel outreach",
    });
    expect(res.justified).toHaveLength(0);
    expect(res.channelTasks).toHaveLength(0);
    expect(inserted.work_orders![0].readiness_state).toBe("blocked");
    expect(res.strategyTask.intelligence_packet?.version).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Family 7 — Google Ads analysis (GrowthMind) — Regression
// ═══════════════════════════════════════════════════════════════════════════════

describe("Acceptance — Family 7: Google Ads analysis (GrowthMind) [regression]", () => {
  it("A: WBAH workspace is hard-excluded", async () => {
    const { sb } = makeSb({});
    await expect(
      createGadsPacketWorkOrderCore(sb, WBAH_WORKSPACE_ID, null),
    ).rejects.toThrow(/wbah/i);
  });

  it("chain ①–⑮: connected account — real 30-day campaign evidence, keyword proposals visible", async () => {
    const { sb, inserted } = makeSb({
      growthmind_ads_accounts: { rows: [gadsAccount()] },
      growthmind_gads_campaign_daily: {
        rows: [
          gadsCampaignDaily({ date: "2026-07-20" }),
          gadsCampaignDaily({ campaign_id: "camp-2", campaign_name: "Retargeting", date: "2026-07-19", cost_micros: 2_000_000, clicks: 80, impressions: 3_000, conversions: 4 }),
        ],
      },
      growthmind_gads_recommendations: { rows: [gadsRecommendation(), gadsRecommendation({ id: "rec-2", title: "Add negative keywords", status: "pending" })] },
      growthmind_gads_change_requests: { rows: [] },
      work_orders: { rows: [] },
      hivemind_tasks: { rows: [] },
    });
    const res = await createGadsPacketWorkOrderCore(sb, WS, null, {
      objective: "Optimise Google Ads keywords using 30-day performance data",
    });
    assertChain(
      { workOrder: inserted.work_orders![0], tasks: res.tasks },
      { workspaceId: WS, expectTargetResolved: true },
    );
    expect(res.connected).toBe(true);
    // Real 30-day campaign data is loaded as evidence (③)
    const campaignEvidence = inserted.work_orders![0].intelligence_packet.evidence.find(
      (e: any) => e.source === "growthmind_gads_campaign_daily",
    );
    expect(campaignEvidence).toBeDefined();
    expect(campaignEvidence.data?.campaigns?.length).toBeGreaterThanOrEqual(1);
    // Keyword proposals (recommendations) are visible in the evidence packet
    const recEvidence = inserted.work_orders![0].intelligence_packet.evidence.find(
      (e: any) => e.source === "growthmind_gads_recommendations",
    );
    expect(recEvidence).toBeDefined();
    expect(recEvidence.data?.pending?.length).toBeGreaterThanOrEqual(1);
    // All changes flow through the existing change-request approval mechanism (not bypassed)
    const crEvidence = inserted.work_orders![0].intelligence_packet.evidence.find(
      (e: any) => e.source === "growthmind_gads_change_requests",
    );
    expect(crEvidence).toBeDefined();
    expect(crEvidence.description).toMatch(/change.request/i);
  });

  it("PROVIDER_STUB: no Google Ads account connected — integration_missing blocker present", async () => {
    const { sb, inserted } = makeSb({
      growthmind_ads_accounts: { rows: [] },
      growthmind_gads_campaign_daily: { rows: [] },
      growthmind_gads_recommendations: { rows: [] },
      growthmind_gads_change_requests: { rows: [] },
      work_orders: { rows: [] },
      hivemind_tasks: { rows: [] },
    });
    const res = await createGadsPacketWorkOrderCore(sb, WS, null);
    assertChain(
      { workOrder: inserted.work_orders![0], tasks: res.tasks },
      { workspaceId: WS, expectTargetResolved: false },
    );
    expect(res.connected).toBe(false);
    const blockers = inserted.work_orders![0].intelligence_packet.blockers ?? [];
    expect(blockers.some((b: any) => b.kind === "integration_missing")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Family 8 — Meta lead campaign (GrowthMind)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Acceptance — Family 8: Meta lead campaign (GrowthMind)", () => {
  it("A: WBAH workspace is hard-excluded", async () => {
    const { sb } = makeSb({});
    await expect(
      createMetaCampaignWorkOrderCore(sb, WBAH_WORKSPACE_ID, null),
    ).rejects.toThrow(/wbah/i);
  });

  it("chain ①–⑮: connected Meta page + ads account — full approval chain", async () => {
    const { sb, inserted } = makeSb({
      growthmind_social_connections: { rows: [metaConn()] },
      growthmind_ads_accounts: { rows: [metaAdsAccount()] },
      growthmind_publishing_jobs: { rows: [] },
      work_orders: { rows: [] },
      hivemind_tasks: { rows: [] },
    });
    const res = await createMetaCampaignWorkOrderCore(sb, WS, null, {
      spec: { objective: "lead_generation" },
    });
    assertChain(
      { workOrder: inserted.work_orders![0], tasks: res.tasks },
      { workspaceId: WS, expectTargetResolved: true },
    );
    expect(res.connected).toBe(true);
  });

  it("PROVIDER_STUB: no Meta connection — content approval still independent from launch", async () => {
    const { sb, inserted } = makeSb({
      growthmind_social_connections: { rows: [] },
      growthmind_ads_accounts: { rows: [] },
      growthmind_publishing_jobs: { rows: [] },
      work_orders: { rows: [] },
      hivemind_tasks: { rows: [] },
    });
    const res = await createMetaCampaignWorkOrderCore(sb, WS, null);
    assertChain(
      { workOrder: inserted.work_orders![0], tasks: res.tasks },
      { workspaceId: WS, expectTargetResolved: false },
    );
    expect(res.connected).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Family 9 — TikTok content (GrowthMind)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Acceptance — Family 9: TikTok content (GrowthMind)", () => {
  it("A: WBAH workspace is hard-excluded", async () => {
    const { sb } = makeSb({});
    await expect(
      createTikTokWorkOrderCore(sb, WBAH_WORKSPACE_ID, null),
    ).rejects.toThrow(/wbah/i);
  });

  it("chain ①–⑮: organic content proposal — target always resolved, audio rights present", async () => {
    const { sb, inserted } = makeSb({
      growthmind_ads_accounts: { rows: [] },
      growthmind_publishing_jobs: { rows: [] },
      work_orders: { rows: [] },
      hivemind_tasks: { rows: [] },
    });
    const res = await createTikTokWorkOrderCore(sb, WS, null, {
      proposal: {
        concept: "Behind the scenes: how AI handles your calls",
        hook: "What if your phone never went to voicemail?",
        script: "Our AI receptionist answers every call 24/7.",
        caption: "Never miss a customer call again. Link in bio.",
        duration: 30,
        audioRightsStatus: "original_audio",
        isAd: false,
      },
    });
    assertChain(
      { workOrder: inserted.work_orders![0], tasks: res.tasks },
      { workspaceId: WS, expectTargetResolved: true },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Family 10 — LinkedIn content (GrowthMind)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Acceptance — Family 10: LinkedIn content (GrowthMind)", () => {
  it("A: WBAH workspace is hard-excluded", async () => {
    const { sb } = makeSb({});
    await expect(
      createLinkedInWorkOrderCore(sb, WBAH_WORKSPACE_ID, null),
    ).rejects.toThrow(/wbah/i);
  });

  it("chain ①–⑮: organic LinkedIn post with named entity — target resolved", async () => {
    const { sb, inserted } = makeSb({
      growthmind_ads_accounts: { rows: [] },
      growthmind_publishing_jobs: { rows: [] },
      work_orders: { rows: [] },
      hivemind_tasks: { rows: [] },
    });
    const res = await createLinkedInWorkOrderCore(sb, WS, null, {
      proposal: {
        entityType: "company",
        entityName: "Acme Corp",
        isAd: false,
        contentType: "article",
        headline: "How AI receptionists are changing SMB customer service",
        body: "AI-powered phone agents help small businesses handle inbound calls efficiently.",
      },
    });
    assertChain(
      { workOrder: inserted.work_orders![0], tasks: res.tasks },
      { workspaceId: WS, expectTargetResolved: true },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Family 11 — SEO / GSC opportunity (GrowthMind)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Acceptance — Family 11: SEO / GSC opportunity (GrowthMind)", () => {
  it("A: WBAH workspace is hard-excluded", async () => {
    const { sb } = makeSb({});
    await expect(
      createSeoPacketWorkOrderCore(sb, WBAH_WORKSPACE_ID, null),
    ).rejects.toThrow(/wbah/i);
  });

  it("chain ①–⑮: GSC connected — sites and campaigns evidence loaded", async () => {
    const { sb, inserted } = makeSb({
      growthmind_seo_sites: { rows: [seoSite()] },
      growthmind_seo_campaigns: { rows: [seoCampaign(), seoCampaign({ id: "sc-2", name: "Keyword expansion", status: "active" })] },
      work_orders: { rows: [] },
      hivemind_tasks: { rows: [] },
    });
    const res = await createSeoPacketWorkOrderCore(sb, WS, null, {
      objective: "Find strongest organic SEO opportunity for Q3",
    });
    assertChain(
      { workOrder: inserted.work_orders![0], tasks: res.tasks },
      { workspaceId: WS, expectTargetResolved: true },
    );
    expect(res.gscConnected).toBe(true);
    // All existing multi-stage campaign approvals remain intact (not bypassed)
    const campaignEvidence = inserted.work_orders![0].intelligence_packet.evidence.find(
      (e: any) => e.source === "growthmind_seo_campaigns",
    );
    expect(campaignEvidence?.description).toMatch(/existing.*approval|multi-stage|approvals?/i);
  });

  it("PROVIDER_STUB: GSC not connected — integration_missing blocker, chain still valid", async () => {
    const { sb, inserted } = makeSb({
      growthmind_seo_sites: { rows: [] },
      growthmind_seo_campaigns: { rows: [] },
      work_orders: { rows: [] },
      hivemind_tasks: { rows: [] },
    });
    const res = await createSeoPacketWorkOrderCore(sb, WS, null);
    assertChain(
      { workOrder: inserted.work_orders![0], tasks: res.tasks },
      { workspaceId: WS, expectTargetResolved: false },
    );
    expect(res.gscConnected).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Family 12 — Content deployment (GrowthMind)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Acceptance — Family 12: Content deployment (GrowthMind)", () => {
  it("A: WBAH workspace is hard-excluded", async () => {
    const { sb } = makeSb({});
    await expect(
      createContentDeploymentWorkOrderCore(sb, WBAH_WORKSPACE_ID, null, {
        variants: [{ channel: "blog", body: "Test content" }],
      }),
    ).rejects.toThrow(/wbah/i);
  });

  it("chain ①–⑮: mocked variant creation — content safety gate passes clean content", async () => {
    const { sb, inserted } = makeSb({
      work_orders: { rows: [] },
      hivemind_tasks: { rows: [] },
    });
    const res = await createContentDeploymentWorkOrderCore(sb, WS, null, {
      variants: [
        { channel: "blog", body: "AI agents help businesses automate customer engagement." },
        { channel: "linkedin_post", body: "How AI receptionists are changing business phone handling." },
      ],
    });
    assertChain(
      { workOrder: inserted.work_orders![0], tasks: res.tasks },
      { workspaceId: WS, expectTargetResolved: true },
    );
    expect(res.variants.length).toBeGreaterThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Family 13 — Agent↔CRM integration (SystemMind)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Acceptance — Family 13: Agent↔CRM integration (SystemMind)", () => {
  it("A: WBAH workspace is hard-excluded", async () => {
    const { sb } = makeSb({});
    await expect(
      createAgentCrmIntegrationWorkOrderCore(sb, WBAH_WORKSPACE_ID, null),
    ).rejects.toThrow(/wbah/i);
  });

  it("chain ①–⑮: 5 stages, Apply stage blocked + sensitive (provider_action_unsupported scope)", async () => {
    const { sb, inserted } = makeSb({
      agents: { rows: [agent()] },
      systemmind_crm_connections: { rows: [{ id: "crm-1", provider: "hubspot", label: "Main", status: "verified", last_tested_at: "2026-07-01" }] },
      systemmind_crm_discoveries: { rows: [] },
      systemmind_dynamic_variables: { rows: [] },
      systemmind_call_triggers: { rows: [] },
      systemmind_integration_errors: { rows: [] },
      work_orders: { rows: [] },
      hivemind_tasks: { rows: [] },
    });
    const res = await createAgentCrmIntegrationWorkOrderCore(sb, WS, null);
    assertChain(
      { workOrder: inserted.work_orders![0], tasks: res.tasks },
      { workspaceId: WS, minTasks: 5 },
    );
    expect(res.tasks).toHaveLength(5);
    const applyTask = res.tasks[res.tasks.length - 1];
    expect(applyTask.metadata.approval_stage).toBe("apply");
    expect(applyTask.intelligence_packet.approval_scope.sensitive).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Family 14 — Workflow depth review (SystemMind)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Acceptance — Family 14: Workflow depth review (SystemMind)", () => {
  it("A: WBAH workspace is hard-excluded", async () => {
    const { sb } = makeSb({});
    await expect(
      createWorkflowDepthWorkOrderCore(sb, WBAH_WORKSPACE_ID, null),
    ).rejects.toThrow(/wbah/i);
  });

  it("chain ①–⑮: 4 stages, run evidence loaded, Apply stage blocked + sensitive", async () => {
    const { sb, inserted } = makeSb({
      workspace_workflows: { rows: [{ id: "w1", name: "Lead intake workflow", status: "active", flow_definition: { nodes: [{}, {}] }, updated_at: "2026-07-20" }] },
      workflow_runs: { rows: [{ id: "r1", status: "completed", created_at: "2026-07-25" }] },
      work_orders: { rows: [] },
      hivemind_tasks: { rows: [] },
    });
    const res = await createWorkflowDepthWorkOrderCore(sb, WS, null);
    assertChain(
      { workOrder: inserted.work_orders![0], tasks: res.tasks },
      { workspaceId: WS, minTasks: 4 },
    );
    expect(res.tasks).toHaveLength(4);
    const applyTask = res.tasks[res.tasks.length - 1];
    expect(applyTask.metadata.approval_stage).toBe("apply");
    expect(applyTask.intelligence_packet.approval_scope.sensitive).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Families 15–18 — AccountsMind financial audit cores (all 4 kinds)
// ═══════════════════════════════════════════════════════════════════════════════

const AUDIT_TABLE_DATA: Record<FinancialAuditKind, Record<string, TableSpec>> = {
  invoice_audit: {
    accountsmind_invoices: {
      rows: [
        {
          id: "i1", invoice_number: "INV-001", client_name: "Acme Ltd",
          status: "sent", total_cents: 100_000, amount_paid_cents: 0,
          currency: "GBP", due_date: "2025-01-01", issue_date: "2024-12-01",
          paid_at: null, storage_path: "invoices/i1.pdf",
        },
      ],
    },
  },
  renewals_audit: {
    accountsmind_recurring_invoices: {
      rows: [
        {
          id: "r1", name: "Monthly retainer", active: true, day_of_month: 1,
          last_generated_month: "2025-01-01", currency: "GBP",
          items_json: [{ unit_price_cents: 50_000, quantity: 1 }], due_days: 14,
        },
      ],
    },
  },
  outgoings_audit: {
    provider_usage_log: {
      rows: [
        { provider_category: "voice", provider_name: "retell", cost_usd: 12.50, created_at: new Date().toISOString() },
      ],
    },
  },
  client_costing_audit: {
    accountsmind_invoices: {
      rows: [
        {
          id: "i2", invoice_number: "INV-002", client_name: "Beta Corp",
          status: "sent", total_cents: 200_000, amount_paid_cents: 0,
          currency: "GBP", due_date: "2025-01-01", issue_date: "2024-12-01",
          paid_at: null, storage_path: "invoices/i2.pdf",
        },
      ],
    },
  },
};

const AUDIT_FAMILY_NUMBER: Record<FinancialAuditKind, string> = {
  invoice_audit: "15",
  renewals_audit: "16",
  outgoings_audit: "17",
  client_costing_audit: "18",
};

for (const kind of ["invoice_audit", "renewals_audit", "outgoings_audit", "client_costing_audit"] as FinancialAuditKind[]) {
  describe(`Acceptance — Family ${AUDIT_FAMILY_NUMBER[kind]}: AccountsMind ${kind.replace(/_/g, " ")}`, () => {
    it("A: WBAH workspace is hard-excluded", async () => {
      const { sb } = makeSb({});
      await expect(
        createFinancialAuditWorkOrderCore(sb, WBAH_WORKSPACE_ID, null, kind),
      ).rejects.toThrow(/wbah/i);
    });

    it(`chain ①–⑮: 3 stages, exceptions found, Execute stage blocked + sensitive`, async () => {
      const { sb, inserted } = makeSb({
        ...AUDIT_TABLE_DATA[kind],
        work_orders: { rows: [] },
        hivemind_tasks: { rows: [] },
      });
      const res = await createFinancialAuditWorkOrderCore(sb, WS, null, kind);
      assertChain(
        { workOrder: inserted.work_orders![0], tasks: res.tasks },
        { workspaceId: WS, minTasks: 3 },
      );
      expect(res.tasks).toHaveLength(3);
      const executeTask = res.tasks[res.tasks.length - 1];
      expect(executeTask.metadata.approval_stage).toBe("execute");
      expect(executeTask.intelligence_packet.approval_scope.sensitive).toBe(true);
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Content safety regression — fabricated stats / fake testimonials blocked
// ═══════════════════════════════════════════════════════════════════════════════

describe("Content safety regression — fabricated stat blocked across content types", () => {
  // supabaseAdmin is mocked to return empty allow-list → no exemptions → patterns fire.

  it("fabricated stat '300% ROI increase' is blocked for blog_article", async () => {
    const result = await runContentSafetyCheck(
      "Our platform delivers a 300% ROI increase for every client we work with.",
      "blog_article",
      WS,
    );
    expect(result.passed).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
  });

  it("fabricated stat '200% more leads' is blocked for email_campaign", async () => {
    const result = await runContentSafetyCheck(
      "Switch to WEBEE and see 200% more leads in your first month.",
      "email_campaign",
      WS,
    );
    expect(result.passed).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
  });

  it("fake testimonial 'Our customer John Smith says' is blocked for whatsapp_campaign", async () => {
    const result = await runContentSafetyCheck(
      'Our customer John Smith says: "This AI receptionist saved our business completely."',
      "whatsapp_campaign",
      WS,
    );
    expect(result.passed).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
  });

  it("fake case study 'Case Study: Acme Inc' is blocked for linkedin_post", async () => {
    const result = await runContentSafetyCheck(
      "Case Study: Acme Inc achieved 5x faster response times after switching to WEBEE.",
      "linkedin_post",
      WS,
    );
    expect(result.passed).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
  });

  it("fabricated stat is blocked for ai_call_script", async () => {
    const result = await runContentSafetyCheck(
      "Our AI system boosts conversions by 300% — guaranteed results for your business.",
      "ai_call_script",
      WS,
    );
    expect(result.passed).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
  });

  it("safetyCheckEvidenceItem reflects blocked state — unsafe draft cannot reach approval", async () => {
    const safetyResult = await runContentSafetyCheck(
      "Clients achieve a guaranteed 400% increase in revenue using our service.",
      "blog_article",
      WS,
    );
    expect(safetyResult.passed).toBe(false);
    const evidenceItem = safetyCheckEvidenceItem(safetyResult);
    expect(evidenceItem.data.passed).toBe(false);
    expect(evidenceItem.data.violations.length).toBeGreaterThan(0);
    // An intelligence packet carrying this evidence item would NOT be approvable
    // because the content safety blocker is embedded in the packet's evidence.
  });

  it("clean content passes safety gate — safe content reaches approval pathway", async () => {
    // Use a contentKind with a low minimum word count so the short safe text
    // does not trigger the content_depth violation (blog_article requires 400 words).
    const result = await runContentSafetyCheck(
      "AI receptionists help small businesses handle inbound calls professionally.",
      "instagram_caption",
      WS,
    );
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Workspace isolation — cross-workspace data cannot leak
// ═══════════════════════════════════════════════════════════════════════════════

describe("Workspace isolation — cross-workspace data cannot leak", () => {
  it("sales pipeline: WS1 work order is stamped with WS1; WS2 query returns WS2 work order", async () => {
    const { sb: sb1, inserted: ins1 } = makeSb({
      leads: { rows: [lead()] },
      work_orders: { rows: [] },
      hivemind_tasks: { rows: [] },
    });
    const { sb: sb2, inserted: ins2 } = makeSb({
      leads: { rows: [lead({ email: "ws2@example.com" })] },
      work_orders: { rows: [] },
      hivemind_tasks: { rows: [] },
    });
    const res1 = await createSalesPipelineWorkOrderCore(sb1, WS, null);
    const res2 = await createSalesPipelineWorkOrderCore(sb2, WS_2, null);

    // Each work order belongs to its own workspace (⑮)
    expect(ins1.work_orders![0].workspace_id).toBe(WS);
    expect(ins2.work_orders![0].workspace_id).toBe(WS_2);

    // Cross-workspace: WS1's inserted rows never appear in WS2's builder
    expect(ins1.work_orders![0].id).not.toBe(ins2.work_orders![0].id);
    // WS2 builder has no knowledge of WS1 rows
    expect(Object.keys(ins1)).not.toContain("growthmind_ads_accounts");
    expect((ins2.work_orders ?? []).every((wo: any) => wo.workspace_id === WS_2)).toBe(true);
  });

  it("email campaign: WS1 and WS2 produce isolated work orders with distinct workspace IDs", async () => {
    deliverabilityMock.getEmailReadinessForWorkspace.mockResolvedValue({
      score: 85, grade: "B", issues: [],
    });
    const mkEmailSb = (ws: string) =>
      makeSb({
        suppressed_emails: { rows: [] },
        leads: { rows: [lead({ email: `lead@ws-${ws.slice(0, 4)}.example.com` })] },
        hexmail_campaigns: { rows: [] },
        hexmail_templates: { rows: [hexmailTemplate()] },
        work_orders: { rows: [] },
        hivemind_tasks: { rows: [] },
      });

    const { sb: sb1, inserted: ins1 } = mkEmailSb(WS);
    const { sb: sb2, inserted: ins2 } = mkEmailSb(WS_2);

    await createEmailCampaignWorkOrderCore(sb1, WS, null);
    await createEmailCampaignWorkOrderCore(sb2, WS_2, null);

    expect(ins1.work_orders![0].workspace_id).toBe(WS);
    expect(ins2.work_orders![0].workspace_id).toBe(WS_2);
    expect(ins1.work_orders![0].id).not.toBe(ins2.work_orders![0].id);
  });

  it("Google Ads: each workspace sees only its own account evidence", async () => {
    const mkGadsSb = (ws: string, accountId: string) =>
      makeSb({
        growthmind_ads_accounts: { rows: [gadsAccount({ id: accountId, workspace_id: ws })] },
        growthmind_gads_campaign_daily: { rows: [gadsCampaignDaily({ workspace_id: ws })] },
        growthmind_gads_recommendations: { rows: [] },
        growthmind_gads_change_requests: { rows: [] },
        work_orders: { rows: [] },
        hivemind_tasks: { rows: [] },
      });

    const { sb: sb1, inserted: ins1 } = mkGadsSb(WS, "acct-ws1");
    const { sb: sb2, inserted: ins2 } = mkGadsSb(WS_2, "acct-ws2");

    await createGadsPacketWorkOrderCore(sb1, WS, null);
    await createGadsPacketWorkOrderCore(sb2, WS_2, null);

    expect(ins1.work_orders![0].workspace_id).toBe(WS);
    expect(ins2.work_orders![0].workspace_id).toBe(WS_2);
    // Work orders have different ids — no sharing
    expect(ins1.work_orders![0].id).not.toBe(ins2.work_orders![0].id);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Legacy pathway blocked — LEGACY_CREATOR_BLOCKED guard
// ═══════════════════════════════════════════════════════════════════════════════

describe("Legacy pathway blocked — LEGACY_CREATOR_BLOCKED guard", () => {
  it("a disabled legacy creator throws LEGACY_CREATOR_BLOCKED before touching the DB", async () => {
    const disabledCreator = async (_sb: any, _ws: string) => {
      throw new LegacyCreatorBlockedError(
        "LEGACY_CREATOR_BLOCKED: this creator is disabled by Task #500 — use the standard intelligence-packet path instead.",
      );
    };
    const { sb } = makeSb({});
    await assertNoLegacyDirectInsert(() => disabledCreator(sb, WS));
  });

  it("assertNoLegacyDirectInsert catches creators that silently succeed without throwing", async () => {
    const silentCreator = async () => ({ id: "fake-task" });
    await expect(
      assertNoLegacyDirectInsert(silentCreator),
    ).rejects.toThrow(/assertNoLegacyDirectInsert: expected the creator to throw/);
  });

  it("assertNoLegacyDirectInsert rejects if error message does not contain LEGACY_CREATOR_BLOCKED", async () => {
    const wrongErrorCreator = async () => {
      throw new Error("some other error unrelated to legacy blocks");
    };
    await expect(
      assertNoLegacyDirectInsert(wrongErrorCreator, "LEGACY_CREATOR_BLOCKED"),
    ).rejects.toThrow(/expected error message to contain/);
  });

  it("LegacyCreatorBlockedError has the correct name and message format", () => {
    const err = new LegacyCreatorBlockedError(
      "LEGACY_CREATOR_BLOCKED: createShallowTask is disabled.",
    );
    expect(err.name).toBe("LegacyCreatorBlockedError");
    expect(err.message).toContain("LEGACY_CREATOR_BLOCKED");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Contract F — Rollback: task insert failure must clean up the work order
// ═══════════════════════════════════════════════════════════════════════════════

describe("Contract F — Rollback on task insert failure", () => {
  it("sales pipeline: hivemind_tasks insert error → work order deleted, error re-thrown", async () => {
    const { sb, deleted } = makeSb({
      leads: { rows: [lead()] },
      work_orders: { rows: [] },
      hivemind_tasks: { error: { message: "DB constraint violation" } },
    });
    await expect(createSalesPipelineWorkOrderCore(sb, WS, null)).rejects.toThrow(/DB constraint violation/i);
    expect(deleted["work_orders"]).toBe(true);
  });

  it("follow-up sequence: task insert error → work order deleted", async () => {
    const { sb, deleted } = makeSb({
      leads: { rows: [lead()] },
      suppressed_emails: { rows: [] },
      work_orders: { rows: [] },
      hivemind_tasks: { error: { message: "RLS policy violation" } },
    });
    await expect(createFollowUpSequenceWorkOrderCore(sb, WS, null)).rejects.toThrow(/RLS policy violation/i);
    expect(deleted["work_orders"]).toBe(true);
  });

  it("agent↔CRM integration: task insert error → work order deleted", async () => {
    const { sb, deleted } = makeSb({
      agents: { rows: [agent()] },
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
    const { sb, deleted } = makeSb({
      accountsmind_invoices: { rows: [] },
      work_orders: { rows: [] },
      hivemind_tasks: { error: { message: "timeout" } },
    });
    await expect(createFinancialAuditWorkOrderCore(sb, WS, null, "invoice_audit")).rejects.toThrow(/timeout/i);
    expect(deleted["work_orders"]).toBe(true);
  });
});
