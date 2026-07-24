/**
 * E2E tests for Task #456: SystemMind agent scanner & dynamic variable engine.
 *
 * Covers: scanner extraction (prompt/start message/flow nodes/builder vars/
 * module mappings/custom_agent_configs), detected-requirements report
 * (integrations, credential NAMES only, webhook events), variable persistence
 * with type/direction/sensitivity classification, re-scan preserving reviewed
 * rows, approval lifecycle (approve/edit/reject/reopen), transformation rule
 * CRUD + all 10 pure transformations, mapping CRUD with cross-tenant guards,
 * the end-to-end test trace endpoint, WBAH hard-block and workspace isolation.
 *
 * Runs against the REAL shared Supabase database (service role) using
 * throw-away workspaces + real agent rows, and cleans up everything.
 *
 * Run: npx vitest run --config tests/e2e/vitest.e2e.config.ts tests/e2e/variable-engine.e2e.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  scanAgentVariablesServer,
  listDynamicVariablesServer,
  getLatestScanServer,
  reviewDynamicVariableServer,
  listTransformationRulesServer,
  saveTransformationRuleServer,
  deleteTransformationRuleServer,
  listVariableMappingsServer,
  saveVariableMappingServer,
  deleteVariableMappingServer,
  testTransformationRuleServer,
  runTransformationTest,
} from "@/lib/systemmind/variable-engine.server";
import { applyTransformation, validateByDataType } from "@/lib/systemmind/variable-transforms.shared";

const sb = supabaseAdmin as any;
const WS = randomUUID();
const OTHER_WS = randomUUID();
const WBAH_WORKSPACE_ID = "5cb750b6-fabf-4e84-9b92-740df1cd8d53";
let AGENT_ID = "";
let OTHER_AGENT_ID = "";
let OWNER_ID = "";

const AGENT_SETTINGS = {
  agentType:   "lead_generation",
  channelType: "voice",
  globalPrompt:
    "You are Ava for Acme Lettings. Greet {{first_name}} {{last_name}}, confirm their {{email}} and {{phone_number}}, ask about their {{budget}} and preferred {{property_type}}. Book a viewing if interested.",
  beginMessage: "Hi {{first_name}}, this is Ava.",
  booking: { enabled: true },
  leadGen: {
    variableMappings: { first_name: "first_name" },
    postCallMappings: { call_summary: "notes", sentiment: "sentiment" },
  },
};
const FLOW_DATA = {
  nodes: [
    { id: "n1", type: "conversation", data: { instruction: "Ask for the {{postcode}} and whether they need a callback." } },
    { id: "n2", type: "extract_variables", data: { label: "Capture outcome", variables: [{ name: "viewing_slot", type: "datetime" }, { name: "negative_reason", type: "string" }] } },
    { id: "n3", type: "http_request", data: { label: "Notify CRM", url: "https://example.com/webhook", body: "{{call_summary}}" } },
  ],
  edges: [],
};

beforeAll(async () => {
  const { data: anyWs } = await sb.from("workspaces").select("owner_id").limit(1).single();
  OWNER_ID = anyWs.owner_id as string;
  for (const [id, name] of [[WS, "e2e varengine ws"], [OTHER_WS, "e2e varengine other ws"]]) {
    const { error } = await sb.from("workspaces").insert({
      id, name, owner_id: OWNER_ID, slug: `e2e-vare-${String(id).slice(0, 8)}`,
    });
    if (error) throw new Error(`workspace fixture: ${error.message}`);
  }
  const { data: agent, error: aErr } = await sb.from("agents").insert({
    workspace_id: WS, user_id: OWNER_ID, name: "e2e varengine agent",
    settings: AGENT_SETTINGS, flow_data: FLOW_DATA,
    variables: [{ name: "company_name", type: "string" }],
  }).select("id").single();
  if (aErr) throw new Error(`agent fixture: ${aErr.message}`);
  AGENT_ID = agent.id as string;

  const { data: other, error: oErr } = await sb.from("agents").insert({
    workspace_id: OTHER_WS, user_id: OWNER_ID, name: "e2e varengine other agent",
    settings: { globalPrompt: "Say hi to {{other_var}}." }, flow_data: { nodes: [], edges: [] },
  }).select("id").single();
  if (oErr) throw new Error(`other agent fixture: ${oErr.message}`);
  OTHER_AGENT_ID = other.id as string;
}, 60000);

afterAll(async () => {
  for (const ws of [WS, OTHER_WS]) {
    for (const table of [
      "systemmind_variable_mappings", "systemmind_transformation_rules",
      "systemmind_dynamic_variables", "systemmind_agent_scans",
      "systemmind_audit_logs", "agents",
    ]) {
      await sb.from(table).delete().eq("workspace_id", ws);
    }
    await sb.from("workspaces").delete().eq("id", ws);
  }
}, 60000);

describe("pure transformation library", () => {
  it("date_format renders dmy and iso_date", () => {
    expect(applyTransformation("date_format", "2026-07-24T10:30:00Z", { outputFormat: "dmy" })).toEqual({ ok: true, value: "24/07/2026" });
    expect(applyTransformation("date_format", "2026-07-24T10:30:00Z", { outputFormat: "iso_date" }).value).toBe("2026-07-24");
    expect(applyTransformation("date_format", "not a date", { outputFormat: "dmy" }).ok).toBe(false);
  });
  it("phone_e164 normalises UK national numbers", () => {
    expect(applyTransformation("phone_e164", "07700 900123", { defaultCountryCode: "44" }).value).toBe("+447700900123");
    expect(applyTransformation("phone_e164", "0044 7700 900123", {}).value).toBe("+447700900123");
    expect(applyTransformation("phone_e164", "+1 (415) 555-0123", {}).value).toBe("+14155550123");
    expect(applyTransformation("phone_e164", "abc", {}).ok).toBe(false);
  });
  it("currency_format handles symbol/code/number styles", () => {
    expect(applyTransformation("currency_format", "1250.5", { currency: "GBP" }).value).toBe("£1250.50");
    expect(applyTransformation("currency_format", 99, { style: "code", currency: "USD" }).value).toBe("99.00 USD");
    expect(applyTransformation("currency_format", "£1,000", { style: "number" }).value).toBe(1000);
  });
  it("boolean_map and enum_map map values with fallbacks", () => {
    expect(applyTransformation("boolean_map", "yes", { trueOutput: "Y", falseOutput: "N" }).value).toBe("Y");
    expect(applyTransformation("boolean_map", "maybe", {}).ok).toBe(false);
    expect(applyTransformation("enum_map", "Interested", { map: { interested: "qualified" } }).value).toBe("qualified");
    expect(applyTransformation("enum_map", "unknown", { map: {}, defaultOutput: "need_to_call" }).value).toBe("need_to_call");
  });
  it("concat, name_split, null_fallback", () => {
    expect(applyTransformation("concat", { first_name: "Ada", last_name: "Lovelace" }, { fields: ["first_name", "last_name"] }).value).toBe("Ada Lovelace");
    expect(applyTransformation("name_split", "Ada Mary Lovelace", { part: "last" }).value).toBe("Mary Lovelace");
    expect(applyTransformation("null_fallback", "", { fallback: "unknown" }).value).toBe("unknown");
    expect(applyTransformation("null_fallback", "kept", { fallback: "unknown" }).value).toBe("kept");
  });
  it("conditional and custom_json", () => {
    const cfg = { conditions: [{ op: "gt", compareTo: 100000, output: "premium" }], defaultOutput: "standard" };
    expect(applyTransformation("conditional", "250000", cfg).value).toBe("premium");
    expect(applyTransformation("conditional", "50", cfg).value).toBe("standard");
    const t = applyTransformation("custom_json", { first: "Ada" }, { template: { name: "{{value.first}}", raw: "{{value}}" } });
    expect((t.value as any).name).toBe("Ada");
  });
  it("validateByDataType catches bad emails/phones/urls", () => {
    expect(validateByDataType("email", "a@b.co").valid).toBe(true);
    expect(validateByDataType("email", "nope").valid).toBe(false);
    expect(validateByDataType("phone", "+447700900123").valid).toBe(true);
    expect(validateByDataType("phone", "07700").valid).toBe(false);
    expect(validateByDataType("url", "https://x.dev").valid).toBe(true);
    expect(validateByDataType("json", "{\"a\":1}").valid).toBe(true);
  });
  it("runTransformationTest returns a full trace with fallback + validation", () => {
    const trace = runTransformationTest({
      ruleType: "phone_e164", config: {}, sampleValue: "garbage", dataType: "phone", fallbackValue: "+447000000000",
    });
    expect(trace.transformed.ok).toBe(false);
    expect(trace.destinationValue).toBe("+447000000000");
    expect(trace.validation.valid).toBe(true);
  });
});

describe("agent scanner", () => {
  it("scans the agent, persists a report and detected variables", async () => {
    const res = await scanAgentVariablesServer({ workspaceId: WS, userId: OWNER_ID, agentId: AGENT_ID, useAi: false });
    expect(res.scanId).toBeTruthy();
    const names = res.variables.map((v) => v.name);
    for (const expected of ["first_name", "last_name", "email", "phone_number", "budget", "property_type", "postcode", "viewing_slot", "negative_reason", "call_summary", "sentiment", "company_name"]) {
      expect(names).toContain(expected);
    }
    // Classification: types, sensitivity, direction
    const byName = new Map(res.variables.map((v) => [v.name, v]));
    expect(byName.get("email")!.dataType).toBe("email");
    expect(byName.get("email")!.sensitivity).toBe("personal");
    expect(byName.get("phone_number")!.dataType).toBe("phone");
    expect(byName.get("budget")!.dataType).toBe("currency");
    expect(byName.get("budget")!.sensitivity).toBe("financial");
    expect(byName.get("viewing_slot")!.dataType).toBe("datetime");
    expect(byName.get("first_name")!.direction).toBe("webee_to_retell_precall");
    expect(byName.get("call_summary")!.direction).toBe("retell_to_webee");
    expect(byName.get("viewing_slot")!.status).toBe("detected");
    // Provenance labels
    expect(byName.get("viewing_slot")!.detectedSources.join(" ")).toMatch(/Extract Variable node/);
    expect(byName.get("first_name")!.detectedSources).toContain("Global prompt");

    // Report: integrations + webhook events + credential NAMES only
    expect(res.report.requiredIntegrations).toContain("calendar");
    expect(res.report.requiredIntegrations).toContain("webhook");
    expect(res.report.requiredWebhookEvents).toContain("call_ended");
    expect(JSON.stringify(res.report)).not.toMatch(/sk-[a-zA-Z0-9]{20}/);
    expect(res.report.hasBookingLogic).toBe(true);
    expect(res.report.hasWebhookLogic).toBe(true);

    const latest = await getLatestScanServer({ workspaceId: WS, agentId: AGENT_ID });
    expect(latest?.scanId).toBe(res.scanId);
  }, 60000);

  it("re-scan never clobbers reviewed rows", async () => {
    const vars = await listDynamicVariablesServer({ workspaceId: WS, agentId: AGENT_ID });
    const email = vars.find((v) => v.name === "email")!;
    await reviewDynamicVariableServer({
      workspaceId: WS, userId: OWNER_ID, variableId: email.id, action: "edit",
      edits: { destination_field: "custom_email_field", sensitivity: "restricted" },
    });
    const res2 = await scanAgentVariablesServer({ workspaceId: WS, userId: OWNER_ID, agentId: AGENT_ID, useAi: false });
    const emailAfter = res2.variables.find((v) => v.name === "email")!;
    expect(emailAfter.status).toBe("edited");
    expect(emailAfter.destinationField).toBe("custom_email_field");
    expect(emailAfter.sensitivity).toBe("restricted");
    expect(res2.report.newVariableCount).toBe(0);
  }, 60000);

  it("blocks WBAH and enforces workspace scoping", async () => {
    await expect(scanAgentVariablesServer({ workspaceId: WBAH_WORKSPACE_ID, userId: null, agentId: AGENT_ID }))
      .rejects.toThrow(/WBAH|not available/i);
    await expect(scanAgentVariablesServer({ workspaceId: WS, userId: null, agentId: OTHER_AGENT_ID }))
      .rejects.toThrow(/not found/i);
  }, 30000);
});

describe("approval lifecycle", () => {
  it("approve → reject → reopen transitions with audit fields", async () => {
    const vars = await listDynamicVariablesServer({ workspaceId: WS, agentId: AGENT_ID });
    const v = vars.find((x) => x.name === "budget")!;
    const approved = await reviewDynamicVariableServer({ workspaceId: WS, userId: OWNER_ID, variableId: v.id, action: "approve" });
    expect(approved.status).toBe("approved");
    expect(approved.reviewedAt).toBeTruthy();
    const rejected = await reviewDynamicVariableServer({ workspaceId: WS, userId: OWNER_ID, variableId: v.id, action: "reject" });
    expect(rejected.status).toBe("rejected");
    const reopened = await reviewDynamicVariableServer({ workspaceId: WS, userId: OWNER_ID, variableId: v.id, action: "reopen" });
    expect(reopened.status).toBe("detected");
    expect(reopened.reviewedAt).toBeNull();
  }, 30000);

  it("rejects non-editable fields and cross-workspace review", async () => {
    const vars = await listDynamicVariablesServer({ workspaceId: WS, agentId: AGENT_ID });
    const v = vars[0];
    await expect(reviewDynamicVariableServer({
      workspaceId: WS, userId: OWNER_ID, variableId: v.id, action: "edit", edits: { workspace_id: OTHER_WS },
    })).rejects.toThrow(/not editable/i);
    await expect(reviewDynamicVariableServer({
      workspaceId: OTHER_WS, userId: OWNER_ID, variableId: v.id, action: "approve",
    })).rejects.toThrow(/not found/i);
  }, 30000);
});

describe("transformation rules + mappings", () => {
  let ruleId = "";
  it("creates, lists, tests and updates a rule", async () => {
    const rule = await saveTransformationRuleServer({
      workspaceId: WS, userId: OWNER_ID, name: "UK phone normaliser",
      ruleType: "phone_e164", config: { defaultCountryCode: "44" },
    });
    ruleId = rule.id;
    const rules = await listTransformationRulesServer({ workspaceId: WS });
    expect(rules.some((r) => r.id === ruleId)).toBe(true);

    const trace = await testTransformationRuleServer({
      workspaceId: WS, ruleId, sampleValue: "07700 900123", dataType: "phone",
    });
    expect(trace.transformed.ok).toBe(true);
    expect(trace.destinationValue).toBe("+447700900123");
    expect(trace.validation.valid).toBe(true);

    await expect(saveTransformationRuleServer({
      workspaceId: WS, userId: OWNER_ID, name: "UK phone normaliser", ruleType: "phone_e164", config: {},
    })).rejects.toThrow(/already exists/i);
    await expect(saveTransformationRuleServer({
      workspaceId: WS, userId: OWNER_ID, name: "bad", ruleType: "sql_inject", config: {},
    })).rejects.toThrow(/Unknown rule type/i);
  }, 30000);

  it("creates a mapping bound to workspace-scoped variable + rule, blocks cross-tenant", async () => {
    const vars = await listDynamicVariablesServer({ workspaceId: WS, agentId: AGENT_ID });
    const phone = vars.find((v) => v.name === "phone_number")!;
    const mapping = await saveVariableMappingServer({
      workspaceId: WS, userId: OWNER_ID, variableId: phone.id, direction: "webee_to_retell_precall",
      sourceSystem: "webee", sourceObject: "lead", sourceField: "phone",
      destinationSystem: "retell", destinationObject: "call", destinationField: "phone_number",
      transformationRuleId: ruleId,
    });
    expect(mapping.transformationRuleId).toBe(ruleId);
    const list = await listVariableMappingsServer({ workspaceId: WS, agentId: AGENT_ID });
    expect(list.some((m) => m.id === mapping.id)).toBe(true);

    // Cross-tenant guards: variable and rule must belong to the caller workspace
    await expect(saveVariableMappingServer({
      workspaceId: OTHER_WS, userId: OWNER_ID, variableId: phone.id, direction: "retell_to_webee",
    })).rejects.toThrow(/not found/i);
    await expect(saveVariableMappingServer({
      workspaceId: WS, userId: OWNER_ID, variableId: phone.id, direction: "retell_to_webee",
      transformationRuleId: randomUUID(),
    })).rejects.toThrow(/not found/i);

    await deleteVariableMappingServer({ workspaceId: WS, id: mapping.id });
    await deleteTransformationRuleServer({ workspaceId: WS, userId: OWNER_ID, id: ruleId });
  }, 30000);

  it("workspace isolation: other workspace sees nothing", async () => {
    const otherVars = await listDynamicVariablesServer({ workspaceId: OTHER_WS, agentId: AGENT_ID });
    expect(otherVars).toEqual([]);
    const otherRules = await listTransformationRulesServer({ workspaceId: OTHER_WS });
    expect(otherRules.filter((r) => r.name === "UK phone normaliser")).toEqual([]);
  }, 30000);
});
