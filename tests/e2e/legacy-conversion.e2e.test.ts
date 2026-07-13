/**
 * E2E tests for the SystemMind Legacy Logic Converter.
 *
 * Covers: every deterministic reader (agent flow, WEBEE workflow, HexMail
 * sequence, WATI setup, webform auto-call), the conversion report shape,
 * never-overwrite safety (originals byte-identical after conversion, drafts
 * only), WBAH isolation (hard block by slug), workspace scoping (foreign
 * source ids read as "not found"), credential scrubbing (credential-shaped
 * values reject the whole conversion), lineage rows, manual-review HiveMind
 * tasks for unsupported items, audit + usage rows, and the read paths used
 * by the UI (source lists, per-session report, history).
 *
 * The AI-assisted manual_description path is NOT exercised here (external
 * model call, non-deterministic).
 *
 * Runs against the REAL shared Supabase database (service role) using
 * throw-away random workspaces, and cleans up everything it creates.
 *
 * Run: npx vitest run --config vitest.e2e.config.ts tests/e2e/legacy-conversion.e2e.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  convertLegacySourceServer,
  listLegacyConversionSourcesServer,
  getConversionForSessionServer,
  listLegacyConversionsServer,
} from "@/lib/systemmind/legacy-conversion.server";

const sb = supabaseAdmin as any;
const WS = randomUUID();        // main throw-away workspace
const OTHER_WS = randomUUID();  // for cross-workspace isolation checks
// The REAL WBAH workspace id — the converter hard-blocks it BEFORE any read or
// write, so asserting against the live workspace is side-effect free.
const WBAH_WORKSPACE_ID = "5cb750b6-fabf-4e84-9b92-740df1cd8d53";
let OWNER_ID = "";
let AGENT_ID = "";

const createdSessionIds: string[] = [];

beforeAll(async () => {
  const { data: anyWs } = await sb.from("workspaces").select("owner_id").limit(1).single();
  OWNER_ID = anyWs.owner_id as string;
  for (const [id, name, slug] of [
    [WS, "e2e legacy-conv ws", `e2e-lc-${WS.slice(0, 8)}`],
    [OTHER_WS, "e2e legacy-conv other ws", `e2e-lc-${OTHER_WS.slice(0, 8)}`],
  ] as const) {
    const { error } = await sb.from("workspaces").insert({ id, name, owner_id: OWNER_ID, slug });
    if (error) throw new Error(`workspace fixture (${slug}): ${error.message}`);
  }
  const { data: agent, error: aErr } = await sb.from("agents").insert({
    workspace_id: WS, user_id: OWNER_ID, name: "e2e legacy conv agent", settings: {},
    flow_data: {
      nodes: [
        { id: "n1", type: "conversation", data: { kind: "conversation", label: "Greeting", dialogue: "Hi, I can help you book an appointment on our calendar.", transitions: [{ condition: "caller wants to book" }] } },
        { id: "n2", type: "extract_variable", data: { kind: "extract_variable", label: "preferred_date", dialogue: "Which day suits you best?" } },
        { id: "n3", type: "function", data: { kind: "function", label: "Send to Zapier webhook" } },
        { id: "n4", type: "conversation", data: { kind: "conversation", label: "Email confirm", dialogue: "We will send an email confirmation." } },
      ],
    },
    variables: [{ name: "customer_name", description: "Caller full name" }],
  }).select("id").single();
  if (aErr) throw new Error(`agent fixture: ${aErr.message}`);
  AGENT_ID = agent.id as string;
});

afterAll(async () => {
  for (const table of [
    "systemmind_conversions",
    "systemmind_build_messages",
    "systemmind_build_versions",
    "systemmind_build_sessions",
    "systemmind_usage_events",
    "systemmind_audit_logs",
    "hivemind_tasks",
    "workspace_workflows",
    "wati_campaigns",
    "webform_sources",
    "systemmind_n8n_workflows",
    "hexmail_campaigns",
    "workspace_settings",
  ]) {
    for (const ws of [WS, OTHER_WS]) {
      try { await sb.from(table).delete().eq("workspace_id", ws); } catch { /* table may lack workspace_id */ }
    }
  }
  await sb.from("agents").delete().eq("workspace_id", WS);
  await sb.from("workspace_members").delete().in("workspace_id", [WS, OTHER_WS]);
  await sb.from("workspaces").delete().in("id", [WS, OTHER_WS]);
});

// ── Fixture helpers ────────────────────────────────────────────────────────────

