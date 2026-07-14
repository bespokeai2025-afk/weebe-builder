// ── SystemMind Test Call Validation Loop — server-only ─────────────────────────
// After a build session produces a draft/applied version, the user runs a REAL
// test call against the target agent. This module fetches that call from the
// workspace's own calls table, runs deterministic checks plus an AI expected-vs-
// actual analysis against the version's generated_config, stores the outcome in
// systemmind_test_calls, and exposes the gate state that makes a passed test
// MANDATORY before Go Live — but only for SystemMind-built deployments.
//
// Safety invariants (mirror build-workspace.server.ts):
//   • workspace_id comes ONLY from server context.
//   • This module never initiates calls, never edits agents/workflows — fixes
//     are proposed as a prompt back into the build session (normal draft +
//     approval machinery).
//   • Every AI analysis writes a systemmind_usage_events row; every result
//     writes a systemmind_audit_logs row.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { routeGenerate } from "@/lib/growthmind/model-router.server";
import { writeSystemMindAudit, isClaudeEnabled } from "@/lib/systemmind/systemmind-automation.server";
import { recordSystemMindUsageEvent } from "@/lib/systemmind/build-workspace.server";

const sb = () => supabaseAdmin as any;

export const TEST_SCENARIOS = [
  { id: "positive_booked",    label: "Positive — appointment booked" },
  { id: "neutral_follow_up",  label: "Neutral — follow-up needed" },
  { id: "negative_reason",    label: "Negative — reason capture" },
  { id: "callback_requested", label: "Callback requested" },
  { id: "no_answer",          label: "No answer" },
  { id: "voicemail",          label: "Voicemail" },
  { id: "opt_out",            label: "Opt-out" },
  { id: "custom",             label: "Custom scenario" },
] as const;

export type TestCheck = {
  key: string;
  label: string;
  status: "passed" | "failed" | "warning";
  detail: string;
};

async function getSessionOrThrow(workspaceId: string, sessionId: string): Promise<any> {
  const { data, error } = await sb().from("systemmind_build_sessions")
    .select("*")
    .eq("id", sessionId).eq("workspace_id", workspaceId).eq("is_deleted", false)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Build session not found in this workspace.");
  return data;
}

async function getCurrentVersion(workspaceId: string, session: any): Promise<any | null> {
  if (!session.current_version_id) return null;
  const { data } = await sb().from("systemmind_build_versions")
    .select("id, version_number, generated_config, risk_level, status")
    .eq("id", session.current_version_id).eq("workspace_id", workspaceId)
    .maybeSingle();
  return data ?? null;
}

