// ── SystemMind Legacy Logic Converter — server-only core ───────────────────────
// Converts logic from previous setups (agent flows, n8n blueprints, HexMail
// sequences, WATI/WhatsApp setups, webform auto-call intake, manual business
// descriptions) into WEBEE-native Build Workspace DRAFTS with a structured
// conversion report.
//
// Safety invariants (do not weaken):
//   • NEVER overwrites, deletes, disables or modifies the legacy source — every
//     conversion produces a FRESH build session whose v1 is the converted
//     draft. Going live still runs through the existing Apply pipeline with
//     all its protection rules (snapshots, conflicts, HiveMind approval).
//   • workspace_id comes ONLY from server context; every source read is
//     workspace-scoped, so cross-workspace conversion is structurally
//     impossible. The WBAH managed workspace is additionally hard-blocked in
//     BOTH directions (its logic never leaves; nothing converts into it).
//   • n8n Code nodes (or any custom code) are NEVER executed — they are
//     flagged unsupported_requires_review and produce a manual review task.
//   • No credential values ever enter configs or reports
//     (assertNoCredentialValues on both before anything is stored).
//   • Every conversion writes a systemmind_conversions lineage row, a
//     systemmind_audit_logs row, and a systemmind_usage_events row.

import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { routeGenerate } from "@/lib/growthmind/model-router.server";
import {
  writeSystemMindAudit,
  isClaudeEnabled,
} from "@/lib/systemmind/systemmind-automation.server";
import {
  assertNoCredentialValues,
  convertN8nNodesToSteps,
} from "@/lib/systemmind/systemmind-generators.server";
import {
  validateConfigOrThrow,
  classifyConfigRisk,
  createBuildSessionFromConfigServer,
  createBuildSessionServer,
  recordSystemMindUsageEvent,
  type BuildConfig,
} from "@/lib/systemmind/build-workspace.server";

// ── Types ──────────────────────────────────────────────────────────────────────

export const LEGACY_SOURCE_TYPES = [
  "agent",
  "workflow",
  "n8n",
  "hexmail_sequence",
  "wati_setup",
  "webform_auto_call",
  "manual_description",
] as const;
export type LegacySourceType = (typeof LEGACY_SOURCE_TYPES)[number];

export type ConversionReport = {
  source_type:           LegacySourceType;
  source_id:             string | null;
  source_name:           string;
  source_version:        string | null;
  fidelity:              "full" | "partial" | "assisted";
  original_summary:      string;
  detected_trigger:      string;
  detected_actions:      string[];
  detected_variables:    string[];
  detected_conditions:   string[];
  provider_dependencies: string[];
  converted:             Array<{ from: string; to: string }>;
  unsupported:           Array<{ item: string; reason: string; status: "unsupported_requires_review" }>;
  warnings:              string[];
  assumptions:           string[];
  approval_required:     boolean;
  risk_level:            "low" | "medium" | "high";
  risk_reasons:          string[];
  test_plan:             string[];
};

type ReaderResult = {
  // Raw (pre-validation) BuildConfig-shaped object.
  config:        Record<string, unknown>;
  // Report with risk fields left blank — orchestrator fills them.
  report:        Omit<ConversionReport, "approval_required" | "risk_level" | "risk_reasons">;
  title:         string;
  targetAgentId?: string | null;
  // Model usage (manual-description path only).
  usage?:        { provider: string; model: string; inputTokens: number; outputTokens: number; costUsd: number } | null;
};

const sb = () => supabaseAdmin as any;

// ── WBAH isolation ─────────────────────────────────────────────────────────────
// WBAH is a managed analytics workspace mirroring an external dashboard. Its
// logic must never be converted into standard workspaces and standard logic
// must never be converted into it — the converter is disabled there entirely.
const WBAH_WORKSPACE_ID = "5cb750b6-fabf-4e84-9b92-740df1cd8d53";

async function assertNotWbahWorkspace(workspaceId: string): Promise<void> {
  if (workspaceId === WBAH_WORKSPACE_ID) {
    throw new Error("Legacy conversion is disabled in the WBAH workspace — it is a managed analytics workspace and its logic must stay isolated.");
  }
  try {
    const { data } = await sb().from("workspaces").select("slug").eq("id", workspaceId).maybeSingle();
    if (data?.slug === "webuyanyhouse") {
      throw new Error("Legacy conversion is disabled in the WBAH workspace — it is a managed analytics workspace and its logic must stay isolated.");
    }
  } catch (err: any) {
    if (String(err?.message ?? "").includes("Legacy conversion is disabled")) throw err;
    // Lookup failure: id check above already covers the known WBAH workspace.
  }
}

// ── Step-chain builder ─────────────────────────────────────────────────────────
// Produces sequential ids (step-1, step-2, …) and wires "next" pointers so the
// executor and simulator can always walk the graph.
class StepChain {
  steps: any[] = [];
  private n = 0;
  add(step: Record<string, unknown>): string {
    const id = `step-${++this.n}`;
    const prev = this.steps[this.steps.length - 1];
    if (prev && !prev.next && prev.type !== "branch" && prev.type !== "stop_workflow") prev.next = id;
    this.steps.push({ id, ...step });
    return id;
  }
  // Reserve an id without wiring the previous step to it (for branch targets).
  addDetached(step: Record<string, unknown>): string {
    const id = `step-${++this.n}`;
    this.steps.push({ id, ...step });
    return id;
  }
  last(): any { return this.steps[this.steps.length - 1]; }
}

function cap<T>(arr: T[], n: number): T[] { return arr.slice(0, n); }

function baseReport(args: {
  source_type: LegacySourceType;
  source_id:   string | null;
  source_name: string;
  source_version?: string | null;
  fidelity:    ConversionReport["fidelity"];
  original_summary: string;
  detected_trigger: string;
}): ReaderResult["report"] {
  return {
    ...args,
    source_version:        args.source_version ?? null,
    detected_actions:      [],
    detected_variables:    [],
    detected_conditions:   [],
    provider_dependencies: [],
    converted:             [],
    unsupported:           [],
    warnings:              [],
    assumptions:           [],
    test_plan:             [],
  };
}