async function insertHexmailSequence(ws: string, over: { name?: string; steps?: Array<{ day_number: number; actions: any[] }> } = {}): Promise<string> {
  const { data, error } = await sb.from("hexmail_campaigns").insert({
    workspace_id: ws,
    name: over.name ?? "e2e nurture sequence",
    description: "e2e legacy conversion fixture",
    status: "active",
    config: { target_statuses: ["contact_made", "interested"] },
  }).select("id").single();
  if (error) throw new Error(error.message);
  const steps = over.steps ?? [
    { day_number: 1, actions: [{ type: "email" }, { type: "sms", notes: "text them" }] },
    { day_number: 3, actions: [{ type: "whatsapp", notes: "gentle nudge" }, { type: "pipeline_update", config: { status: "made_up_status" } }] },
    { day_number: 5, actions: [{ type: "task", notes: "Call them personally" }] },
  ];
  for (const s of steps) {
    const { error: sErr } = await sb.from("hexmail_campaign_steps").insert({
      campaign_id: data.id, day_number: s.day_number, actions: s.actions,
    });
    if (sErr) throw new Error(sErr.message);
  }
  return data.id as string;
}

async function fetchRow(table: string, id: string): Promise<any> {
  const { data } = await sb.from(table).select("*").eq("id", id).single();
  return data;
}

async function expectDraftSession(sessionId: string, versionId: string) {
  createdSessionIds.push(sessionId);
  const session = await fetchRow("systemmind_build_sessions", sessionId);
  expect(session).toBeTruthy();
  expect(session.workspace_id).toBe(WS);
  const version = await fetchRow("systemmind_build_versions", versionId);
  expect(version).toBeTruthy();
  expect(version.status).toBe("draft");
  expect(version.session_id).toBe(sessionId);
  return { session, version };
}

// ── 1. HexMail sequence conversion ─────────────────────────────────────────────

describe("hexmail_sequence conversion", () => {
  it("converts day steps into a draft workflow, flags unsupported actions, and never touches the original", async () => {
    const campaignId = await insertHexmailSequence(WS);
    const before = await fetchRow("hexmail_campaigns", campaignId);

    const res = await convertLegacySourceServer({
      workspaceId: WS, userId: OWNER_ID,
      sourceType: "hexmail_sequence", sourceId: campaignId,
    });
    const { version } = await expectDraftSession(res.sessionId, res.versionId);

    // Report shape + mapping
    expect(res.report.source_type).toBe("hexmail_sequence");
    expect(res.report.fidelity).toBe("partial");
    expect(res.report.detected_trigger).toContain("contact_made");
    expect(res.report.converted.some((c) => c.to === "send_email")).toBe(true);
    expect(res.report.converted.some((c) => c.to === "send_whatsapp")).toBe(true);
    // sms is unsupported → flagged, never silently dropped
    expect(res.report.unsupported.some((u) => u.item.includes("SMS") && u.status === "unsupported_requires_review")).toBe(true);
    // invalid pipeline status remapped with a warning
    expect(res.report.converted.some((c) => c.to.includes("contact_made"))).toBe(true);
    expect(res.report.warnings.some((w) => w.includes("made_up_status"))).toBe(true);

    // Converted config: valid step graph with day gaps as callbacks
    const steps: any[] = version.generated_config.workflow.steps;
    expect(steps[0].type).toBe("trigger");
    expect(steps[steps.length - 1].type).toBe("stop_workflow");
    const callback = steps.find((s) => s.type === "create_callback");
    expect(callback).toBeTruthy();
    expect(callback.delay_hours).toBe(48); // day 1 → day 3
    expect(version.generated_config.workflow.trigger_type).toBe("lead_status_changed");

    // Lineage row + report read path
    expect(res.conversionId).toBeTruthy();
    const conv = await getConversionForSessionServer(WS, res.sessionId);
    expect(conv?.id).toBe(res.conversionId);
    expect(conv.source_id).toBe(campaignId);
    expect(conv.report.converted.length).toBe(res.report.converted.length);

    // Manual-review HiveMind task for the unsupported SMS action
    const { data: tasks } = await sb.from("hivemind_tasks").select("*")
      .eq("workspace_id", WS).eq("trigger_type", "legacy_conversion_review").eq("entity_id", res.conversionId);
    expect((tasks ?? []).length).toBe(1);
    expect(tasks[0].status).toBe("suggested"); // hivemind_tasks status check constraint
    expect(tasks[0].description).toContain("SMS");

    // Audit + usage rows
    const { data: audits } = await sb.from("systemmind_audit_logs").select("id")
      .eq("workspace_id", WS).eq("action_type", "legacy_conversion_completed");
    expect((audits ?? []).length).toBeGreaterThan(0);
    const { data: usage } = await sb.from("systemmind_usage_events").select("id")
      .eq("workspace_id", WS).eq("task_type", "legacy_conversion");
    expect((usage ?? []).length).toBeGreaterThan(0);

    // NEVER-OVERWRITE: the original sequence row is byte-identical
    const after = await fetchRow("hexmail_campaigns", campaignId);
    expect(after).toEqual(before);
  });

  it("rejects the whole conversion when a credential-shaped value appears in the source", async () => {
    const secretish = `sk-${"a".repeat(24)}`;
    const campaignId = await insertHexmailSequence(WS, {
      name: "e2e credential leak sequence",
      steps: [{ day_number: 1, actions: [{ type: "task", notes: `Use key ${secretish} to call the API` }] }],
    });
    const { count: sessionsBefore } = await sb.from("systemmind_build_sessions")
      .select("id", { count: "exact", head: true }).eq("workspace_id", WS);

    await expect(convertLegacySourceServer({
      workspaceId: WS, userId: OWNER_ID,
      sourceType: "hexmail_sequence", sourceId: campaignId,
    })).rejects.toThrow(/credential/i);

    // No draft session was created for the rejected conversion
    const { count: sessionsAfter } = await sb.from("systemmind_build_sessions")
      .select("id", { count: "exact", head: true }).eq("workspace_id", WS);
    expect(sessionsAfter).toBe(sessionsBefore);
  });
});

