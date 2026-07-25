/**
 * HiveMind Executive Control over GrowthMind (e2e, real DB).
 *
 * Verifies:
 *   • all executive GrowthMind tools are registered under hivemind.*
 *   • sensitive classification (approve_content, cost limits, DNA proposals)
 *   • read tool executes end-to-end (real executive view, honest data)
 *   • sensitive write without explicit approval → approval_required
 *   • Mind-initiated write under observe mode → blocked
 *   • pause/resume publishing round-trips workspace_settings flags
 *   • objectives lifecycle via tools (create → list → status change)
 *   • monitoring sweep creates suggested tasks and dedups on re-run
 *   • chat tool schema conversion produces OpenAI-compatible tool defs
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  executeMindTool,
  listMindTools,
  mindToolsReady,
} from "@/lib/minds/tool-registry.server";

const sb = supabaseAdmin as any;

const WS = randomUUID();
let ownerUserId: string;

beforeAll(async () => {
  const { data: profiles, error } = await sb.from("profiles").select("user_id").limit(1);
  if (error || !profiles?.length) throw new Error("Need an existing user for workspace fixture");
  ownerUserId = profiles[0].user_id;

  const { error: wErr } = await sb.from("workspaces").insert({
    id: WS,
    name: `gm-exec e2e ${WS.slice(0, 8)}`,
    slug: `gm-exec-e2e-${WS.slice(0, 8)}`,
    owner_id: ownerUserId,
  });
  if (wErr) throw new Error(`fixture workspace insert failed: ${wErr.message}`);
  const { error: mErr } = await sb.from("workspace_members").insert({
    workspace_id: WS, user_id: ownerUserId, role: "owner",
  });
  if (mErr) throw new Error(`fixture membership insert failed: ${mErr.message}`);

  // Package with both hivemind + growthmind departments so entitlement guard passes.
  const { PACKAGE_CATALOG } = await import("@/lib/packages/packages.shared");
  const full = PACKAGE_CATALOG.find(
    (p: any) => p.aiDepartments?.includes("hivemind") && p.aiDepartments?.includes("growthmind"),
  );
  if (!full) throw new Error("No package with hivemind+growthmind departments in catalog");
  const { error: subErr } = await sb.from("workspace_subscriptions").insert({
    workspace_id: WS,
    package_key: (full as any).packageKey,
    subscription_status: "active",
  });
  if (subErr) throw new Error(subErr.message);
  const { invalidateEntitlementsCache } = await import("@/lib/packages/entitlements.server");
  invalidateEntitlementsCache(WS);

  await sb.from("workspace_settings").upsert(
    { workspace_id: WS, hivemind_mode: "assist" },
    { onConflict: "workspace_id" },
  );
  await mindToolsReady();
}, 60_000);

afterAll(async () => {
  await sb.from("mind_tool_executions").delete().eq("workspace_id", WS);
  await sb.from("hivemind_tasks").delete().eq("workspace_id", WS);
  await sb.from("growthmind_objectives").delete().eq("workspace_id", WS);
  await sb.from("workspace_subscriptions").delete().eq("workspace_id", WS);
  await sb.from("workspace_settings").delete().eq("workspace_id", WS);
  await sb.from("workspace_members").delete().eq("workspace_id", WS);
  await sb.from("workspaces").delete().eq("id", WS);
}, 60_000);

describe("registration & classification", () => {
  it("registers the executive GrowthMind tool suite", () => {
    const names = new Set(listMindTools().map((t) => t.name));
    for (const n of [
      "get_growthmind_status", "get_growthmind_health", "get_content_command_centre",
      "get_trend_opportunities", "get_business_dna", "get_content_performance",
      "get_growthmind_costs", "get_publishing_failures", "get_growthmind_objectives",
      "analyse_trend", "prioritise_trend", "reject_trend", "approve_trend_for_adaptation",
      "add_monitored_source", "set_monitored_source_status",
      "create_content_studio_project", "request_content_changes", "approve_content",
      "schedule_content", "cancel_scheduled_content", "retry_failed_publication",
      "pause_publishing", "resume_publishing", "pause_growthmind_jobs", "resume_growthmind_jobs",
      "update_growthmind_cost_limits", "resolve_dna_proposal",
      "update_growthmind_objectives", "set_growthmind_objective_status", "create_growthmind_task",
    ]) {
      expect(names, `missing hivemind.${n}`).toContain(`hivemind.${n}`);
    }
  });

  it("marks irreversible/billing tools sensitive; reads are not", () => {
    const byName = new Map(listMindTools().map((t) => [t.name, t]));
    expect(byName.get("hivemind.approve_content")?.sensitive).toBe(true);
    expect(byName.get("hivemind.update_growthmind_cost_limits")?.sensitive).toBe(true);
    expect(byName.get("hivemind.resolve_dna_proposal")?.sensitive).toBe(true);
    expect(byName.get("hivemind.get_growthmind_status")?.sensitive).toBe(false);
    expect(byName.get("hivemind.get_growthmind_status")?.access).toBe("read");
    expect(byName.get("hivemind.pause_publishing")?.access).toBe("write");
  });
});

describe("execution guards", () => {
  it("read tool returns a real executive view", async () => {
    const res = await executeMindTool({
      sb, workspaceId: WS, userId: ownerUserId, platform: "web",
      toolName: "hivemind.get_growthmind_status", input: {}, initiatedBy: "user",
    });
    expect(res.status).toBe("completed");
    const view: any = res.result;
    expect(view).toBeTruthy();
    expect(view.publishing).toBeTruthy();
    expect(view.dna).toBeTruthy();
    expect(view.objectives).toBeTruthy();
  }, 60_000);

  it("sensitive approve_content without approval → approval_required (nothing published)", async () => {
    const res = await executeMindTool({
      sb, workspaceId: WS, userId: ownerUserId, platform: "web",
      toolName: "hivemind.approve_content",
      input: { projectId: randomUUID() },
      initiatedBy: "user",
    });
    expect(res.status).toBe("approval_required");
  });

  it("Mind-initiated write under observe mode → blocked", async () => {
    await sb.from("workspace_settings").update({ hivemind_mode: "observe" }).eq("workspace_id", WS);
    const res = await executeMindTool({
      sb, workspaceId: WS, userId: null, platform: "system",
      toolName: "hivemind.pause_publishing", input: {}, initiatedBy: "mind",
    });
    expect(res.status).toBe("blocked");
    const { data: st } = await sb.from("workspace_settings")
      .select("growthmind_publishing_paused").eq("workspace_id", WS).maybeSingle();
    expect(st?.growthmind_publishing_paused ?? false).toBe(false);
    await sb.from("workspace_settings").update({ hivemind_mode: "assist" }).eq("workspace_id", WS);
  });
});

describe("pause / resume publishing", () => {
  it("round-trips the workspace flag", async () => {
    const pause = await executeMindTool({
      sb, workspaceId: WS, userId: ownerUserId, platform: "web",
      toolName: "hivemind.pause_publishing", input: {}, initiatedBy: "user",
    });
    expect(pause.status).toBe("completed");
    let { data: st } = await sb.from("workspace_settings")
      .select("growthmind_publishing_paused").eq("workspace_id", WS).single();
    expect(st.growthmind_publishing_paused).toBe(true);

    const resume = await executeMindTool({
      sb, workspaceId: WS, userId: ownerUserId, platform: "web",
      toolName: "hivemind.resume_publishing", input: {}, initiatedBy: "user",
    });
    expect(resume.status).toBe("completed");
    ({ data: st } = await sb.from("workspace_settings")
      .select("growthmind_publishing_paused").eq("workspace_id", WS).single());
    expect(st.growthmind_publishing_paused).toBe(false);
  });
});

describe("objectives lifecycle", () => {
  it("creates, lists and closes an objective via tools", async () => {
    const create = await executeMindTool({
      sb, workspaceId: WS, userId: ownerUserId, platform: "web",
      toolName: "hivemind.update_growthmind_objectives",
      input: {
        name: "Push winter service bookings",
        businessOutcome: "20 booked calls/month",
        priority: "high",
        platforms: ["instagram"],
      },
      initiatedBy: "user",
    });
    expect(create.status).toBe("completed");
    const objectiveId = (create.result as any)?.id ?? (create.result as any)?.objective?.id;
    expect(objectiveId).toBeTruthy();

    const list = await executeMindTool({
      sb, workspaceId: WS, userId: ownerUserId, platform: "web",
      toolName: "hivemind.get_growthmind_objectives", input: {}, initiatedBy: "user",
    });
    expect(list.status).toBe("completed");
    expect(JSON.stringify(list.result)).toContain("Push winter service bookings");

    const done = await executeMindTool({
      sb, workspaceId: WS, userId: ownerUserId, platform: "web",
      toolName: "hivemind.set_growthmind_objective_status",
      input: { objectiveId, status: "completed" },
      initiatedBy: "user",
    });
    expect(done.status).toBe("completed");
    const { data: row } = await sb.from("growthmind_objectives")
      .select("status").eq("id", objectiveId).single();
    expect(row.status).toBe("completed");
  });
});

describe("monitoring sweep", () => {
  it("creates suggested tasks for failing checks and dedups on re-run", async () => {
    const { runGrowthMindMonitoringSweep } =
      await import("@/lib/hivemind/growthmind-control/monitoring.server");

    // Force a deterministic failing check: pause publishing directly.
    await sb.from("workspace_settings")
      .update({ growthmind_publishing_paused: true }).eq("workspace_id", WS);

    const first = await runGrowthMindMonitoringSweep(WS);
    expect(first.tasksCreated).toBeGreaterThan(0);

    const second = await runGrowthMindMonitoringSweep(WS);
    expect(second.tasksCreated).toBe(0);
    expect(second.deduped).toBeGreaterThan(0);

    const { data: tasks } = await sb.from("hivemind_tasks")
      .select("status, trigger_type, entity_id")
      .eq("workspace_id", WS).eq("trigger_type", "growthmind_health");
    expect((tasks ?? []).length).toBeGreaterThan(0);
    for (const t of tasks ?? []) expect(t.status).toBe("suggested");

    await sb.from("workspace_settings")
      .update({ growthmind_publishing_paused: false }).eq("workspace_id", WS);
  }, 120_000);
});

describe("chat tool exposure", () => {
  it("converts registry tools into OpenAI-compatible function defs", async () => {
    const { getHiveMindChatToolSchemas } =
      await import("@/lib/hivemind/growthmind-control/chat-tools.server");
    const tools = await getHiveMindChatToolSchemas();
    expect(tools.length).toBeGreaterThan(20);
    for (const t of tools) {
      expect(t.type).toBe("function");
      expect(t.function.name).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(t.function.parameters?.type).toBe("object");
    }
    const names = tools.map((t: any) => t.function.name);
    expect(names).toContain("get_growthmind_status");
    expect(names).toContain("approve_content");
  });
});