// ── Reader: existing WEBEE agent (flow_data) ───────────────────────────────────
async function readAgentSource(workspaceId: string, agentId: string): Promise<ReaderResult> {
  const { data: agent, error } = await sb().from("agents")
    .select("id, name, agent_type, flow_data, variables")
    .eq("id", agentId).eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!agent) throw new Error("Agent not found in this workspace.");

  const flow = typeof agent.flow_data === "string" ? JSON.parse(agent.flow_data) : (agent.flow_data ?? {});
  const nodes: any[] = Array.isArray(flow?.nodes) ? flow.nodes : [];

  const report = baseReport({
    source_type: "agent",
    source_id:   String(agent.id),
    source_name: String(agent.name ?? "Agent"),
    fidelity:    "partial",
    original_summary: `Voice/WhatsApp agent "${agent.name}" with ${nodes.length} flow node(s). The agent handles the live conversation; this conversion extracts the AFTER-CALL business logic into a WEBEE workflow.`,
    detected_trigger: "call_completed (agent call ends)",
  });

  // Walk builder nodes (node.data = FlowNodeData). Defensive on shape.
  const extractionFields: Array<{ name: string; description?: string }> = [];
  let blob = "";
  let conversationCount = 0;
  for (const n of nodes) {
    const d = n?.data ?? n ?? {};
    const kind  = String(d.kind ?? n?.type ?? "conversation");
    const label = String(d.label ?? "").slice(0, 200);
    const dialogue = String(d.dialogue ?? "").slice(0, 2000);
    blob += ` ${label} ${dialogue}`.toLowerCase();
    for (const t of (Array.isArray(d.transitions) ? d.transitions : [])) {
      const cond = String(t?.condition ?? "").trim();
      if (cond) report.detected_conditions.push(cond.slice(0, 200));
    }
    switch (kind) {
      case "conversation": conversationCount++; break;
      case "extract_variable": {
        const name = (label || dialogue.split(/\s+/).slice(0, 4).join(" ") || "extracted_field").slice(0, 120);
        extractionFields.push({ name, description: dialogue.slice(0, 500) || undefined });
        report.converted.push({ from: `Extract variable node "${label || name}"`, to: "extraction_field" });
        break;
      }
      case "function":
        report.unsupported.push({ item: `Function/webhook node "${label || "function"}"`, reason: "Custom function or webhook call — re-create it as a WEBEE integration action or keep it inside the agent flow. It was NOT converted or executed.", status: "unsupported_requires_review" });
        break;
      case "code":
        report.unsupported.push({ item: `Code node "${label || "code"}"`, reason: "Custom code is never executed or converted automatically — review the logic and re-implement it with safe WEBEE steps.", status: "unsupported_requires_review" });
        break;
      case "sms":
        report.unsupported.push({ item: `SMS node "${label || "sms"}"`, reason: "WEBEE workflows have no SMS step yet — use WhatsApp (send_whatsapp) or HexMail (send_email) instead.", status: "unsupported_requires_review" });
        break;
      case "call_transfer":
      case "agent_transfer":
        report.converted.push({ from: `Transfer node "${label || kind}"`, to: "notify_user (escalation)" });
        report.warnings.push(`Transfer node "${label || kind}" became a workspace notification — a workflow cannot transfer a live call.`);
        break;
      default: break;
    }
  }

  // Agent-level variables.
  const variables: Array<{ name: string; description?: string; source?: string }> = [];
  for (const v of (Array.isArray(agent.variables) ? agent.variables : [])) {
    const name = String(v?.name ?? v?.id ?? "").slice(0, 120);
    if (name) variables.push({ name, description: String(v?.description ?? "").slice(0, 500) || undefined, source: "agent variable" });
  }
  report.detected_variables = cap([...variables.map((v) => v.name), ...extractionFields.map((f) => f.name)], 40);

  const hasBooking  = /\bbook|appointment|schedule|calendar|slot\b/.test(blob);
  const hasCrm      = /\bcrm|hubspot|salesforce|pipedrive|zoho\b/.test(blob);
  const hasEmail    = /\bemail|confirmation\b/.test(blob);
  const hasEscalate = report.converted.some((c) => c.to.includes("notify_user"));

  // Deterministic after-call workflow (per the standard qualification pattern):
  // trigger(call_completed) → branch(sentiment) → happy path / review path.
  const chain = new StepChain();
  chain.add({ type: "trigger" });
  const branchId = chain.add({ type: "branch" });
  const happyId = chain.addDetached({ type: "update_lead_status", status: "interested" });
  report.converted.push({ from: "Positive/neutral call outcome", to: "update_lead_status → interested" });
  let cursor = chain.last();
  if (hasBooking) {
    const t = chain.addDetached({ type: "create_task", title: "Confirm booking and save the appointment slot" });
    cursor.next = t; cursor = chain.last();
    const q = chain.addDetached({ type: "update_lead_status", status: "qualified" });
    cursor.next = q; cursor = chain.last();
    report.converted.push({ from: "Booking/appointment logic", to: "create_task + update_lead_status → qualified" });
    report.assumptions.push("Booking wording detected in the agent flow — assumed a booked appointment means the lead is qualified.");
  }
  if (hasCrm) {
    const c = chain.addDetached({ type: "push_to_crm" });
    cursor.next = c; cursor = chain.last();
    report.converted.push({ from: "CRM update logic", to: "push_to_crm" });
    report.provider_dependencies.push("Connected CRM");
  }
  if (hasEmail) {
    const e = chain.addDetached({ type: "send_email" });
    cursor.next = e; cursor = chain.last();
    report.converted.push({ from: "Email confirmation/follow-up logic", to: "send_email" });
    report.provider_dependencies.push("Email sending (Resend)");
  }
  const happyStop = chain.addDetached({ type: "stop_workflow" });
  cursor.next = happyStop;

  // Review path (negative/unclear outcome).
  const reviewId = chain.addDetached({ type: "update_lead_status", status: "contact_made" });
  const reviewTask = chain.addDetached({ type: hasEscalate ? "notify_user" : "create_task", title: "Review call outcome — negative or unclear" });
  chain.steps.find((s) => s.id === reviewId)!.next = reviewTask;
  const reviewStop = chain.addDetached({ type: "stop_workflow" });
  chain.steps.find((s) => s.id === reviewTask)!.next = reviewStop;

  const branch = chain.steps.find((s) => s.id === branchId)!;
  branch.conditions = [
    { field: "sentiment", op: "equals", value: "positive", next: happyId },
    { field: "sentiment", op: "equals", value: "neutral",  next: happyId },
  ];
  branch.next = reviewId; // else path
  report.detected_conditions.unshift("sentiment is positive or neutral");

  report.detected_actions = chain.steps
    .filter((s) => !["trigger", "branch", "stop_workflow"].includes(s.type))
    .map((s) => String(s.type));
  report.provider_dependencies.push("Deployed voice agent (call trigger)");
  report.assumptions.push("The agent itself keeps handling the live conversation — this workflow only automates what happens AFTER a call completes.");
  report.test_plan = [
    "Run the workflow manually against one test lead with a positive sentiment call and confirm the status change.",
    "Run it against a negative-sentiment call and confirm only the review task is created.",
    "Confirm the original agent flow is completely unchanged.",
  ];

  const config = {
    agent_prompt: "",
    workflow: {
      name:           `Converted from agent: ${String(agent.name ?? "agent").slice(0, 160)}`,
      purpose:        `After-call automation extracted from the "${agent.name}" agent setup. Original agent untouched.`,
      trigger_type:   "call_completed",
      trigger_config: {},
      steps:          chain.steps,
    },
    variables:         cap(variables, 40),
    extraction_fields: cap(extractionFields, 40),
    follow_up_rules:   hasEmail ? [{ trigger: "No response within 24 hours of the call", action: "Send a follow-up email", delay_hours: 24, channel: "email" }] : [],
    channel_setup:     { voice: "Deployed voice agent required for the call trigger" },
    required_credentials: [],
    risks:             ["Changes lead statuses automatically after calls"],
    test_plan:         report.test_plan,
  };

  return { config, report, title: `Convert agent: ${String(agent.name ?? "agent").slice(0, 160)}`, targetAgentId: String(agent.id) };
}