// ── 2. WATI setup conversion ───────────────────────────────────────────────────

describe("wati_setup conversion", () => {
  it("converts a broadcast into a per-lead send_whatsapp draft with a fan-out warning", async () => {
    const { data: row, error } = await sb.from("wati_campaigns").insert({
      workspace_id: WS, wati_campaign_id: `e2e-${randomUUID().slice(0, 8)}`,
      name: "e2e promo blast", template_name: "promo_july", status: "completed",
    }).select("id").single();
    if (error) throw new Error(error.message);
    const before = await fetchRow("wati_campaigns", row.id);

    const res = await convertLegacySourceServer({
      workspaceId: WS, userId: OWNER_ID, sourceType: "wati_setup", sourceId: row.id,
    });
    const { version } = await expectDraftSession(res.sessionId, res.versionId);

    const steps: any[] = version.generated_config.workflow.steps;
    const wa = steps.find((s) => s.type === "send_whatsapp");
    expect(wa?.template).toBe("promo_july");
    expect(version.generated_config.workflow.trigger_type).toBe("manual");
    expect(res.report.warnings.some((w) => /fans out|per-lead/i.test(w))).toBe(true);

    const after = await fetchRow("wati_campaigns", row.id);
    expect(after).toEqual(before);
  });
});

// ── 3. Webform auto-call conversion ────────────────────────────────────────────

describe("webform_auto_call conversion", () => {
  it("converts intake into a lead_added draft and warns when auto-call is off", async () => {
    const { data: form, error } = await sb.from("webform_sources").insert({
      workspace_id: WS, name: "e2e landing form", status: "active",
      default_source_type: "website", notify_email: "ops@example.com",
    }).select("id").single();
    if (error) throw new Error(error.message);
    // No workspace_settings row → auto-call off + no agent selected → 2 warnings.

    const res = await convertLegacySourceServer({
      workspaceId: WS, userId: OWNER_ID, sourceType: "webform_auto_call", sourceId: form.id,
    });
    const { version } = await expectDraftSession(res.sessionId, res.versionId);

    expect(res.report.fidelity).toBe("full");
    expect(version.generated_config.workflow.trigger_type).toBe("lead_added");
    const types = version.generated_config.workflow.steps.map((s: any) => s.type);
    expect(types).toContain("call_lead");
    expect(types).toContain("notify_user"); // notify_email present
    expect(res.report.warnings.some((w) => /switched OFF/i.test(w))).toBe(true);
    expect(res.report.warnings.some((w) => /No auto-call agent/i.test(w))).toBe(true);
    // Never leak the full notify email into the report
    expect(JSON.stringify(res.report)).not.toContain("ops@example.com");
  });
});

// ── 4. Agent flow conversion ───────────────────────────────────────────────────

describe("agent conversion", () => {
  it("extracts after-call logic: sentiment branch, extraction fields, unsupported function node", async () => {
    const res = await convertLegacySourceServer({
      workspaceId: WS, userId: OWNER_ID, sourceType: "agent", sourceId: AGENT_ID,
    });
    const { session, version } = await expectDraftSession(res.sessionId, res.versionId);

    expect(res.report.source_type).toBe("agent");
    expect(version.generated_config.workflow.trigger_type).toBe("call_completed");
    // Sentiment branch exists and both outcomes are wired
    const branch = version.generated_config.workflow.steps.find((s: any) => s.type === "branch");
    expect(branch).toBeTruthy();
    expect(branch.conditions.length).toBe(2);
    expect(branch.next).toBeTruthy(); // else → review path
    // Booking + email wording detected in dialogue
    const types = version.generated_config.workflow.steps.map((s: any) => s.type);
    expect(types).toContain("create_task");
    expect(types).toContain("send_email");
    // extract_variable node became an extraction field
    expect(version.generated_config.extraction_fields.some((f: any) => f.name === "preferred_date")).toBe(true);
    expect(res.report.detected_variables).toContain("customer_name");
    // function node flagged, never executed/converted
    expect(res.report.unsupported.some((u) => u.item.includes("Send to Zapier webhook"))).toBe(true);
    // Session targets the source agent
    expect(session.target_agent_id).toBe(AGENT_ID);

    // Original agent flow untouched
    const agentAfter = await fetchRow("agents", AGENT_ID);
    expect(agentAfter.flow_data.nodes.length).toBe(4);
  });
});

