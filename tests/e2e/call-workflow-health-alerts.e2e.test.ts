/**
 * E2E tests for Task #478: proactive admin alerts when an active calling
 * workflow's health degrades or fails.
 *
 * Runs against the REAL shared Supabase database (service role) using a
 * throw-away workspace and cleans everything up.
 *
 * Run: npx vitest run --config vitest.e2e.config.ts tests/e2e/call-workflow-health-alerts.e2e.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { notifyHealthTransition, type HealthReport } from "@/lib/systemmind/call-runtime/tick.server";

const sb = supabaseAdmin as any;
const WS = randomUUID();
let OWNER_ID = "";
let AGENT_ID = "";
let memberRowInserted = false;

function report(status: HealthReport["status"]): HealthReport {
  return {
    status,
    checks: [
      { key: "executions", label: "Recent executions (24h)", ok: false, detail: "10 runs, 10 failed (100%)" },
      { key: "integration_errors", label: "Integration errors", ok: false, detail: "0 retrying, 3 dead-lettered" },
    ],
    recommendedActions: ["Open the execution log and review the failing step."],
    computedAt: new Date().toISOString(),
  };
}

async function notificationRows() {
  const { data } = await sb
    .from("workspace_notifications")
    .select("id, event_key, severity, channel, title, message")
    .eq("workspace_id", WS);
  return data ?? [];
}

async function execEvents() {
  const { data } = await sb
    .from("hivemind_executive_events")
    .select("id, event_type, severity, dedup_key")
    .eq("workspace_id", WS);
  return data ?? [];
}

beforeAll(async () => {
  const { data: anyWs } = await sb.from("workspaces").select("owner_id").limit(1).single();
  OWNER_ID = anyWs.owner_id as string;
  const { error } = await sb.from("workspaces").insert({
    id: WS, name: "e2e health alerts ws", owner_id: OWNER_ID, slug: `e2e-hlth-${WS.slice(0, 8)}`,
  });
  if (error) throw new Error(`workspace fixture: ${error.message}`);
  const { error: mErr } = await sb.from("workspace_members").insert({
    workspace_id: WS, user_id: OWNER_ID, role: "owner",
  });
  if (!mErr) memberRowInserted = true;

  const { data: agent, error: aErr } = await sb.from("agents").insert({
    workspace_id: WS, user_id: OWNER_ID, name: "e2e health agent",
    settings: { agentType: "client_qualification", channelType: "voice" },
    flow_data: { nodes: [], edges: [] },
  }).select("id").single();
  if (aErr) throw new Error(`agent fixture: ${aErr.message}`);
  AGENT_ID = agent.id as string;
}, 60000);

afterAll(async () => {
  for (const table of [
    "workspace_notifications", "hivemind_executive_events",
    "workspace_access_audit_logs", "agents",
  ]) {
    await sb.from(table).delete().eq("workspace_id", WS);
  }
  if (memberRowInserted) {
    await sb.from("workspace_members").delete().eq("workspace_id", WS).eq("user_id", OWNER_ID);
  }
  await sb.from("workspaces").delete().eq("id", WS);
}, 60000);

describe("calling workflow health degradation alerts", () => {
  const activationId = randomUUID();
  const base = () => ({
    id: activationId, workspace_id: WS, agent_id: AGENT_ID, status: "active" as const,
  });

  it("does nothing for healthy / warning statuses", async () => {
    await notifyHealthTransition({ ...base(), health_status: "healthy" }, report("healthy"));
    await notifyHealthTransition({ ...base(), health_status: "healthy" }, report("warning"));
    expect(await notificationRows()).toHaveLength(0);
  });

  it("alerts admins when health transitions healthy → degraded", async () => {
    await notifyHealthTransition({ ...base(), health_status: "healthy" }, report("degraded"));
    const rows = await notificationRows();
    expect(rows.length).toBeGreaterThan(0);
    const inApp = rows.filter((r: any) => r.channel === "in_app");
    expect(inApp.length).toBeGreaterThan(0);
    expect(inApp[0].event_key).toBe("workflow_error");
    expect(inApp[0].severity).toBe("warning");
    expect(inApp[0].title).toContain("e2e health agent");
    expect(inApp[0].message).toContain("dead-lettered");
  });

  it("mirrors the degradation into the executive event stream", async () => {
    const evs = await execEvents();
    expect(evs.length).toBeGreaterThan(0);
    expect(evs.some((e: any) => e.event_type === "workflow_failed")).toBe(true);
  });

  it("does not re-alert while health stays degraded", async () => {
    const before = (await notificationRows()).length;
    await notifyHealthTransition({ ...base(), health_status: "degraded" }, report("degraded"));
    expect((await notificationRows()).length).toBe(before);
  });

  it("escalates degraded → failed with a fresh critical alert", async () => {
    const before = (await notificationRows()).length;
    await notifyHealthTransition({ ...base(), health_status: "degraded" }, report("failed"));
    const rows = await notificationRows();
    expect(rows.length).toBeGreaterThan(before);
    const critical = rows.filter((r: any) => r.severity === "critical");
    expect(critical.length).toBeGreaterThan(0);
  });

  it("never alerts for paused workflows", async () => {
    const before = (await notificationRows()).length;
    await notifyHealthTransition({ ...base(), status: "paused", health_status: "healthy" }, report("failed"));
    expect((await notificationRows()).length).toBe(before);
  });
});