// ── Reader: n8n blueprint (stored discovery snapshot — never the n8n API) ──────
async function readN8nSource(workspaceId: string, rowId: string): Promise<ReaderResult> {
  const { data: src, error } = await sb().from("systemmind_n8n_workflows")
    .select("id, n8n_workflow_id, name, raw_snapshot, metadata, n8n_updated_at")
    .eq("id", rowId).eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!src) throw new Error("n8n workflow not found in this workspace — run a discovery scan first.");

  const { steps, triggerType, report: n8nReport, hasBulk } = convertN8nNodesToSteps(src.raw_snapshot);

  const report = baseReport({
    source_type:    "n8n",
    source_id:      String(src.id),
    source_name:    String(src.name ?? "n8n workflow"),
    source_version: src.n8n_updated_at ? String(src.n8n_updated_at) : null,
    fidelity:       n8nReport.unconvertible.length === 0 ? "full" : "partial",
    original_summary: `n8n workflow "${src.name}" (${src.n8n_workflow_id}) used as a BLUEPRINT — the converted workflow runs entirely inside WEBEE; n8n is never called at runtime. The original blueprint stays stored for audit.`,
    detected_trigger: triggerType,
  });
  report.converted   = n8nReport.converted.map((c) => ({ from: `${c.node} (${c.n8n_type})`, to: c.webee_step }));
  report.unsupported = n8nReport.unconvertible.map((u) => ({ item: `${u.node} (${u.n8n_type})`, reason: u.reason, status: "unsupported_requires_review" as const }));
  report.warnings    = [...n8nReport.warnings];
  if (hasBulk) report.warnings.push("The original workflow processed items in bulk — the WEBEE version runs per-lead. Review before enabling any schedule.");
  report.detected_actions = steps.filter((s: any) => !["trigger", "branch", "stop_workflow"].includes(s.type)).map((s: any) => String(s.type));
  report.test_plan = [
    "Review the mapping report — every unconvertible node needs a manual decision.",
    "Run the workflow manually against a single test lead before enabling any schedule.",
    "Verify branch conditions (if any) — they are NOT auto-translated.",
    "Confirm the original n8n workflow still runs untouched (WEBEE never modifies it).",
  ];

  const config = {
    agent_prompt: "",
    workflow: {
      name:           `Converted from n8n: ${String(src.name ?? "workflow").slice(0, 160)}`,
      purpose:        `WEBEE-native workflow converted from the n8n blueprint "${src.name}". ${n8nReport.converted.length} node(s) converted, ${n8nReport.unconvertible.length} flagged for manual review.`,
      trigger_type:   triggerType,
      trigger_config: {},
      steps,
    },
    channel_setup: {},
    risks:         ["Converted from an external blueprint — verify each step before going live"],
    test_plan:     report.test_plan,
  };

  return { config, report, title: `Convert n8n: ${String(src.name ?? "workflow").slice(0, 160)}` };
}