// ── 5. Existing WEBEE workflow → edit-mode seeding ─────────────────────────────

describe("workflow conversion (already native)", () => {
  it("loads the workflow into a draft session with fidelity full and a lineage row", async () => {
    const { data: wf, error } = await sb.from("workspace_workflows").insert({
      workspace_id: WS, name: "e2e existing wf", trigger_type: "manual", trigger_config: {},
      flow_definition: { steps: [{ id: "s1", type: "trigger", next: "s2" }, { id: "s2", type: "notify_user", title: "Hello" }] },
      status: "inactive",
    }).select("id").single();
    if (error) throw new Error(error.message);
    const before = await fetchRow("workspace_workflows", wf.id);

    const res = await convertLegacySourceServer({
      workspaceId: WS, userId: OWNER_ID, sourceType: "workflow", sourceId: wf.id,
    });
    await expectDraftSession(res.sessionId, res.versionId);
    expect(res.report.fidelity).toBe("full");
    expect(res.report.risk_level).toBe("low");
    expect(res.conversionId).toBeTruthy();

    const after = await fetchRow("workspace_workflows", wf.id);
    expect(after).toEqual(before);
  });
});

// ── 6. Safety rails ────────────────────────────────────────────────────────────

describe("safety rails", () => {
  it("hard-blocks the WBAH workspace by id and by slug", async () => {
    // By id (the primary, DB-free check).
    await expect(convertLegacySourceServer({
      workspaceId: WBAH_WORKSPACE_ID, userId: OWNER_ID,
      sourceType: "manual_description", description: "Convert my old spreadsheet follow-up process please.",
    })).rejects.toThrow(/WBAH/i);
    // By slug: whatever workspace carries the live "webuyanyhouse" slug is
    // blocked too, even if its id ever diverged from the constant.
    const { data: bySlug } = await sb.from("workspaces").select("id").eq("slug", "webuyanyhouse").maybeSingle();
    if (bySlug?.id) {
      await expect(convertLegacySourceServer({
        workspaceId: bySlug.id, userId: OWNER_ID,
        sourceType: "manual_description", description: "Convert my old spreadsheet follow-up process please.",
      })).rejects.toThrow(/WBAH/i);
    }
  });

  it("cannot convert a source belonging to another workspace", async () => {
    const foreignSeq = await insertHexmailSequence(OTHER_WS, { name: "e2e foreign sequence" });
    await expect(convertLegacySourceServer({
      workspaceId: WS, userId: OWNER_ID,
      sourceType: "hexmail_sequence", sourceId: foreignSeq,
    })).rejects.toThrow(/not found/i);
  });

  it("requires a source id for source-backed types and a real description for manual", async () => {
    await expect(convertLegacySourceServer({
      workspaceId: WS, userId: OWNER_ID, sourceType: "wati_setup",
    })).rejects.toThrow(/pick/i);
    await expect(convertLegacySourceServer({
      workspaceId: WS, userId: OWNER_ID, sourceType: "manual_description", description: "too short",
    })).rejects.toThrow(/at least/i);
  });
});

// ── 7. Read paths used by the UI ───────────────────────────────────────────────

describe("read paths", () => {
  it("lists convertible sources scoped to the workspace", async () => {
    const sources = await listLegacyConversionSourcesServer(WS);
    expect(sources.agents.some((a) => a.id === AGENT_ID)).toBe(true);
    expect(sources.sequences.some((s) => s.name === "e2e nurture sequence")).toBe(true);
    expect(sources.wati.some((w) => w.name === "e2e promo blast")).toBe(true);
    expect(sources.webforms.some((w) => w.name === "e2e landing form")).toBe(true);
    expect(sources.workflows.some((w) => w.name === "e2e existing wf")).toBe(true);
    // Foreign workspace's sequence must NOT appear
    expect(sources.sequences.some((s) => s.name === "e2e foreign sequence")).toBe(false);
  });

  it("lists conversion history for the workspace only", async () => {
    const history = await listLegacyConversionsServer(WS);
    expect(history.length).toBeGreaterThanOrEqual(4); // hexmail, wati, webform, agent, workflow
    for (const row of history) {
      expect(createdSessionIds).toContain(row.session_id);
    }
    const otherHistory = await listLegacyConversionsServer(OTHER_WS);
    expect(otherHistory.length).toBe(0);
  });
});
