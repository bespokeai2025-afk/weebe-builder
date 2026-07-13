/**
 * E2E tests for Task: SystemMind Guided Agent Workflow Requirements assistant.
 *
 * Covers the spec §18 checklist: variable detection + mapping questions,
 * outcome→CRM questions (positive/neutral/negative), negative-reason script
 * addition drafted at the right point and approval-gated, extraction field +
 * CRM mapping created on approval, calling-mode/calls-per-day questions,
 * campaign/calling config saved, simulation (positive/neutral/negative/
 * callback + no-rule case), apply scoped to the current workspace only,
 * live agent never touched, other workspaces unaffected, WBAH isolation,
 * audit logging, and usage tracking on the re-prompt AI path.
 *
 * Runs against the REAL shared Supabase database (service role) using
 * throw-away workspaces + real agent rows (custom_agent_configs has FKs),
 * and cleans up everything it creates.
 *
 * Run: npx vitest run --config tests/e2e/vitest.e2e.config.ts tests/e2e/requirements-assistant.e2e.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  analyzeAgentForRequirements,
  buildRequirementsQuestions,
} from "@/lib/systemmind/requirements-analyzer.server";
import {
  startRequirementsInterviewServer,
  answerRequirementsQuestionsServer,
  generateRequirementsVersionServer,
  setScriptAdditionStatusServer,
  simulateRequirementsServer,
  simulateRequirementsOutcome,
  repromptRequirementsServer,
  buildRequirementsFromAnswers,
} from "@/lib/systemmind/requirements.server";
import { applyBuildVersionServer } from "@/lib/systemmind/build-workspace.server";

const sb = supabaseAdmin as any;
const WS = randomUUID();
const OTHER_WS = randomUUID();
const WBAH_WORKSPACE_ID = "5cb750b6-fabf-4e84-9b92-740df1cd8d53";
let AGENT_ID = "";
let LIVE_AGENT_SETTINGS_BEFORE: any = null;

const AGENT_SETTINGS = {
  agentType:    "lead_generation",
  channelType:  "voice",
  globalPrompt:
    "You are Ava, an outbound agent for Acme Roofing. Greet {{lead_name}} and ask about their {{roof_type}} and budget {{budget}}. If they want a survey, book an appointment for them.",
  beginMessage: "Hi {{lead_name}}, this is Ava from Acme Roofing.",
  booking:      { enabled: true },
  leadGen:      { variableMappings: { lead_name: "name" } },
};

beforeAll(async () => {
  const { data: anyWs } = await sb.from("workspaces").select("owner_id").limit(1).single();
  const ownerId = anyWs.owner_id as string;
  for (const [id, name] of [[WS, "e2e requirements ws"], [OTHER_WS, "e2e requirements other ws"]]) {
    const { error } = await sb.from("workspaces").insert({
      id, name, owner_id: ownerId, slug: `e2e-req-${String(id).slice(0, 8)}`,
    });
    if (error) throw new Error(`workspace fixture: ${error.message}`);
  }
  const { data: agent, error: aErr } = await sb.from("agents").insert({
    workspace_id: WS, user_id: ownerId, name: "e2e requirements agent",
    settings: AGENT_SETTINGS,
    flow_data: { nodes: [{ id: "n1", type: "conversation", data: { instruction: "If they ask for a callback, note it. Ask for {{postcode}}." } }], edges: [] },
  }).select("id, settings").single();
  if (aErr) throw new Error(`agent fixture: ${aErr.message}`);
  AGENT_ID = agent.id as string;
  LIVE_AGENT_SETTINGS_BEFORE = agent.settings;
}, 60000);

afterAll(async () => {
  for (const ws of [WS, OTHER_WS]) {
    for (const table of [
      "systemmind_requirements_interviews", "systemmind_build_messages",
      "systemmind_build_versions", "systemmind_build_snapshots", "systemmind_build_sessions",
      "systemmind_usage_events", "systemmind_audit_logs",
      "workspace_workflows", "custom_agent_configs", "campaigns", "agents",
    ]) {
      await sb.from(table).delete().eq("workspace_id", ws);
    }
    await sb.from("workspaces").delete().eq("id", ws);
  }
}, 120000);

describe("analyzer + question engine (§18 checks 1–5, 12)", () => {
  it("detects variables from prompt, flow and builder mappings (check 1)", async () => {
    const detected = await analyzeAgentForRequirements(WS, AGENT_ID);
    const names = detected.variables.map((v) => v.name);
    expect(names).toContain("lead_name");
    expect(names).toContain("roof_type");
    expect(names).toContain("budget");
    expect(names).toContain("postcode"); // from flow node
    // lead_name is already mapped via leadGen.variableMappings
    expect(detected.variables.find((v) => v.name === "lead_name")?.mappedTo).toBe("name");
    expect(detected.hasBookingLogic).toBe(true);
    expect(detected.hasCallbackLogic).toBe(true);
    expect(detected.hasOptOutLogic).toBe(false);
    expect(detected.hasNegativeReason).toBe(false);
  });

  it("asks mapping questions ONLY for unmapped variables (check 2) and outcome questions (checks 3–5) and calling mode (check 12)", async () => {
    const detected = await analyzeAgentForRequirements(WS, AGENT_ID);
    const qs = buildRequirementsQuestions(detected, {});
    const keys = qs.map((q) => q.key);
    expect(keys).toContain("map_variable_roof_type");
    expect(keys).toContain("map_variable_budget");
    expect(keys).not.toContain("map_variable_lead_name"); // already mapped — no question
    expect(keys).toContain("outcome_positive_status");
    expect(keys).toContain("outcome_neutral_status");
    expect(keys).toContain("outcome_negative_status");
    expect(keys).toContain("outcome_booked_status");   // booking detected
    expect(keys).toContain("capture_negative_reason"); // gap detected
    expect(keys).toContain("add_opt_out_handling");    // gap detected
    expect(keys).toContain("calling_mode");
    expect(keys).toContain("max_calls_per_day");       // check 13 asked
    // Every question carries a recommended default
    for (const q of qs) expect(q.recommendedDefault).not.toBeUndefined();
  });
});

describe("interview lifecycle → generation (§18 checks 6–8, 10–14)", () => {
  let interviewId = "";
  let sessionId = "";
  let versionId = "";

  it("starts an interview (creates a build session) and saves answers", async () => {
    const interview = await startRequirementsInterviewServer({
      workspaceId: WS, userId: null, agentId: AGENT_ID,
    });
    interviewId = interview.id;
    sessionId = interview.sessionId;
    expect(interview.status).toBe("in_progress");
    expect(interview.questions.length).toBeGreaterThan(5);

    const updated = await answerRequirementsQuestionsServer({
      workspaceId: WS, userId: null, interviewId,
      answers: {
        outcome_positive_status: "interested",
        outcome_neutral_status:  "contact_made",
        outcome_negative_status: "not_interested",
        capture_negative_reason: true,        // check 6: user requests negative reason
        add_opt_out_handling:    true,
        calling_mode:            "scheduled",
        max_calls_per_day:       80,          // check 13: user sets calls per day
        map_variable_budget:     "meta.budget",
      },
    });
    expect(updated.answers["max_calls_per_day"]).toBe(80);
    // scheduled mode unlocked the campaign-name question
    expect(updated.questions.some((q) => q.key === "campaign_name")).toBe(true);
  });

  it("rejects unknown/invalid answers (whitelist enforcement)", async () => {
    await expect(answerRequirementsQuestionsServer({
      workspaceId: WS, userId: null, interviewId,
      answers: { made_up_key: "x" },
    })).rejects.toThrow(/Unknown question key/);
    await expect(answerRequirementsQuestionsServer({
      workspaceId: WS, userId: null, interviewId,
      answers: { outcome_positive_status: "not_a_status" },
    })).rejects.toThrow(/not one of the allowed options/);
  });

  it("generates a draft version: script additions drafted not live (7–8), extraction+mapping created (10–11), calling/campaign saved (14)", async () => {
    const res = await generateRequirementsVersionServer({
      workspaceId: WS, userId: null, interviewId,
    });
    versionId = res.versionId;
    const req = res.requirements;

    // 7: script additions proposed at a sensible insert point
    const negAdd = req.script_additions.find((s) => s.id === "sa-negative-reason");
    const optAdd = req.script_additions.find((s) => s.id === "sa-opt-out");
    expect(negAdd?.status).toBe("proposed");
    expect(negAdd?.insert_position).toBe("before_closing");
    expect(optAdd?.status).toBe("proposed");

    // 10–11: negative_reason extraction field + CRM mapping
    expect(req.extraction_fields.some((f) => f.name === "negative_reason")).toBe(true);
    expect(req.variable_mappings["negative_reason"]).toBe("meta.negative_reason");
    expect(req.variable_mappings["budget"]).toBe("meta.budget");

    // 14: calling + paused campaign config saved
    expect(req.calling?.mode).toBe("scheduled");
    expect(req.calling?.max_calls_per_day).toBe(80);
    expect(req.campaign?.start_paused).toBe(true);

    // 8: draft only — version status draft, prompt does NOT yet contain the addition
    const { data: version } = await sb.from("systemmind_build_versions")
      .select("status, generated_config").eq("id", versionId).single();
    expect(version.status).toBe("draft");
    expect(String(version.generated_config.agent_prompt)).not.toContain("negative_reason");

    // 18: the LIVE agent row is untouched
    const { data: agentNow } = await sb.from("agents").select("settings").eq("id", AGENT_ID).single();
    expect(agentNow.settings).toEqual(LIVE_AGENT_SETTINGS_BEFORE);
  });

  it("approves the negative-reason script addition → merged into prompt as a NEW version (check 9)", async () => {
    const res = await setScriptAdditionStatusServer({
      workspaceId: WS, userId: null, interviewId,
      additionId: "sa-negative-reason", decision: "approved",
    });
    expect(res.versionId).not.toBe(versionId);
    const { data: v } = await sb.from("systemmind_build_versions")
      .select("generated_config, status").eq("id", res.versionId).single();
    expect(String(v.generated_config.agent_prompt)).toContain("negative_reason");
    const merged = v.generated_config.requirements.script_additions.find((s: any) => s.id === "sa-negative-reason");
    expect(merged.status).toBe("approved");
    // previous version still exists (rollback point)
    const { data: prev } = await sb.from("systemmind_build_versions").select("id").eq("id", versionId).single();
    expect(prev.id).toBe(versionId);
    versionId = res.versionId;

    // double-decide is refused
    await expect(setScriptAdditionStatusServer({
      workspaceId: WS, userId: null, interviewId,
      additionId: "sa-negative-reason", decision: "rejected",
    })).rejects.toThrow(/already approved/);
  });

  it("simulation covers positive/neutral/negative/callback/webform + unknown outcomes (check 15) without writing CRM data", async () => {
    const before = await sb.from("leads").select("id", { count: "exact", head: true }).eq("workspace_id", WS);
    const results = await simulateRequirementsServer({
      workspaceId: WS, userId: null, interviewId, outcome: null,
    });
    const byOutcome = Object.fromEntries(results.map((r) => [r.outcome, r]));
    expect(byOutcome["positive"].matched).toBe(true);
    expect(byOutcome["positive"].actions.some((a) => a.detail.includes('"interested"'))).toBe(true);
    expect(byOutcome["neutral"].actions.some((a) => a.action === "create_callback")).toBe(true);
    expect(byOutcome["negative"].actions.some((a) => a.action === "add_note")).toBe(true);
    // callback + webform are part of the DEFAULT scenario run (spec §18 check 15)
    expect(byOutcome["callback_requested"].matched).toBe(true);
    expect(byOutcome["callback_requested"].actions.some((a) => a.action === "create_callback")).toBe(true);
    expect(byOutcome["webform_lead"].matched).toBe(true);
    expect(byOutcome["webform_lead"].actions.some((a) => a.action === "add_to_campaign")).toBe(true); // scheduled mode
    expect(byOutcome["webform_lead"].actions.some((a) => a.action === "queue_instant_call")).toBe(false);
    // unknown outcome → explicit no-rule result, never a crash
    const unknown = simulateRequirementsOutcome(
      (await sb.from("systemmind_build_versions").select("generated_config").eq("id", versionId).single()).data.generated_config.requirements,
      "wrong_number",
    );
    expect(unknown.matched).toBe(false);
    // no leads written
    const after = await sb.from("leads").select("id", { count: "exact", head: true }).eq("workspace_id", WS);
    expect(after.count ?? 0).toBe(before.count ?? 0);
  });

  it("apply persists config to THIS workspace only, campaign created PAUSED, live agent + other workspaces untouched (checks 16–19)", async () => {
    const res = await applyBuildVersionServer({
      workspaceId: WS, userId: null, sessionId, versionId,
    });
    expect(res.workflowId).toBeTruthy();

    // custom_agent_configs got the requirements payload
    const { data: cfg } = await sb.from("custom_agent_configs")
      .select("crm_field_mapping, outcome_schema, deployment_config, workspace_id")
      .eq("workspace_id", WS).eq("agent_id", AGENT_ID).single();
    expect(cfg.crm_field_mapping["negative_reason"]).toBe("meta.negative_reason");
    expect(cfg.outcome_schema.outcome_rules.length).toBeGreaterThan(4);
    expect(cfg.deployment_config.requirements.calling.mode).toBe("scheduled");

    // campaign created paused, in this workspace only
    const { data: camps } = await sb.from("campaigns").select("name, status, workspace_id").eq("workspace_id", WS);
    expect(camps.length).toBe(1);
    expect(camps[0].status).toBe("paused");

    // 18: live agent untouched
    const { data: agentNow } = await sb.from("agents").select("settings, retell_agent_id").eq("id", AGENT_ID).single();
    expect(agentNow.settings).toEqual(LIVE_AGENT_SETTINGS_BEFORE);
    expect(agentNow.retell_agent_id).toBeNull();

    // 19: other workspace has nothing
    for (const table of ["workspace_workflows", "custom_agent_configs", "campaigns", "systemmind_build_sessions"]) {
      const { count } = await sb.from(table).select("*", { count: "exact", head: true }).eq("workspace_id", OTHER_WS);
      expect(count ?? 0).toBe(0);
    }

    // auto-call switch NEVER flipped
    const { data: ws } = await sb.from("workspace_settings").select("lead_auto_call_enabled").eq("workspace_id", WS).maybeSingle();
    expect(ws?.lead_auto_call_enabled ?? false).toBe(false);
  });

  it("audit-logs every stage (check 21)", async () => {
    const { data: logs } = await sb.from("systemmind_audit_logs")
      .select("action_type").eq("workspace_id", WS);
    const types = (logs ?? []).map((l: any) => l.action_type);
    expect(types).toContain("requirements_interview_started");
    expect(types).toContain("requirements_answers_saved");
    expect(types).toContain("requirements_version_generated");
    expect(types).toContain("requirements_script_addition_approved");
    expect(types).toContain("requirements_simulated");
  });
});

describe("isolation + safety rails (§18 checks 20, 22)", () => {
  it("WBAH is hard-blocked from the requirements flow (check 20)", async () => {
    await expect(startRequirementsInterviewServer({
      workspaceId: WBAH_WORKSPACE_ID, userId: null, agentId: randomUUID(),
    })).rejects.toThrow();
  });

  it("re-prompt AI path records token/time usage (check 22)", async () => {
    // Deterministic paths (generate/simulate) are free — no usage events yet.
    const { data: pre } = await sb.from("systemmind_usage_events")
      .select("task_type").eq("workspace_id", WS);
    expect((pre ?? []).filter((e: any) => e.task_type === "requirements_reprompt").length).toBe(0);

    // Empty instruction is rejected BEFORE any model spend — still no event.
    const { data: iv } = await sb.from("systemmind_requirements_interviews")
      .select("id").eq("workspace_id", WS).limit(1).single();
    await expect(repromptRequirementsServer({
      workspaceId: WS, userId: null, interviewId: iv.id, instruction: "   ",
    })).rejects.toThrow(/Describe the change/);

    // Real reprompt through the AI path: success OR failure, a usage event
    // with provider/model + timing must be recorded either way.
    let succeeded = false;
    try {
      const res = await repromptRequirementsServer({
        workspaceId: WS, userId: null, interviewId: iv.id,
        instruction: "Change the maximum calls per day to 40.",
      });
      succeeded = true;
      expect(res.changedKeys).toContain("max_calls_per_day");
    } catch {
      // model unavailable/failed — the failure event is still required below
    }
    const { data: post } = await sb.from("systemmind_usage_events")
      .select("task_type, success, model_provider, started_at, completed_at")
      .eq("workspace_id", WS).eq("task_type", "requirements_reprompt");
    expect((post ?? []).length).toBeGreaterThanOrEqual(1);
    const ev = (post ?? [])[0];
    expect(ev.started_at).toBeTruthy();
    expect(ev.completed_at).toBeTruthy();
    if (succeeded) {
      expect(ev.success).toBe(true);
      expect(ev.model_provider).toBeTruthy();
    }
  }, 120000);

  it("generator is deterministic and pure: same answers → same requirements", async () => {
    const detected = await analyzeAgentForRequirements(WS, AGENT_ID);
    const answers = { outcome_positive_status: "qualified", calling_mode: "draft" } as const;
    const a = buildRequirementsFromAnswers(detected, { ...answers });
    const b = buildRequirementsFromAnswers(detected, { ...answers });
    expect(JSON.parse(JSON.stringify(a))).toEqual(JSON.parse(JSON.stringify(b)));
    expect(a.calling?.mode).toBe("draft");
    expect(a.campaign).toBeUndefined(); // draft mode → no campaign
    expect(a.outcome_rules.find((r) => r.outcome === "positive")?.crm_status).toBe("qualified");
  });

  it("rejects a broken calling window instead of silently defaulting", async () => {
    const detected = await analyzeAgentForRequirements(WS, AGENT_ID);
    expect(() => buildRequirementsFromAnswers(detected, { calling_window_start: "9am" }))
      .toThrow(/must be HH:MM/);
  });
});