// ── Reader: HexMail / Follow Up Centre sequence ────────────────────────────────
async function readHexmailSource(workspaceId: string, campaignId: string): Promise<ReaderResult> {
  const { data: campaign, error } = await sb().from("hexmail_campaigns")
    .select("id, name, description, status, config")
    .eq("id", campaignId).eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!campaign) throw new Error("Follow-up sequence not found in this workspace.");

  const { data: seqSteps } = await sb().from("hexmail_campaign_steps")
    .select("day_number, actions")
    .eq("campaign_id", campaignId)
    .order("day_number", { ascending: true });

  const targetStatuses: string[] = Array.isArray(campaign.config?.target_statuses) ? campaign.config.target_statuses : [];
  const report = baseReport({
    source_type: "hexmail_sequence",
    source_id:   String(campaign.id),
    source_name: String(campaign.name ?? "Sequence"),
    fidelity:    "partial",
    original_summary: `Follow Up Centre sequence "${campaign.name}" (${(seqSteps ?? []).length} day step(s)${targetStatuses.length ? `, targets statuses: ${targetStatuses.join(", ")}` : ""}). The original sequence keeps running unchanged.`,
    detected_trigger: targetStatuses.length ? `lead status becomes one of: ${targetStatuses.join(", ")}` : "manual",
  });

  const VALID_STATUSES = new Set(["need_to_call", "calling", "contact_made", "interested", "qualified", "not_interested", "callback_requested"]);
  const chain = new StepChain();
  chain.add({ type: "trigger" });
  let prevDay = 1;
  let truncated = false;
  for (const row of (seqSteps ?? []) as Array<{ day_number: number; actions: any[] }>) {
    const day = Number(row.day_number ?? 1);
    if (chain.steps.length >= 27) { truncated = true; break; }
    if (day > prevDay) {
      chain.add({ type: "create_callback", delay_hours: Math.min(720, Math.max(1, (day - prevDay) * 24)) });
      report.warnings.push(`Day ${day} wait became a scheduled callback of ${(day - prevDay) * 24}h — WEBEE workflows execute synchronously, so day gaps are reminders, not hard pauses.`);
      prevDay = day;
    }
    for (const action of (Array.isArray(row.actions) ? row.actions : [])) {
      if (chain.steps.length >= 28) { truncated = true; break; }
      const type = String(action?.type ?? "");
      const notes = String(action?.notes ?? "").slice(0, 200);
      switch (type) {
        case "email":
          chain.add({ type: "send_email" });
          report.converted.push({ from: `Day ${day}: email`, to: "send_email" });
          report.provider_dependencies.push("Email sending (Resend)");
          break;
        case "whatsapp":
          chain.add({ type: "send_whatsapp", template: (notes || String(action?.template_id ?? "follow-up")).slice(0, 120) });
          report.converted.push({ from: `Day ${day}: WhatsApp`, to: "send_whatsapp" });
          report.provider_dependencies.push("WhatsApp provider (Twilio / Meta / WATI)");
          break;
        case "ai_call":
          chain.add({ type: "call_lead" });
          report.converted.push({ from: `Day ${day}: AI call`, to: "call_lead" });
          report.provider_dependencies.push("Deployed voice agent");
          break;
        case "task":
          chain.add({ type: "create_task", title: (notes || "Follow-up task").slice(0, 300) });
          report.converted.push({ from: `Day ${day}: task`, to: "create_task" });
          break;
        case "notification":
          chain.add({ type: "notify_user", title: (notes || "Follow-up notification").slice(0, 300) });
          report.converted.push({ from: `Day ${day}: notification`, to: "notify_user" });
          break;
        case "pipeline_update": {
          const status = String(action?.config?.status ?? "");
          const safe = VALID_STATUSES.has(status) ? status : "contact_made";
          if (safe !== status) report.warnings.push(`Day ${day}: pipeline update used status "${status || "(none)"}" — mapped to "contact_made"; adjust if needed.`);
          chain.add({ type: "update_lead_status", status: safe });
          report.converted.push({ from: `Day ${day}: pipeline update`, to: `update_lead_status → ${safe}` });
          break;
        }
        case "sms":
          report.unsupported.push({ item: `Day ${day}: SMS`, reason: "WEBEE workflows have no SMS step yet — use WhatsApp or email instead.", status: "unsupported_requires_review" });
          break;
        case "tag_assignment":
          report.unsupported.push({ item: `Day ${day}: tag assignment`, reason: "Workflow steps cannot assign tags yet — apply tags manually or via CRM rules.", status: "unsupported_requires_review" });
          break;
        default:
          report.unsupported.push({ item: `Day ${day}: ${type || "unknown action"}`, reason: "Unrecognised sequence action.", status: "unsupported_requires_review" });
      }
    }
  }
  chain.add({ type: "stop_workflow" });
  if (truncated) report.warnings.push("Sequence was longer than the 30-step workflow limit — later days were left out. Keep the original sequence for the tail, or split into two workflows.");

  report.detected_actions = chain.steps.filter((s) => !["trigger", "branch", "stop_workflow"].includes(s.type)).map((s) => String(s.type));
  report.test_plan = [
    "Run the workflow manually against a single test lead and confirm each message/task fires in order.",
    "Confirm the original Follow Up Centre sequence still runs unchanged.",
    "Check day gaps: callbacks are reminders — verify the timing matches your expectation before going live.",
  ];

  const followUpRules = (seqSteps ?? []).slice(0, 20).map((s: any) => ({
    trigger:     `Day ${s.day_number} of the sequence`,
    action:      `Run ${Array.isArray(s.actions) ? s.actions.length : 0} action(s) from the original sequence`,
    delay_hours: Math.min(2160, Math.max(0, (Number(s.day_number ?? 1) - 1) * 24)),
  }));

  const config = {
    agent_prompt: "",
    workflow: {
      name:           `Converted from sequence: ${String(campaign.name ?? "sequence").slice(0, 150)}`,
      purpose:        String(campaign.description ?? `WEBEE workflow converted from the "${campaign.name}" follow-up sequence.`).slice(0, 2000),
      trigger_type:   targetStatuses.length ? "lead_status_changed" : "manual",
      trigger_config: targetStatuses.length ? { statuses: targetStatuses } : {},
      steps:          chain.steps,
    },
    follow_up_rules: followUpRules,
    channel_setup:   {},
    risks:           ["Messages customers automatically across multiple days"],
    test_plan:       report.test_plan,
  };

  return { config, report, title: `Convert sequence: ${String(campaign.name ?? "sequence").slice(0, 150)}` };
}