// ── Candidate calls ("I made the test call") ──────────────────────────────────
export async function listTestCallCandidatesServer(args: {
  workspaceId: string;
  sessionId: string;
}): Promise<any[]> {
  const session = await getSessionOrThrow(args.workspaceId, args.sessionId);
  const since = new Date(Date.now() - 48 * 3600_000).toISOString();
  let q = sb().from("calls")
    .select("id, retell_call_id, agent_id, agent_name, to_number, from_number, started_at, created_at, duration_seconds, call_status, sentiment, call_outcome, is_voicemail, lead_id, transcript")
    .eq("workspace_id", args.workspaceId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(10);
  if (session.target_agent_id) q = q.eq("agent_id", session.target_agent_id);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  // Never ship full transcripts in the candidate list — a short preview only.
  return (data ?? []).map((c: any) => ({
    ...c,
    transcript: undefined,
    has_transcript: !!(c.transcript && c.transcript.trim()),
  }));
}

// ── Expected outcome derived from the version config ──────────────────────────
export function deriveExpectedOutcome(config: any, scenario: string): Record<string, unknown> {
  const extractionFields = (config?.extraction_fields ?? []).map((f: any) => f.name);
  const variables        = (config?.variables ?? []).map((v: any) => v.name);
  const followUps        = (config?.follow_up_rules ?? []).map((r: any) => `${r.trigger} → ${r.action}`);
  const base = {
    scenario,
    workflow_name: config?.workflow?.name ?? null,
    trigger_type: config?.workflow?.trigger_type ?? null,
    expected_extraction_fields: extractionFields,
    expected_variables: variables,
    follow_up_rules: followUps,
  };
  switch (scenario) {
    case "positive_booked":
      return { ...base, expected_sentiment: "positive", appointment_booked: true, lead_expected: true, qualified_expected: true };
    case "neutral_follow_up":
      return { ...base, expected_sentiment: "neutral", lead_expected: true, follow_up_expected: true };
    case "negative_reason":
      return { ...base, expected_sentiment: "negative", negative_reason_expected: true, qualified_expected: false };
    case "callback_requested":
      return { ...base, callback_expected: true, appointment_booked: false };
    case "no_answer":
    case "voicemail":
      return { ...base, connected: false, qualified_expected: false };
    case "opt_out":
      return { ...base, suppression_expected: true, qualified_expected: false };
    default:
      return base;
  }
}

// ── Analysis ───────────────────────────────────────────────────────────────────
export async function analyzeTestCallServer(args: {
  workspaceId: string;
  userId: string | null;
  sessionId: string;
  callId: string;
  scenario: string;
}): Promise<any> {
  const { workspaceId, userId, sessionId } = args;
  const scenario = TEST_SCENARIOS.some((s) => s.id === args.scenario) ? args.scenario : "custom";
  const session = await getSessionOrThrow(workspaceId, sessionId);
  const version = await getCurrentVersion(workspaceId, session);
  if (!version) throw new Error("This session has no version yet — generate a build first.");

  // Workspace-scoped call load — a foreign call id must never resolve.
  const { data: call, error: cErr } = await sb().from("calls")
    .select("*")
    .eq("id", args.callId).eq("workspace_id", workspaceId)
    .maybeSingle();
  if (cErr) throw new Error(cErr.message);
  if (!call) throw new Error("Test call not found in this workspace.");
  // The analyzed call must belong to the session's target agent — a passing
  // call from another agent in the same workspace must never satisfy the gate.
  if (session.target_agent_id && call.agent_id !== session.target_agent_id) {
    throw new Error("That call was made to a different agent — pick a call made to this build's target agent.");
  }

  const config = version.generated_config ?? {};
  const expected = deriveExpectedOutcome(config, scenario);

  // Deterministic checks first — cheap, evidence-based.
  const checks: TestCheck[] = [];
  const connectedScenario = !["no_answer", "voicemail"].includes(scenario);
  const hasTranscript = !!(call.transcript && String(call.transcript).trim().length > 20);

  checks.push({
    key: "call_recorded",
    label: "Call recorded in workspace",
    status: "passed",
    detail: `Call ${call.retell_call_id ?? call.id} found (${call.duration_seconds ?? 0}s, status ${call.call_status}).`,
  });
  if (connectedScenario) {
    checks.push({
      key: "transcript_captured",
      label: "Transcript captured",
      status: hasTranscript ? "passed" : "failed",
      detail: hasTranscript
        ? "Transcript is present for analysis."
        : "No usable transcript — the call may not have connected, or the post-call webhook did not fire.",
    });
    const expSent = (expected as any).expected_sentiment as string | undefined;
    if (expSent) {
      checks.push({
        key: "sentiment_match",
        label: `Sentiment is ${expSent}`,
        status: call.sentiment === expSent ? "passed" : call.sentiment ? "failed" : "warning",
        detail: call.sentiment
          ? `Detected sentiment: ${call.sentiment}.`
          : "No sentiment recorded yet — analysis may still be processing.",
      });
    }
    if ((expected as any).lead_expected) {
      checks.push({
        key: "lead_written",
        label: "Lead created/updated",
        status: call.lead_id ? "passed" : "failed",
        detail: call.lead_id
          ? `Call is linked to lead ${call.lead_id}.`
          : "No lead is linked to this call — CRM write may have failed or the mapping is missing.",
      });
    }
  } else {
    checks.push({
      key: "not_connected_logged",
      label: "Unanswered call logged",
      status: "passed",
      detail: `Call logged with status ${call.call_status}${call.is_voicemail ? " (voicemail)" : ""}.`,
    });
  }

  // AI expected-vs-actual analysis (transcript + summary vs config).
  const startedAt = new Date();
  let ai: { passed: boolean; checks: TestCheck[]; diagnosis: string; suggested_fix: string } = {
    passed: false, checks: [], diagnosis: "", suggested_fix: "",
  };
  let modelProvider: string | null = null;
  let modelId: string | null = null;
  let promptTokens = 0, completionTokens = 0;
  if (hasTranscript || call.call_summary) {
    const claudeEnabled = isClaudeEnabled();
    const sys = `You are SystemMind, validating a TEST CALL against an agent workflow build. Compare the expected behaviour to what actually happened. Judge only from the evidence given. Respond with STRICT JSON only:
{"passed": boolean, "checks": [{"key": string, "label": string, "status": "passed"|"failed"|"warning", "detail": string}], "diagnosis": string, "suggested_fix": string}
Rules: checks must cover whether the agent asked for each expected variable/extraction field and whether scenario expectations were met. "diagnosis" is plain English for a non-technical user (empty string if passed). "suggested_fix" is a single concrete change request that could be sent back to the workflow builder (empty string if passed). Never include secrets, API keys, or other workspaces.`;
    const user = `SCENARIO: ${scenario}
EXPECTED (from workflow build config): ${JSON.stringify(expected).slice(0, 6000)}
WORKFLOW STEPS: ${JSON.stringify((config.workflow?.steps ?? []).map((s: any) => ({ type: s.type, label: s.label ?? s.id }))).slice(0, 4000)}

ACTUAL CALL:
- status: ${call.call_status}, duration: ${call.duration_seconds ?? 0}s, sentiment: ${call.sentiment ?? "none"}, outcome: ${call.call_outcome ?? "none"}, voicemail: ${call.is_voicemail}, lead linked: ${!!call.lead_id}
- summary: ${(call.call_summary ?? "").slice(0, 2000)}
- transcript: ${(call.transcript ?? "").slice(0, 12000)}`;
    try {
      const routed = await routeGenerate({
        system: sys,
        user,
        contentType: "systemmind_test_call_analysis",
        maxTokens: 2500,
        mode: "manual",
        provider: claudeEnabled ? "claude" : "openai",
        model: claudeEnabled ? "claude-sonnet-4-5" : "gpt-4.1",
        settings: {},
        workspaceId,
        sb: sb(),
      });
      modelProvider = routed.provider; modelId = routed.model;
      promptTokens = routed.inputTokens; completionTokens = routed.outputTokens;
      const cleaned = routed.text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
      const parsed = JSON.parse(cleaned);
      ai = {
        passed: !!parsed.passed,
        checks: Array.isArray(parsed.checks)
          ? parsed.checks.slice(0, 20).map((c: any) => ({
              key: String(c.key ?? "ai_check").slice(0, 80),
              label: String(c.label ?? "").slice(0, 200),
              status: (["passed", "failed", "warning"].includes(c.status) ? c.status : "warning") as TestCheck["status"],
              detail: String(c.detail ?? "").slice(0, 500),
            }))
          : [],
        diagnosis: String(parsed.diagnosis ?? "").slice(0, 4000),
        suggested_fix: String(parsed.suggested_fix ?? "").slice(0, 4000),
      };
    } catch (err: any) {
      ai.diagnosis = `AI analysis unavailable (${String(err?.message ?? err).slice(0, 200)}) — result based on deterministic checks only.`;
      ai.passed = false;
    }
  } else {
    ai.diagnosis = connectedScenario
      ? "No transcript or summary available yet — wait for the call to finish processing, then re-run the analysis."
      : "";
    ai.passed = !connectedScenario; // unanswered scenarios can pass on deterministic checks alone
  }

  const allChecks = [...checks, ...ai.checks];
  const deterministicFailed = checks.some((c) => c.status === "failed");
  const passed = !deterministicFailed && ai.passed;
  const failedChecks = allChecks.filter((c) => c.status === "failed").map((c) => c.key);

  const completedAt = new Date();
  await recordSystemMindUsageEvent({
    workspaceId, userId, sessionId, versionId: version.id,
    taskType: "test_call_analysis",
    sourcePage: session.source_page,
    modelProvider, modelId, promptTokens, completionTokens,
    startedAt, completedAt, success: true,
  });

  const { data: row, error: iErr } = await sb().from("systemmind_test_calls").insert({
    workspace_id: workspaceId,
    session_id: sessionId,
    version_id: version.id,
    agent_id: session.target_agent_id ?? call.agent_id ?? null,
    workflow_id: session.linked_workflow_id ?? null,
    call_id: call.id,
    retell_call_id: call.retell_call_id ?? null,
    test_scenario: scenario,
    expected_result: expected,
    actual_result: {
      call_status: call.call_status,
      duration_seconds: call.duration_seconds,
      sentiment: call.sentiment,
      call_outcome: call.call_outcome,
      is_voicemail: call.is_voicemail,
      lead_id: call.lead_id,
      has_transcript: hasTranscript,
    },
    checks: allChecks,
    passed,
    failed_checks: failedChecks,
    diagnosis: ai.diagnosis || null,
    suggested_fix: ai.suggested_fix || null,
    is_manual_override: false,
    tested_by_user_id: userId,
  }).select("*").single();
  if (iErr) throw new Error(`Failed to save test result: ${iErr.message}`);

  await writeSystemMindAudit({
    workspaceId, userId,
    actionType: "test_call_analyzed",
    targetType: "systemmind_test_call",
    targetId: row.id,
    finalAfterState: { session_id: sessionId, version_id: version.id, call_id: call.id, scenario, passed, failed_checks: failedChecks },
  });

  return row;
}

// ── Manual pass override ───────────────────────────────────────────────────────
export async function overrideTestPassedServer(args: {
  workspaceId: string;
  userId: string | null;
  sessionId: string;
  reason: string;
}): Promise<any> {
  const session = await getSessionOrThrow(args.workspaceId, args.sessionId);
  const version = await getCurrentVersion(args.workspaceId, session);
  if (!version) throw new Error("This session has no version yet.");
  const reason = args.reason.trim();
  if (!reason) throw new Error("A reason is required to mark the test as passed manually.");

  const { data: row, error } = await sb().from("systemmind_test_calls").insert({
    workspace_id: args.workspaceId,
    session_id: args.sessionId,
    version_id: version.id,
    agent_id: session.target_agent_id ?? null,
    workflow_id: session.linked_workflow_id ?? null,
    test_scenario: "manual_override",
    expected_result: {},
    actual_result: {},
    checks: [],
    passed: true,
    failed_checks: [],
    diagnosis: `Manually marked as passed: ${reason.slice(0, 1000)}`,
    is_manual_override: true,
    tested_by_user_id: args.userId,
  }).select("*").single();
  if (error) throw new Error(error.message);

  await writeSystemMindAudit({
    workspaceId: args.workspaceId, userId: args.userId,
    actionType: "test_call_override_passed",
    targetType: "systemmind_test_call",
    targetId: row.id,
    finalAfterState: { session_id: args.sessionId, version_id: version.id, reason: reason.slice(0, 500) },
  });
  return row;
}

// ── Gate state (also used by the deployment checklist) ─────────────────────────
export async function getTestGateForSessionServer(args: {
  workspaceId: string;
  sessionId: string;
  versionId?: string | null;
}): Promise<{ status: "passed" | "failed" | "not_tested"; latest: any | null }> {
  let q = sb().from("systemmind_test_calls")
    .select("id, version_id, test_scenario, passed, failed_checks, diagnosis, is_manual_override, created_at")
    .eq("workspace_id", args.workspaceId)
    .eq("session_id", args.sessionId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (args.versionId) q = q.eq("version_id", args.versionId);
  const { data, error } = await q.maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { status: "not_tested", latest: null };
  return { status: data.passed ? "passed" : "failed", latest: data };
}

export async function getTestCallStateServer(args: {
  workspaceId: string;
  sessionId: string;
}): Promise<{
  scenarios: typeof TEST_SCENARIOS;
  expected: Record<string, unknown> | null;
  gate: { status: "passed" | "failed" | "not_tested"; latest: any | null };
  history: any[];
  versionId: string | null;
  versionNumber: number | null;
}> {
  const session = await getSessionOrThrow(args.workspaceId, args.sessionId);
  const version = await getCurrentVersion(args.workspaceId, session);
  const gate = version
    ? await getTestGateForSessionServer({ workspaceId: args.workspaceId, sessionId: args.sessionId, versionId: version.id })
    : { status: "not_tested" as const, latest: null };
  const { data: history } = await sb().from("systemmind_test_calls")
    .select("id, version_id, call_id, retell_call_id, test_scenario, passed, failed_checks, checks, diagnosis, suggested_fix, is_manual_override, created_at")
    .eq("workspace_id", args.workspaceId)
    .eq("session_id", args.sessionId)
    .order("created_at", { ascending: false })
    .limit(10);
  return {
    scenarios: TEST_SCENARIOS,
    expected: version ? deriveExpectedOutcome(version.generated_config ?? {}, "positive_booked") : null,
    gate,
    history: history ?? [],
    versionId: version?.id ?? null,
    versionNumber: version?.version_number ?? null,
  };
}
