/**
 * E2E tests for Task: AccountsMind config builder, onboarding assistant and
 * workspace health-check engine.
 *
 * Runs against the REAL shared Supabase database (service role) using a
 * throw-away random workspace id (tables have no FK on workspace_id), and
 * cleans up everything it creates.
 *
 * Run: npx vitest run --config vitest.e2e.config.ts
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  METRIC_REGISTRY,
  classifyConfigRisk,
  sanitizeGeneratedConfig,
  computeMetricsServer,
  activateAccountsMindConfigKind,
  listActiveConfigServer,
  setConfigItemStatusServer,
  rollbackConfigItemServer,
  setFieldValueServer,
  listFieldValuesServer,
} from "@/lib/accountsmind/accountsmind-config.server";
import {
  CHECK_REGISTRY,
  runChecksServer,
  activateOnboardingPlanKind,
  getSetupChecklistServer,
  runWorkspaceHealthCheckServer,
  listHealthRunsServer,
} from "@/lib/systemmind/workspace-setup.server";

const sb = supabaseAdmin as any;
const WS = randomUUID(); // throw-away workspace — no rows exist for it

const SENSITIVE_KEY = Object.values(METRIC_REGISTRY).find((m: any) => m.sensitive)?.key as string;
const SAFE_KEY      = Object.values(METRIC_REGISTRY).find((m: any) => !m.sensitive)?.key as string;

function baseCfg(over: Record<string, any> = {}) {
  return {
    name: "Test config",
    purpose: "e2e test",
    fields: [] as any[],
    stats: [] as any[],
    widgets: [] as any[],
    risks: [] as string[],
    test_plan: [] as string[],
    ...over,
  };
}

async function insertDraft(kind: string, payload: Record<string, any>): Promise<string> {
  const { data, error } = await sb.from("systemmind_generated_actions").insert({
    workspace_id: WS,
    action_kind:  kind,
    title:        payload.name ?? "e2e draft",
    purpose:      "e2e test draft",
    payload,
    status:       "approved",
    risk_level:   "low",
  }).select("id").single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

afterAll(async () => {
  for (const table of [
    "accountsmind_field_values",
    "accountsmind_field_defs",
    "accountsmind_stat_defs",
    "accountsmind_widget_defs",
    "workspace_setup_checklists",
    "workspace_health_runs",
    "systemmind_generated_actions",
    "systemmind_audit_logs",
    "hivemind_actions",
  ]) {
    await sb.from(table).delete().eq("workspace_id", WS);
  }
});

// ── 1. Guardrails: risk classification + sanitiser ────────────────────────────
describe("config guardrails", () => {
  it("has both sensitive and safe metrics in the registry", () => {
    expect(SENSITIVE_KEY).toBeTruthy();
    expect(SAFE_KEY).toBeTruthy();
  });

  it("forces sensitive metrics to client_visible=false", () => {
    const cfg = sanitizeGeneratedConfig(baseCfg({
      stats: [{ stat_key: "s_sensitive", label: "S", metric_key: SENSITIVE_KEY, format: "currency", client_visible: true, required: false, options: [] }],
      widgets: [{ widget_key: "w_sensitive", title: "W", widget_type: "stat_card", metric_key: SENSITIVE_KEY, format: "currency", client_visible: true }],
    }) as any);
    expect(cfg.stats[0].client_visible).toBe(false);
    expect(cfg.widgets[0].client_visible).toBe(false);
  });

  it("drops stats/widgets that reference unknown metrics", () => {
    const cfg = sanitizeGeneratedConfig(baseCfg({
      stats: [{ stat_key: "s_bad", label: "Bad", metric_key: "not_a_real_metric", format: "number", client_visible: false }],
      widgets: [{ widget_key: "w_ok", title: "OK", widget_type: "stat_card", metric_key: SAFE_KEY, format: "number", client_visible: true }],
    }) as any);
    expect(cfg.stats).toHaveLength(0);
    expect(cfg.widgets).toHaveLength(1);
  });

  it("forces currency custom fields to internal-only", () => {
    const cfg = sanitizeGeneratedConfig(baseCfg({
      fields: [{ field_key: "deal_value", label: "Deal value", field_type: "currency", entity_type: "client", appears_in: "both", required: false, options: [], client_visible: true }],
    }) as any);
    expect(cfg.fields[0].client_visible).toBe(false);
  });

  it("classifies billing-metric configs as high risk", () => {
    const { riskLevel, riskReasons } = classifyConfigRisk(baseCfg({
      stats: [{ stat_key: "s1", label: "Spend", metric_key: SENSITIVE_KEY, format: "currency", client_visible: false }],
    }) as any);
    expect(riskLevel).toBe("high");
    expect(riskReasons.length).toBeGreaterThan(0);
  });

  it("classifies a plain safe config as low risk", () => {
    const { riskLevel } = classifyConfigRisk(baseCfg({
      widgets: [{ widget_key: "w1", label: "L", title: "Calls", widget_type: "stat_card", metric_key: "calls_this_month", format: "count", client_visible: true }],
    }) as any);
    expect(riskLevel).toBe("low");
  });
});

// ── 2. Metrics engine ─────────────────────────────────────────────────────────
describe("computeMetricsServer", () => {
  it("returns numeric zeros/nulls for an empty workspace and ignores unknown keys", async () => {
    const out = await computeMetricsServer(WS, [SAFE_KEY, "bogus_metric"]);
    expect(out).toHaveProperty(SAFE_KEY);
    expect(out.bogus_metric ?? null).toBeNull();
    expect(typeof out[SAFE_KEY] === "number" || out[SAFE_KEY] === null).toBe(true);
  });
});

// ── 3. AccountsMind config activation lifecycle ──────────────────────────────
describe("accountsmind_config activation lifecycle", () => {
  let fieldId: string;
  let widgetId: string;

  it("activates a draft into versioned active rows", async () => {
    const draftId = await insertDraft("accountsmind_config", baseCfg({
      name: "Solar client dashboard",
      fields: [{ field_key: "panel_type", label: "Panel type", field_type: "single_select", entity_type: "client", appears_in: "client_section", required: false, options: ["mono", "poly"], client_visible: true }],
      stats: [{ stat_key: "monthly_calls", label: "Calls this month", metric_key: SAFE_KEY, format: "count", client_visible: true }],
      widgets: [{ widget_key: "calls_widget", title: "Calls", widget_type: "stat_card", metric_key: SAFE_KEY, format: "count", client_visible: true }],
    }));

    const res = await activateAccountsMindConfigKind(WS, draftId);
    expect(res.activatedTargetType).toBeTruthy();

    const cfg = await listActiveConfigServer(WS, { includeNonActive: true });
    expect(cfg.fields).toHaveLength(1);
    expect(cfg.stats).toHaveLength(1);
    expect(cfg.widgets).toHaveLength(1);
    expect(cfg.fields[0].version).toBe(1);
    fieldId = cfg.fields[0].id;
    widgetId = cfg.widgets[0].id;
  });

  it("strips a client-visible sensitive stat at activation time (defence-in-depth)", async () => {
    const draftId = await insertDraft("accountsmind_config", baseCfg({
      name: "Tampered config",
      stats: [{ stat_key: "sneaky_spend", label: "Spend", metric_key: SENSITIVE_KEY, format: "currency", client_visible: true }],
    }));
    await activateAccountsMindConfigKind(WS, draftId);
    const cfg = await listActiveConfigServer(WS, { includeNonActive: true });
    const sneaky = cfg.stats.find((s: any) => s.stat_key === "sneaky_spend");
    expect(sneaky).toBeTruthy();
    expect(sneaky.client_visible).toBe(false);
  });

  it("version-chains a re-activation of the same key", async () => {
    const draftId = await insertDraft("accountsmind_config", baseCfg({
      name: "Solar dashboard v2",
      fields: [{ field_key: "panel_type", label: "Panel type (updated)", field_type: "single_select", entity_type: "client", appears_in: "both", required: false, options: ["mono", "poly", "thin-film"], client_visible: true }],
    }));
    await activateAccountsMindConfigKind(WS, draftId);

    const cfg = await listActiveConfigServer(WS, { includeNonActive: true });
    const panel = cfg.fields.find((f: any) => f.field_key === "panel_type");
    expect(panel.version).toBe(2);
    expect(panel.previous_version_id).toBe(fieldId);
    expect(panel.label).toContain("updated");

    const { data: archived } = await sb.from("accountsmind_field_defs")
      .select("status").eq("id", fieldId).single();
    expect(archived.status).toBe("archived");
    fieldId = panel.id;
  });

  it("supports pause / reactivate status changes", async () => {
    await setConfigItemStatusServer(WS, null, "widget", widgetId, "paused");
    let cfg = await listActiveConfigServer(WS, { includeNonActive: true });
    expect(cfg.widgets.find((w: any) => w.id === widgetId).status).toBe("paused");

    await setConfigItemStatusServer(WS, null, "widget", widgetId, "active");
    cfg = await listActiveConfigServer(WS, { includeNonActive: true });
    expect(cfg.widgets.find((w: any) => w.id === widgetId).status).toBe("active");
  });

  it("rolls back a versioned field to its previous version", async () => {
    const res = await rollbackConfigItemServer(WS, null, "field", fieldId);
    expect(res.restoredId).toBeTruthy();
    const cfg = await listActiveConfigServer(WS, { includeNonActive: true });
    const panel = cfg.fields.find((f: any) => f.field_key === "panel_type");
    expect(panel.id).toBe(res.restoredId);
    expect(panel.label).toBe("Panel type");
  });

  it("clientOnly listing excludes internal-only items", async () => {
    const clientCfg = await listActiveConfigServer(WS, { clientOnly: true });
    expect(clientCfg.stats.find((s: any) => s.stat_key === "sneaky_spend")).toBeUndefined();
    expect(clientCfg.stats.find((s: any) => s.stat_key === "monthly_calls")).toBeTruthy();
  });

  it("stores and reads custom field values", async () => {
    const cfg = await listActiveConfigServer(WS, { includeNonActive: true });
    const panel = cfg.fields.find((f: any) => f.field_key === "panel_type");
    await setFieldValueServer(WS, null, panel.id, "client", "client-123", "mono");
    const vals = await listFieldValuesServer(WS, "client", "client-123");
    expect(vals.find((v: any) => v.field_def_id === panel.id)?.value).toBe("mono");
  });

  it("refuses to activate an empty/invalid payload", async () => {
    const draftId = await insertDraft("accountsmind_config", baseCfg({
      name: "Empty config",
      stats: [{ stat_key: "only_bogus", label: "Bogus", metric_key: "does_not_exist", format: "number", client_visible: false }],
    }));
    await expect(activateAccountsMindConfigKind(WS, draftId)).rejects.toThrow(/safety re-validation/);
  });
});

// ── 4. Onboarding checklist with derived completion ──────────────────────────
describe("onboarding plan activation + derived checklist", () => {
  // Workspace-data-only checks (no env-var or prior-test influence) so derived
  // completion is deterministically false on the throw-away workspace.
  const CHECK_KEYS_SAMPLE = [
    "business_dna_completed",
    "first_agent_created",
    "first_lead_captured",
    "first_call_completed",
  ];

  it("activates a plan draft into an active checklist", async () => {
    const draftId = await insertDraft("onboarding_plan", {
      name: "Dental clinic setup",
      business_summary: "Dental clinic wanting an AI receptionist.",
      items: CHECK_KEYS_SAMPLE.map((k) => ({
        check_key: k,
        title: CHECK_REGISTRY[k].label,
        why: "Needed for launch",
      })),
    });
    const res = await activateOnboardingPlanKind(WS, draftId);
    expect(res.activatedTargetType).toBe("workspace_setup_checklist");
    expect(res.summary.checklist_items).toBe(CHECK_KEYS_SAMPLE.length);
  });

  it("derives completion from live state (all false on empty workspace)", async () => {
    const { checklist, items, doneCount, totalCount } = await getSetupChecklistServer(WS);
    expect(checklist).toBeTruthy();
    expect(totalCount).toBe(CHECK_KEYS_SAMPLE.length);
    expect(doneCount).toBe(0);
    for (const i of items) expect(i.done).toBe(false);
  });

  it("drops unknown check keys during activation (sanitised)", async () => {
    const draftId = await insertDraft("onboarding_plan", {
      name: "Plan with junk",
      items: [
        { check_key: CHECK_KEYS_SAMPLE[0], title: "Real", why: "" },
        { check_key: "fake_check_key", title: "Fake", why: "" },
      ],
    });
    const res = await activateOnboardingPlanKind(WS, draftId);
    expect(res.summary.checklist_items).toBe(1);
  });

  it("rejects activation of a tampered draft containing credential-shaped values (TOCTOU)", async () => {
    const draftId = await insertDraft("onboarding_plan", {
      name: "Tampered plan",
      items: [{
        check_key: CHECK_KEYS_SAMPLE[0],
        title: "Configure Retell",
        why: "Use key sk-proj-abcdefghijklmnopqrstuvwxyz1234567890ABCDEFGH",
      }],
    });
    await expect(activateOnboardingPlanKind(WS, draftId)).rejects.toThrow(/credential/i);
  });

  it("runChecksServer returns a boolean for every registered check", async () => {
    const out = await runChecksServer(WS, Object.keys(CHECK_REGISTRY));
    // Checks that can legitimately pass here: voice_provider_connected (platform
    // RETELL_API_KEY env var) and accountsmind_config_active (rows created by the
    // activation tests above in this same throw-away workspace).
    const envOrPriorTest = new Set(["voice_provider_connected", "accountsmind_config_active"]);
    for (const k of Object.keys(CHECK_REGISTRY)) {
      expect(typeof out[k]).toBe("boolean");
      if (!envOrPriorTest.has(k)) expect(out[k], k).toBe(false);
    }
  });
});

// ── 5. Health-check engine ────────────────────────────────────────────────────
describe("workspace health check", () => {
  it("produces a scored run and proposes draft actions (never auto-fixes)", async () => {
    const res = await runWorkspaceHealthCheckServer(WS, null);
    // Not a fully healthy workspace — nearly everything is unconfigured.
    expect(res.percent).toBeLessThan(50);
    expect(res.maxScore).toBeGreaterThan(0);
    expect(res.findings.length).toBe(Object.keys(CHECK_REGISTRY).length);
    // Score must equal the summed weights of passing findings.
    const passedWeight = res.findings
      .filter((f: any) => f.passed)
      .reduce((s: number, f: any) => s + (CHECK_REGISTRY[f.check_key]?.weight ?? 0), 0);
    expect(res.score).toBe(passedWeight);
    expect(res.proposedActionIds.length).toBeGreaterThan(0);

    // Every proposed action is a PENDING create_task recommendation.
    const { data: actions } = await sb.from("hivemind_actions")
      .select("id, status, action_type, action_payload")
      .in("id", res.proposedActionIds);
    for (const a of actions) {
      expect(a.status).toBe("pending");
      expect(a.action_type).toBe("create_task");
      expect(a.action_payload.health_check_key).toBeTruthy();
    }
  });

  it("dedupes: a second run proposes no new actions while previous are pending", async () => {
    const res2 = await runWorkspaceHealthCheckServer(WS, null);
    expect(res2.proposedActionIds).toHaveLength(0);
  });

  it("persists runs readable via listHealthRunsServer", async () => {
    const runs = await listHealthRunsServer(WS);
    expect(runs.length).toBeGreaterThanOrEqual(2);
    expect(runs[0].status).toBe("complete");
    expect(runs[0].max_score).toBeGreaterThan(0);
    expect(Array.isArray(runs[0].findings)).toBe(true);
  });

  it("wrote audit log entries for the runs", async () => {
    const { data: audits } = await sb.from("systemmind_audit_logs")
      .select("id, action_type")
      .eq("workspace_id", WS)
      .eq("action_type", "run_health_check");
    expect((audits ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