// ── Reader: WATI / WhatsApp setup ──────────────────────────────────────────────
async function readWatiSource(workspaceId: string, campaignId: string): Promise<ReaderResult> {
  const { data: row, error } = await sb().from("wati_campaigns")
    .select("id, name, template_name, broadcast_name, status")
    .eq("id", campaignId).eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) throw new Error("WATI campaign not found in this workspace.");

  const template = String(row.template_name ?? row.broadcast_name ?? row.name ?? "whatsapp-template").slice(0, 120);
  const report = baseReport({
    source_type: "wati_setup",
    source_id:   String(row.id),
    source_name: String(row.name ?? "WATI campaign"),
    fidelity:    "partial",
    original_summary: `WATI WhatsApp broadcast "${row.name}"${row.template_name ? ` using template "${row.template_name}"` : ""}. The WATI setup itself is untouched.`,
    detected_trigger: "manual",
  });
  report.converted.push({ from: `WATI broadcast "${row.name}"`, to: "send_whatsapp" });
  report.provider_dependencies.push("WATI connection (or Twilio/Meta WhatsApp)");
  report.warnings.push("A WATI broadcast fans out to a whole audience — the WEBEE workflow sends per-lead. Trigger it from lead events or run it manually per lead; do NOT schedule it against all leads without review.");
  report.detected_actions = ["send_whatsapp", "update_lead_status"];
  report.test_plan = [
    "Run manually against one test lead and confirm the WhatsApp template renders correctly.",
    "Confirm the original WATI broadcast is unchanged.",
  ];

  const chain = new StepChain();
  chain.add({ type: "trigger" });
  chain.add({ type: "send_whatsapp", template });
  chain.add({ type: "update_lead_status", status: "contact_made" });
  chain.add({ type: "stop_workflow" });

  const config = {
    agent_prompt: "",
    workflow: {
      name:           `Converted from WATI: ${String(row.name ?? "broadcast").slice(0, 155)}`,
      purpose:        `Per-lead WhatsApp send converted from the WATI broadcast "${row.name}".`,
      trigger_type:   "manual",
      trigger_config: {},
      steps:          chain.steps,
    },
    channel_setup: { whatsapp: "WATI connection (or Twilio/Meta) required" },
    risks:         ["Sends WhatsApp messages to customers"],
    test_plan:     report.test_plan,
  };

  return { config, report, title: `Convert WATI: ${String(row.name ?? "broadcast").slice(0, 155)}` };
}

// ── Reader: webform + auto-call intake setup ───────────────────────────────────
async function readWebformAutoCallSource(workspaceId: string, webformId: string): Promise<ReaderResult> {
  const [{ data: form, error }, { data: ws }] = await Promise.all([
    sb().from("webform_sources")
      .select("id, name, status, default_source_type, notify_email")
      .eq("id", webformId).eq("workspace_id", workspaceId)
      .maybeSingle(),
    sb().from("workspace_settings")
      .select("lead_auto_call_enabled, lead_auto_call_agent_id")
      .eq("workspace_id", workspaceId).maybeSingle(),
  ]);
  if (error) throw new Error(error.message);
  if (!form) throw new Error("Webform not found in this workspace.");

  const report = baseReport({
    source_type: "webform_auto_call",
    source_id:   String(form.id),
    source_name: String(form.name ?? "Webform"),
    fidelity:    "full",
    original_summary: `Webform lead intake "${form.name}"${ws?.lead_auto_call_enabled ? " with auto-call enabled" : ""}. Converts the intake behaviour into an editable WEBEE workflow; the live webform and auto-call switch stay untouched.`,
    detected_trigger: "lead_added (webform submission)",
  });
  report.converted.push({ from: "Webform submission", to: "lead_added trigger" });
  report.converted.push({ from: "Auto-call on new lead", to: "call_lead" });
  report.provider_dependencies.push("Deployed voice agent");
  if (form.notify_email) report.converted.push({ from: `Notify ${String(form.notify_email).split("@")[0]}@…`, to: "notify_user" });
  if (!ws?.lead_auto_call_enabled) report.warnings.push("Auto-call is currently switched OFF in this workspace — the converted workflow will still queue calls when run. Turn auto-call on or keep this workflow manual.");
  if (!ws?.lead_auto_call_agent_id) report.warnings.push("No auto-call agent is selected in workspace settings — pick a qualification agent before applying.");
  report.detected_actions = ["update_lead_status", "call_lead", ...(form.notify_email ? ["notify_user"] : [])];
  report.detected_variables = ["name", "email", "phone (from webform fields)"];
  report.test_plan = [
    "Submit a test lead through the webform and run the workflow manually against it.",
    "Confirm the call is queued to the correct qualification agent.",
    "Confirm the live webform and auto-call switch are unchanged.",
  ];

  const chain = new StepChain();
  chain.add({ type: "trigger" });
  chain.add({ type: "update_lead_status", status: "calling" });
  chain.add({ type: "call_lead" });
  if (form.notify_email) chain.add({ type: "notify_user", title: `New webform lead from "${String(form.name).slice(0, 100)}" — call queued` });
  chain.add({ type: "stop_workflow" });

  const config = {
    agent_prompt: "",
    workflow: {
      name:           `Converted from webform: ${String(form.name ?? "webform").slice(0, 150)}`,
      purpose:        `Lead-intake auto-call flow converted from the "${form.name}" webform setup.`,
      trigger_type:   "lead_added",
      trigger_config: { source: String(form.default_source_type ?? "webform") },
      steps:          chain.steps,
    },
    variables: [
      { name: "name",  source: "webform field" },
      { name: "email", source: "webform field" },
      { name: "phone", source: "webform field" },
    ],
    follow_up_rules: [{ trigger: "Call not answered", action: "Retry the call (maximum 3 attempts per day)", delay_hours: 4, channel: "voice" }],
    channel_setup:   { voice: "Deployed qualification agent required" },
    risks:           ["Queues outbound AI calls to new leads automatically"],
    test_plan:       report.test_plan,
  };

  return {
    config, report,
    title: `Convert webform intake: ${String(form.name ?? "webform").slice(0, 140)}`,
    targetAgentId: ws?.lead_auto_call_agent_id ? String(ws.lead_auto_call_agent_id) : null,
  };
}

// ── Reader: manual business-process description (AI-assisted) ──────────────────
const MANUAL_CONVERSION_PROMPT = `You are SystemMind, the AI CTO of the WEBEE platform. Convert the user's description of an old/manual business process into ONE WEBEE-native workflow build config. You NEVER execute anything — this is a draft for human review.

Use ONLY these step types:
- trigger            — first step (no params)
- update_lead_status — set "status" (one of: need_to_call, calling, contact_made, interested, qualified, not_interested, callback_requested)
- push_to_crm        — sync the lead to the connected CRM (no params)
- create_callback    — schedule callback; params: delay_hours, delay_minutes
- create_task        — create an ops task; params: title
- send_whatsapp      — queue a WhatsApp message; params: template
- send_email         — queue an email follow-up (no params)
- notify_user        — notify the workspace owner; params: title
- assign_agent       — assign an AI agent; params: agent_assignment
- call_lead          — queue an outbound AI call (no params)
- branch             — conditional split; params: conditions: [{field, op, value, next}] where op ∈ equals|not_equals|greater_than|less_than|contains
- stop_workflow      — terminal step (no params)
Trigger types allowed: lead_added, lead_status_changed, call_completed, manual, scheduled.
STEP GRAPH RULES: first step MUST be type "trigger" with id "step-1"; every non-terminal step needs "next" OR conditions (branch only); ids "step-1", "step-2", ... unique; keep it 3–12 steps.

If part of the described process CANNOT be represented with these steps, list it in "unsupported" with a plain-language reason — do NOT invent step types.
SAFETY: NEVER include API keys, tokens, passwords, or any credential values. Credential NAMES only in required_credentials.

Return ONLY valid JSON:
{ "summary": "...", "unsupported": [{"item": "...", "reason": "..."}], "config": { "agent_prompt": "", "workflow": { "name": "...", "purpose": "...", "trigger_type": "...", "trigger_config": {}, "steps": [...] }, "variables": [...], "extraction_fields": [...], "follow_up_rules": [...], "channel_setup": {}, "required_credentials": [...], "risks": [...], "test_plan": [...] } }`;

async function readManualDescription(workspaceId: string, description: string): Promise<ReaderResult> {
  const claudeEnabled = isClaudeEnabled();
  const routed = await routeGenerate({
    system:      MANUAL_CONVERSION_PROMPT,
    user:        `Convert this legacy/manual business process into a WEBEE workflow build config:\n\n${description.slice(0, 6000)}\n\nProduce the JSON now.`,
    maxTokens:   4000,
    contentType: "systemmind_automation",
    mode:        "manual",
    provider:    claudeEnabled ? "claude" : "openai",
    model:       claudeEnabled ? "claude-sonnet-4-5" : "gpt-4.1",
    settings:    {},
    workspaceId,
    sb:          sb(),
  } as any);

  const cleaned = routed.text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  let parsed: any;
  try { parsed = JSON.parse(cleaned); } catch {
    throw new Error("SystemMind could not produce a valid conversion from that description — try describing the process step by step (trigger, then each action).");
  }
  const shell = z.object({
    summary:     z.string().max(4000).default(""),
    unsupported: z.array(z.object({ item: z.string().max(300), reason: z.string().max(500) })).max(20).default([]),
    config:      z.unknown(),
  }).parse(parsed);

  const report = baseReport({
    source_type: "manual_description",
    source_id:   null,
    source_name: description.slice(0, 120),
    fidelity:    "assisted",
    original_summary: description.slice(0, 2000),
    detected_trigger: String((shell.config as any)?.workflow?.trigger_type ?? "manual"),
  });
  report.unsupported = shell.unsupported.map((u) => ({ ...u, status: "unsupported_requires_review" as const }));
  report.assumptions.push("This conversion was AI-assisted from a plain-language description — review every step before applying.");
  const steps = Array.isArray((shell.config as any)?.workflow?.steps) ? (shell.config as any).workflow.steps : [];
  report.detected_actions = steps.filter((s: any) => !["trigger", "branch", "stop_workflow"].includes(String(s?.type))).map((s: any) => String(s?.type));
  report.converted = report.detected_actions.map((a) => ({ from: "Described process", to: a }));
  report.test_plan = Array.isArray((shell.config as any)?.test_plan) ? cap((shell.config as any).test_plan.map((t: any) => String(t).slice(0, 400)), 20) : [];

  return {
    config: (shell.config ?? {}) as Record<string, unknown>,
    report,
    title:  `Convert process: ${description.slice(0, 140)}`,
    usage:  {
      provider:     String(routed.provider),
      model:        String(routed.model),
      inputTokens:  Number(routed.inputTokens ?? 0),
      outputTokens: Number(routed.outputTokens ?? 0),
      costUsd:      Number(routed.costUsd ?? 0),
    },
  };
}

// ── List convertible sources (UI picker) ───────────────────────────────────────
export async function listLegacyConversionSourcesServer(workspaceId: string): Promise<{
  agents:    Array<{ id: string; name: string; agent_type: string | null }>;
  workflows: Array<{ id: string; name: string; is_active: boolean; status?: string }>;
  n8n:       Array<{ id: string; name: string }>;
  sequences: Array<{ id: string; name: string; status: string | null }>;
  wati:      Array<{ id: string; name: string; template_name: string | null }>;
  webforms:  Array<{ id: string; name: string; status: string | null }>;
}> {
  if (!workspaceId) throw new Error("workspace_id missing.");
  const s = sb();
  const safe = async (q: any) => { try { const { data } = await q; return data ?? []; } catch { return []; } };
  const [agents, workflows, n8n, sequences, wati, webforms] = await Promise.all([
    safe(s.from("agents").select("id, name, agent_type").eq("workspace_id", workspaceId).order("name").limit(200)),
    safe(s.from("workspace_workflows").select("id, name, status").eq("workspace_id", workspaceId).order("name").limit(200)),
    safe(s.from("systemmind_n8n_workflows").select("id, name").eq("workspace_id", workspaceId).order("name").limit(200)),
    safe(s.from("hexmail_campaigns").select("id, name, status").eq("workspace_id", workspaceId).neq("status", "archived").order("name").limit(200)),
    safe(s.from("wati_campaigns").select("id, name, template_name").eq("workspace_id", workspaceId).order("name").limit(200)),
    safe(s.from("webform_sources").select("id, name, status").eq("workspace_id", workspaceId).order("name").limit(200)),
  ]);
  return {
    agents, n8n, sequences, wati, webforms,
    workflows: (workflows as any[]).map((w) => ({ id: w.id, name: w.name, status: w.status, is_active: w.status === "active" })),
  };
}

// ── Orchestrator ───────────────────────────────────────────────────────────────
export async function convertLegacySourceServer(args: {
  workspaceId: string;
  userId:      string | null;
  sourceType:  LegacySourceType;
  sourceId?:   string | null;
  description?: string | null;
  sourcePage?: string;
}): Promise<{ sessionId: string; versionId: string; conversionId: string | null; report: ConversionReport }> {
  const { workspaceId, userId, sourceType } = args;
  if (!workspaceId) throw new Error("workspace_id missing — refusing to convert.");
  await assertNotWbahWorkspace(workspaceId);
  const startedAt = new Date();

  // ── "workflow" source: already WEBEE-native — reuse edit-mode seeding. ──────
  if (sourceType === "workflow") {
    if (!args.sourceId) throw new Error("Pick the workflow to load.");
    const { sessionId, seededVersionId } = await createBuildSessionServer({
      workspaceId, userId,
      sourcePage:       args.sourcePage ?? "systemmind",
      linkedWorkflowId: args.sourceId,
    });
    if (!seededVersionId) throw new Error("Failed to seed the workflow into the Build Workspace.");
    const report: ConversionReport = {
      ...baseReport({
        source_type: "workflow", source_id: args.sourceId, source_name: "Existing WEBEE workflow",
        fidelity: "full",
        original_summary: "Already a WEBEE-native workflow — loaded into the Build Workspace for editing. The live workflow is untouched until Apply.",
        detected_trigger: "unchanged from the live workflow",
      }),
      approval_required: false, risk_level: "low", risk_reasons: [],
    };
    const conversionId = await insertConversionRow({ workspaceId, userId, sessionId, versionId: seededVersionId, report });
    await recordSystemMindUsageEvent({
      workspaceId, userId, sessionId, versionId: seededVersionId,
      taskType:   "legacy_conversion",
      sourcePage: "systemmind",
      modelProvider: null, modelId: null, promptTokens: 0, completionTokens: 0,
      startedAt, completedAt: new Date(), success: true,
    });
    await writeSystemMindAudit({
      workspaceId, userId,
      actionType: "legacy_conversion_completed",
      targetType: "systemmind_conversion",
      targetId:   conversionId ?? sessionId,
      beforeState: { source_type: "workflow", source_id: args.sourceId, source_name: report.source_name },
      finalAfterState: {
        session_id: sessionId, version_id: seededVersionId,
        converted: 0, unsupported: 0, warnings: 0,
        risk_level: "low", fidelity: "full",
        original_summary: report.original_summary.slice(0, 500),
      },
    });
    return { sessionId, versionId: seededVersionId, conversionId, report };
  }

  // ── Read + convert the legacy source ────────────────────────────────────────
  let reader: ReaderResult;
  switch (sourceType) {
    case "agent":
      if (!args.sourceId) throw new Error("Pick the agent to convert.");
      reader = await readAgentSource(workspaceId, args.sourceId);
      break;
    case "n8n":
      if (!args.sourceId) throw new Error("Pick the n8n workflow to convert.");
      reader = await readN8nSource(workspaceId, args.sourceId);
      break;
    case "hexmail_sequence":
      if (!args.sourceId) throw new Error("Pick the follow-up sequence to convert.");
      reader = await readHexmailSource(workspaceId, args.sourceId);
      break;
    case "wati_setup":
      if (!args.sourceId) throw new Error("Pick the WATI campaign to convert.");
      reader = await readWatiSource(workspaceId, args.sourceId);
      break;
    case "webform_auto_call":
      if (!args.sourceId) throw new Error("Pick the webform to convert.");
      reader = await readWebformAutoCallSource(workspaceId, args.sourceId);
      break;
    case "manual_description": {
      const desc = String(args.description ?? "").trim();
      if (desc.length < 20) throw new Error("Describe the process in at least a couple of sentences.");
      reader = await readManualDescription(workspaceId, desc);
      break;
    }
    default:
      throw new Error(`Unknown source type "${sourceType}".`);
  }

  // ── Validate the converted config exactly like any other draft ──────────────
  const config: BuildConfig = validateConfigOrThrow(reader.config, "Legacy conversion");
  const { riskLevel, riskReasons } = classifyConfigRisk(config);
  const report: ConversionReport = {
    ...reader.report,
    detected_actions:      cap([...new Set(reader.report.detected_actions)], 30),
    detected_variables:    cap(reader.report.detected_variables, 40),
    detected_conditions:   cap(reader.report.detected_conditions, 30),
    provider_dependencies: cap([...new Set(reader.report.provider_dependencies)], 20),
    converted:             cap(reader.report.converted, 60),
    unsupported:           cap(reader.report.unsupported, 40),
    warnings:              cap(reader.report.warnings, 40),
    assumptions:           cap(reader.report.assumptions, 20),
    test_plan:             reader.report.test_plan.length ? cap(reader.report.test_plan, 20) : cap(config.test_plan, 20),
    approval_required:     riskLevel === "high",
    risk_level:            riskLevel,
    risk_reasons:          riskReasons,
  };
  assertNoCredentialValues({ config, report }, "Legacy conversion");

  // ── Seed a fresh Build Workspace session (nothing live is touched) ──────────
  const summaryBits = [
    `SystemMind found this old logic and converted it into a WEBEE workflow draft.`,
    `${report.converted.length} element(s) converted${report.unsupported.length ? `, ${report.unsupported.length} need manual review` : ""}.`,
    report.warnings.length ? `${report.warnings.length} warning(s) — see the conversion report.` : "",
    `The original setup is untouched; nothing goes live until you Apply${report.approval_required ? " (approval required — high risk)" : ""}.`,
  ].filter(Boolean);
  const { sessionId, versionId } = await createBuildSessionFromConfigServer({
    workspaceId, userId,
    title:            reader.title,
    sourcePage:       args.sourcePage,
    targetAgentId:    reader.targetAgentId ?? null,
    config,
    assistantSummary: summaryBits.join(" "),
    systemNote: [
      `Session opened by the Legacy Logic Converter (source: ${report.source_type} — "${report.source_name}").`,
      `v1 is the converted draft. The original setup was NOT modified.`,
      report.unsupported.length
        ? `Needs manual review: ${report.unsupported.map((u) => u.item).join("; ").slice(0, 2000)}`
        : "",
    ].filter(Boolean).join("\n"),
  });

  // ── Lineage row + manual-review task + audit + usage ────────────────────────
  const conversionId = await insertConversionRow({ workspaceId, userId, sessionId, versionId, report });

  if (report.unsupported.length > 0) {
    try {
      const { assertProposalAllowed } = await import("@/lib/hivemind/mode-gate.server");
      await assertProposalAllowed(sb(), workspaceId);
      await sb().from("hivemind_tasks").insert({
        workspace_id: workspaceId,
        title:        `Review unconverted logic from "${report.source_name}"`.slice(0, 200),
        description:  `The Legacy Logic Converter could not convert ${report.unsupported.length} item(s):\n${report.unsupported.map((u) => `• ${u.item} — ${u.reason}`).join("\n")}`.slice(0, 4000),
        status:       "suggested",
        priority:     "medium",
        trigger_type: "legacy_conversion_review",
        entity_type:  "systemmind_conversion",
        entity_id:    conversionId,
        created_at:   new Date().toISOString(),
      });
    } catch (err: any) {
      console.error("[legacy-conversion] manual review task insert failed:", err?.message);
    }
  }

  const completedAt = new Date();
  await recordSystemMindUsageEvent({
    workspaceId, userId, sessionId, versionId,
    taskType:         "legacy_conversion",
    sourcePage:       "systemmind",
    modelProvider:    reader.usage?.provider ?? null,
    modelId:          reader.usage?.model ?? null,
    promptTokens:     reader.usage?.inputTokens ?? 0,
    completionTokens: reader.usage?.outputTokens ?? 0,
    startedAt, completedAt, success: true,
  });

  await writeSystemMindAudit({
    workspaceId, userId,
    actionType: "legacy_conversion_completed",
    targetType: "systemmind_conversion",
    targetId:   conversionId ?? sessionId,
    beforeState: { source_type: report.source_type, source_id: report.source_id, source_name: report.source_name },
    finalAfterState: {
      session_id: sessionId, version_id: versionId,
      converted: report.converted.length, unsupported: report.unsupported.length,
      warnings: report.warnings.length, risk_level: report.risk_level,
      fidelity: report.fidelity, original_summary: report.original_summary.slice(0, 500),
    },
  });

  return { sessionId, versionId, conversionId, report };
}

async function insertConversionRow(args: {
  workspaceId: string; userId: string | null;
  sessionId: string; versionId: string; report: ConversionReport;
}): Promise<string | null> {
  try {
    const { data, error } = await sb().from("systemmind_conversions").insert({
      workspace_id:       args.workspaceId,
      created_by_user_id: args.userId,
      source_type:        args.report.source_type,
      source_id:          args.report.source_id,
      source_name:        args.report.source_name.slice(0, 500),
      source_version:     args.report.source_version,
      converted_by:       "systemmind",
      session_id:         args.sessionId,
      version_id:         args.versionId,
      fidelity:           args.report.fidelity,
      risk_level:         args.report.risk_level,
      report:             args.report,
    }).select("id").single();
    if (error) { console.error("[legacy-conversion] lineage row insert failed:", error.message); return null; }
    return String(data.id);
  } catch (err: any) {
    console.error("[legacy-conversion] lineage row insert crashed:", err?.message);
    return null;
  }
}

// ── Reads (report panel + history) ─────────────────────────────────────────────
export async function getConversionForSessionServer(workspaceId: string, sessionId: string): Promise<any | null> {
  if (!workspaceId) throw new Error("workspace_id missing.");
  const { data, error } = await sb().from("systemmind_conversions")
    .select("*")
    .eq("workspace_id", workspaceId).eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

export async function listLegacyConversionsServer(workspaceId: string): Promise<any[]> {
  if (!workspaceId) throw new Error("workspace_id missing.");
  const { data, error } = await sb().from("systemmind_conversions")
    .select("id, source_type, source_id, source_name, fidelity, risk_level, session_id, version_id, created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return data ?? [];
}
