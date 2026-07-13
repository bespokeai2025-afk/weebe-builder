// ── SystemMind Build Workspace — apply protection engine (server-only) ────────
// Strict protection rules so a Build Workspace apply can never silently break
// an existing setup:
//
//   • Impact analysis   — what exactly would this apply touch, and is any of
//     it live right now?
//   • Diff computation  — plain-English change list between the target's
//     CURRENT state and the proposed version config.
//   • Conflict detection — hard rules that block or escalate the apply
//     (workspace mismatch, duplicate triggers, removed-but-referenced
//     variables, webhook changes, live targets, missing provider setup).
//   • Rollback snapshots — full prior state captured in
//     systemmind_build_snapshots BEFORE any existing target is modified, and
//     a one-call restore.
//
// Safety invariants (do not weaken):
//   • workspace_id comes ONLY from server context.
//   • Snapshots never contain credential values — the agent settings snapshot
//     is a whitelisted, descriptive-only view (booleans/names).
//   • Rollback restores workspace_workflows + custom_agent_configs ONLY —
//     never agents.settings, never provider credentials.
//   • Read-only impact analysis performs NO writes.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { writeSystemMindAudit } from "@/lib/systemmind/systemmind-automation.server";
import type { BuildConfig } from "@/lib/systemmind/build-workspace.server";

// ── Types ──────────────────────────────────────────────────────────────────────

export type BuildDiffEntry = {
  kind:   "added" | "removed" | "changed" | "renamed" | "disabled";
  area:   "workflow" | "trigger" | "steps" | "agent_prompt" | "variables" | "extraction_fields" | "follow_up_rules" | "channel_setup";
  label:  string;
  detail?: string;
};

export type BuildConflictSeverity = "block" | "needs_approval" | "block_go_live";

export type BuildConflict = {
  code:       string;
  severity:   BuildConflictSeverity;
  message:    string;   // plain-English: what clashes and why
  suggestion: string;   // plain-English: what to do instead
};

export type BuildImpactReport = {
  checkedAt:            string;
  // Target resolution
  targetWorkflowId:     string | null;
  targetWorkflowName:   string | null;
  targetWorkflowStatus: string | null;
  targetIsNew:          boolean;     // true = apply creates a fresh row, touches nothing existing
  targetAgentId:        string | null;
  targetAgentName:      string | null;
  agentIsLive:          boolean;
  agentHasConfig:       boolean;
  targetIsLive:         boolean;     // workflow active OR agent live
  // What else this could affect
  dependencies:         string[];    // plain-English list
  // Change list vs the target's current state (empty when target is new)
  diff:                 BuildDiffEntry[];
  // Hard rules
  conflicts:            BuildConflict[];
  // Outcome
  requiresApproval:     boolean;
  canApplyDirectly:     boolean;     // direct overwrite allowed (after snapshot)
  canGoLive:            boolean;
  rollbackAvailable:    boolean;     // a snapshot will be (or was) taken
};

type Sb = any;

// ── Target resolution (mirrors performBuildApply — keep in sync) ───────────────

export async function resolveBuildApplyTarget(
  workspaceId: string,
  session: any,
): Promise<{ workflowRow: any | null; workflowIdRequested: string | null; workspaceMismatch: boolean }> {
  const sb = supabaseAdmin as Sb;
  let targetWorkflowId: string | null = session.linked_workflow_id ?? null;
  if (!targetWorkflowId) {
    const { data: prior } = await sb.from("systemmind_build_versions")
      .select("applied_workflow_id")
      .eq("session_id", session.id).eq("workspace_id", workspaceId)
      .not("applied_workflow_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1).maybeSingle();
    targetWorkflowId = prior?.applied_workflow_id ?? null;
  }
  if (!targetWorkflowId) return { workflowRow: null, workflowIdRequested: null, workspaceMismatch: false };

  // Defence-in-depth: fetch by id alone, then compare workspace ownership so a
  // cross-workspace reference is reported as a conflict, not silently created-fresh.
  const { data: row } = await sb.from("workspace_workflows")
    .select("*").eq("id", targetWorkflowId).maybeSingle();
  if (!row) return { workflowRow: null, workflowIdRequested: targetWorkflowId, workspaceMismatch: false };
  if (String(row.workspace_id) !== String(workspaceId)) {
    return { workflowRow: null, workflowIdRequested: targetWorkflowId, workspaceMismatch: true };
  }
  return { workflowRow: row, workflowIdRequested: targetWorkflowId, workspaceMismatch: false };
}

// ── Diff computation ────────────────────────────────────────────────────────────

function stepLabel(s: any): string {
  const bits = [String(s.type ?? "step")];
  if (s.title) bits.push(String(s.title));
  else if (s.template) bits.push(String(s.template));
  return bits.join(" — ");
}

export function computeBuildDiff(current: {
  name?: string | null;
  trigger_type?: string | null;
  steps?: any[];
  agent_prompt?: string | null;
  variables?: any[];
  extraction_fields?: any[];
  follow_up_rules?: any[];
}, proposed: BuildConfig): BuildDiffEntry[] {
  const diff: BuildDiffEntry[] = [];

  const curName = String(current.name ?? "").trim();
  const newName = proposed.workflow.name.trim();
  if (curName && newName && curName !== newName) {
    diff.push({ kind: "renamed", area: "workflow", label: `Workflow renamed`, detail: `"${curName}" → "${newName}"` });
  }

  const curTrig = String(current.trigger_type ?? "").trim();
  if (curTrig && curTrig !== proposed.workflow.trigger_type) {
    diff.push({ kind: "changed", area: "trigger", label: "Trigger changed", detail: `"${curTrig}" → "${proposed.workflow.trigger_type}"` });
  }

  // Steps: match by id.
  const curSteps = new Map<string, any>((current.steps ?? []).map((s: any) => [String(s.id), s]));
  const newSteps = new Map<string, any>(proposed.workflow.steps.map((s: any) => [String(s.id), s]));
  for (const [id, s] of newSteps) {
    const prev = curSteps.get(id);
    if (!prev) { diff.push({ kind: "added", area: "steps", label: `Step added: ${stepLabel(s)}` }); continue; }
    const changed =
      String(prev.type) !== String(s.type) ||
      String(prev.next ?? "") !== String(s.next ?? "") ||
      String(prev.status ?? "") !== String(s.status ?? "") ||
      String(prev.template ?? "") !== String(s.template ?? "") ||
      JSON.stringify(prev.conditions ?? null) !== JSON.stringify(s.conditions ?? null);
    if (changed) diff.push({ kind: "changed", area: "steps", label: `Step changed: ${stepLabel(s)}` });
  }
  for (const [id, s] of curSteps) {
    if (!newSteps.has(id)) diff.push({ kind: "removed", area: "steps", label: `Step removed: ${stepLabel(s)}` });
  }

  const curPrompt = String(current.agent_prompt ?? "").trim();
  const newPrompt = (proposed.agent_prompt ?? "").trim();
  if (curPrompt !== newPrompt) {
    if (curPrompt && !newPrompt) diff.push({ kind: "removed", area: "agent_prompt", label: "Agent prompt removed" });
    else if (!curPrompt && newPrompt) diff.push({ kind: "added", area: "agent_prompt", label: "Agent prompt added" });
    else diff.push({ kind: "changed", area: "agent_prompt", label: "Agent prompt changed", detail: `${curPrompt.length} → ${newPrompt.length} characters` });
  }

  const nameSet = (arr: any[] | undefined) => new Set<string>((arr ?? []).map((v: any) => String(v?.name ?? "").trim()).filter(Boolean));
  const curVars = nameSet(current.variables), newVars = nameSet(proposed.variables);
  for (const v of newVars) if (!curVars.has(v)) diff.push({ kind: "added", area: "variables", label: `Variable added: ${v}` });
  for (const v of curVars) if (!newVars.has(v)) diff.push({ kind: "removed", area: "variables", label: `Variable removed: ${v}` });

  const curFields = nameSet(current.extraction_fields), newFields = nameSet(proposed.extraction_fields);
  for (const f of newFields) if (!curFields.has(f)) diff.push({ kind: "added", area: "extraction_fields", label: `Extraction field added: ${f}` });
  for (const f of curFields) if (!newFields.has(f)) diff.push({ kind: "removed", area: "extraction_fields", label: `Extraction field removed: ${f}` });

  const curRules = (current.follow_up_rules ?? []).length;
  const newRules = proposed.follow_up_rules.length;
  if (curRules !== newRules) {
    diff.push({ kind: "changed", area: "follow_up_rules", label: "Follow-up rules changed", detail: `${curRules} → ${newRules} rule(s)` });
  }

  return diff;
}

// ── Variable-reference + webhook extraction ────────────────────────────────────

const VAR_REF_RE = /\{\{\s*([\w.-]+)\s*\}\}/g;

export function extractVariableReferences(config: BuildConfig): Set<string> {
  const refs = new Set<string>();
  const scan = (text: string) => {
    let m: RegExpExecArray | null;
    VAR_REF_RE.lastIndex = 0;
    while ((m = VAR_REF_RE.exec(text)) !== null) refs.add(m[1].split(".")[0]);
  };
  scan(config.agent_prompt ?? "");
  scan(JSON.stringify(config.workflow.steps ?? []));
  scan(JSON.stringify(config.follow_up_rules ?? []));
  return refs;
}

const URL_RE = /https?:\/\/[^\s"'<>)\]}]+/g;

function extractUrls(blob: unknown): Set<string> {
  const out = new Set<string>();
  const text = typeof blob === "string" ? blob : JSON.stringify(blob ?? {});
  let m: RegExpExecArray | null;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(text)) !== null) out.add(m[0].replace(/[.,;]+$/, ""));
  return out;
}

// ── Impact analysis (read-only — performs NO writes) ───────────────────────────

export async function computeBuildImpactReport(args: {
  workspaceId: string;
  session:     any;
  version:     any;
  config:      BuildConfig;
  riskLevel:   "low" | "medium" | "high";
  riskReasons: string[];
}): Promise<BuildImpactReport> {
  const sb = supabaseAdmin as Sb;
  const { workspaceId, session, config } = args;

  const conflicts: BuildConflict[] = [];
  const dependencies: string[] = [];

  // 1. Resolve the target workflow (what would be overwritten).
  const { workflowRow, workflowIdRequested, workspaceMismatch } = await resolveBuildApplyTarget(workspaceId, session);
  if (workspaceMismatch) {
    conflicts.push({
      code:     "workspace_mismatch",
      severity: "block",
      message:  "This build session points at a workflow that belongs to a different workspace. Applying it here could overwrite another customer's setup.",
      suggestion: "Start a new build session from this workspace's Workflows page, or save this as a brand-new draft instead.",
    });
  }

  // 2. Resolve the target agent (whose prompt/config would change).
  let targetAgentName: string | null = null;
  let agentIsLive = false;
  let agentHasConfig = false;
  if (session.target_agent_id) {
    const { data: agent } = await sb.from("agents")
      .select("id, name, workspace_id, settings")
      .eq("id", session.target_agent_id).maybeSingle();
    if (agent && String(agent.workspace_id) !== String(workspaceId)) {
      conflicts.push({
        code:     "agent_workspace_mismatch",
        severity: "block",
        message:  "This build session targets an agent that belongs to a different workspace.",
        suggestion: "Open the Build Workspace from the correct agent, or remove the agent link by starting a fresh session.",
      });
    } else if (agent) {
      targetAgentName = agent.name ?? null;
      try {
        const s = typeof agent.settings === "string" ? JSON.parse(agent.settings) : (agent.settings ?? {});
        agentIsLive = !!(s.isLive || s.deployedRetellAgentId);
      } catch { agentIsLive = false; }
      const { data: cfg } = await sb.from("custom_agent_configs")
        .select("id")
        .eq("workspace_id", workspaceId).eq("agent_id", session.target_agent_id)
        .limit(1).maybeSingle();
      agentHasConfig = !!cfg;
      if (agentIsLive) {
        dependencies.push(`Agent "${targetAgentName ?? "target agent"}" is LIVE — its prompt/config changes affect real calls immediately after deploy.`);
        // Live agents are high-risk BY DEFAULT: a direct overwrite of their
        // prompt/config is never allowed without explicit human approval
        // (plus the rollback snapshot the apply path always takes first).
        conflicts.push({
          code:     "live_agent",
          severity: "needs_approval",
          message:  `The agent this build targets ("${targetAgentName ?? "target agent"}") is LIVE and taking real calls. Overwriting its prompt or configuration directly could change live call behaviour instantly.`,
          suggestion: "Save this as a new draft (recommended) or duplicate-and-edit, then test before deploying. To overwrite the live agent's configuration in place, request approval — a human must sign off first, and a rollback snapshot is always taken.",
        });
      }
      if (agentHasConfig && config.agent_prompt.trim()) dependencies.push("An existing agent configuration will be overwritten by this apply (a rollback snapshot is taken first).");
    }
  }

  const targetIsNew = !workflowRow;
  const targetWorkflowStatus = workflowRow ? String(workflowRow.status ?? "inactive") : null;
  const workflowIsActive = targetWorkflowStatus === "active";
  const targetIsLive = workflowIsActive || agentIsLive;

  // 3. Diff vs the target's current state.
  let diff: BuildDiffEntry[] = [];
  let currentState: Record<string, any> | null = null;
  if (workflowRow) {
    const flowDef = (workflowRow.flow_definition ?? {}) as Record<string, any>;
    // Pull the current agent config prompt if this session also writes one.
    let currentPrompt = String(flowDef.custom_prompt ?? "");
    let currentVars: any[] = [];
    let currentFields: any[] = [];
    let currentRules: any[] = [];
    if (session.target_agent_id) {
      const { data: cfgRow } = await sb.from("custom_agent_configs")
        .select("required_variables, extraction_fields, deployment_config")
        .eq("workspace_id", workspaceId).eq("agent_id", session.target_agent_id)
        .order("updated_at", { ascending: false }).limit(1).maybeSingle();
      if (cfgRow) {
        const dep = (cfgRow.deployment_config ?? {}) as Record<string, any>;
        if (typeof dep.agent_prompt === "string" && dep.agent_prompt.trim()) currentPrompt = dep.agent_prompt;
        currentVars   = Array.isArray(cfgRow.required_variables) ? cfgRow.required_variables : [];
        currentFields = Array.isArray(cfgRow.extraction_fields) ? cfgRow.extraction_fields : [];
        currentRules  = Array.isArray(dep.follow_up_rules) ? dep.follow_up_rules : [];
      }
    }
    currentState = {
      name:              workflowRow.name,
      trigger_type:      workflowRow.trigger_type,
      steps:             Array.isArray(flowDef.steps) ? flowDef.steps : [],
      agent_prompt:      currentPrompt,
      variables:         currentVars,
      extraction_fields: currentFields,
      follow_up_rules:   currentRules,
    };
    diff = computeBuildDiff(currentState, config);

    if (workflowIsActive) {
      dependencies.push(`Workflow "${workflowRow.name}" is ACTIVE — it is running against real triggers right now.`);
      conflicts.push({
        code:     "live_target",
        severity: "needs_approval",
        message:  `The workflow this build would overwrite ("${workflowRow.name}") is currently active and serving real triggers. Overwriting it in place could change live behaviour instantly.`,
        suggestion: "Save this as a new draft (recommended), or request approval so a human signs off before the live workflow is replaced. A rollback snapshot is always taken first.",
      });
    }

    // Removed-but-still-referenced variables: names referenced by the PROPOSED
    // config that are neither defined in the proposal nor newly introduced —
    // i.e. they only existed in the current state and the proposal dropped them.
    const proposedDefined = new Set<string>([
      ...config.variables.map((v) => v.name.trim()),
      ...config.extraction_fields.map((f) => f.name.trim()),
    ]);
    const currentDefined = new Set<string>([
      ...currentVars.map((v: any) => String(v?.name ?? "").trim()),
      ...currentFields.map((f: any) => String(f?.name ?? "").trim()),
    ].filter(Boolean));
    const referenced = extractVariableReferences(config);
    const broken = [...referenced].filter((r) => !proposedDefined.has(r) && currentDefined.has(r));
    if (broken.length > 0) {
      conflicts.push({
        code:     "referenced_variable_removed",
        severity: "block",
        message:  `This version still references ${broken.length === 1 ? "a variable" : "variables"} (${broken.map((b) => `"${b}"`).join(", ")}) that it removes from the setup. Applying it would leave the workflow pointing at data that no longer exists.`,
        suggestion: "Ask SystemMind to either keep the variable(s) or update every step and prompt that mentions them, then apply the corrected version.",
      });
    }

    // Webhook / endpoint changes on an existing target need human eyes.
    const currentUrls  = extractUrls(flowDef);
    const proposedUrls = new Set<string>([...extractUrls(config.workflow.steps), ...extractUrls(config.channel_setup)]);
    const addedUrls    = [...proposedUrls].filter((u) => !currentUrls.has(u));
    const removedUrls  = [...currentUrls].filter((u) => !proposedUrls.has(u));
    if (addedUrls.length > 0 || removedUrls.length > 0) {
      conflicts.push({
        code:     "webhook_change",
        severity: "needs_approval",
        message:  `This version changes where the workflow sends or receives data (${[...addedUrls.map((u) => `adds ${u}`), ...removedUrls.map((u) => `removes ${u}`)].join("; ").slice(0, 400)}). Endpoint changes on an existing workflow can silently reroute live traffic.`,
        suggestion: "Request approval so the endpoint change is reviewed before it replaces the current setup, or save as a new draft to test it first.",
      });
    }
  }

  // 4. Duplicate triggers: another ACTIVE workflow in this workspace already
  // fires on the same (non-manual) trigger.
  if (config.workflow.trigger_type !== "manual") {
    const { data: sameTrigger } = await sb.from("workspace_workflows")
      .select("id, name, status")
      .eq("workspace_id", workspaceId)
      .eq("trigger_type", config.workflow.trigger_type)
      .eq("status", "active")
      .limit(10);
    const clashes = ((sameTrigger ?? []) as any[]).filter((w) => w.id !== workflowRow?.id);
    if (clashes.length > 0) {
      dependencies.push(`${clashes.length} other active workflow(s) already fire on "${config.workflow.trigger_type}": ${clashes.map((w) => `"${w.name}"`).join(", ")}.`);
      // Duplicate triggers hard-block any apply whose RESULT would be an
      // active duplicate (overwriting a currently-active workflow in place).
      // For inactive/new targets the draft itself is harmless — it only
      // double-fires once activated — so it blocks Go Live instead (drafts
      // stay friction-free per the safe-by-default contract).
      conflicts.push({
        code:     "duplicate_trigger",
        severity: workflowIsActive ? "block" : "block_go_live",
        message:  `Another active workflow (${clashes.map((w) => `"${w.name}"`).join(", ")}) already runs on the "${config.workflow.trigger_type}" trigger. ${workflowIsActive ? "The workflow this apply would overwrite is active too, so BOTH would fire on the same event" : "Activating this one too means BOTH will fire on the same event"} — customers could get duplicate calls or messages.`,
        suggestion: workflowIsActive
          ? "Deactivate one of the workflows first, change this version's trigger, or save it as a new inactive draft instead."
          : "You can still save this as an inactive draft. Before going live, deactivate the other workflow or change this version's trigger.",
      });
    }
  }

  // 5. Missing provider setup blocks Go Live (not the draft apply itself).
  const stepTypes = new Set(config.workflow.steps.map((s: any) => String(s.type)));
  if (stepTypes.has("send_whatsapp")) {
    const [{ data: ws }, { data: wati }] = await Promise.all([
      sb.from("workspace_settings")
        .select("twilio_account_sid, twilio_auth_token, whatsapp_phone_id, meta_phone_number_id, meta_access_token")
        .eq("workspace_id", workspaceId).maybeSingle(),
      sb.from("wati_connections").select("status").eq("workspace_id", workspaceId).maybeSingle(),
    ]);
    const twilioOk = !!(ws?.twilio_account_sid?.trim() && ws?.twilio_auth_token?.trim() && ws?.whatsapp_phone_id?.trim());
    const metaOk   = !!(ws?.meta_phone_number_id?.trim() && ws?.meta_access_token?.trim());
    const watiOk   = wati?.status === "connected";
    if (!twilioOk && !metaOk && !watiOk) {
      conflicts.push({
        code:     "missing_whatsapp_provider",
        severity: "block_go_live",
        message:  "This build sends WhatsApp messages, but no WhatsApp provider (Twilio, Meta or WATI) is connected in this workspace yet.",
        suggestion: "You can still save it as a draft — connect a WhatsApp provider in WhatsApp Settings before going live.",
      });
    }
  }
  if (config.required_credentials.length > 0) {
    dependencies.push(`Credentials required before this can run: ${config.required_credentials.join(", ")} (enter them in WEBEE settings — never in the builder).`);
  }

  const hasBlock         = conflicts.some((c) => c.severity === "block");
  const hasApprovalGate  = conflicts.some((c) => c.severity === "needs_approval");
  const hasGoLiveBlock   = conflicts.some((c) => c.severity === "block_go_live");
  const requiresApproval = args.riskLevel === "high" || hasApprovalGate;

  return {
    checkedAt:            new Date().toISOString(),
    targetWorkflowId:     workflowRow?.id ?? workflowIdRequested,
    targetWorkflowName:   workflowRow?.name ?? null,
    targetWorkflowStatus,
    targetIsNew,
    targetAgentId:        session.target_agent_id ?? null,
    targetAgentName,
    agentIsLive,
    agentHasConfig,
    targetIsLive,
    dependencies,
    diff,
    conflicts,
    requiresApproval,
    canApplyDirectly:     !hasBlock && !requiresApproval,
    canGoLive:            !hasBlock && !requiresApproval && !hasGoLiveBlock,
    rollbackAvailable:    !targetIsNew || agentHasConfig,
  };
}

// ── Rollback snapshots ──────────────────────────────────────────────────────────

// Whitelisted, descriptive-only view of agent settings — NEVER raw settings
// (they can contain provider identifiers we don't want duplicated around).
function describeAgentSettings(settings: unknown): Record<string, unknown> {
  let s: Record<string, any> = {};
  try { s = typeof settings === "string" ? JSON.parse(settings) : ((settings as any) ?? {}); } catch { s = {}; }
  return {
    is_live:            !!s.isLive,
    has_deployed_agent: !!(s.deployedRetellAgentId || s.retellAgentId),
    voice_provider:     typeof s.voiceProvider === "string" ? s.voiceProvider : null,
  };
}

export async function createBuildSnapshotServer(args: {
  workspaceId:      string;
  userId:           string | null;
  sessionId:        string | null;
  versionId:        string | null;
  versionNumber:    number | null;
  targetWorkflowId: string | null;
  targetAgentId:    string | null;
  reason?:          "pre_apply" | "pre_go_live" | "manual";
}): Promise<{ snapshotId: string } | null> {
  const sb = supabaseAdmin as Sb;
  const { workspaceId } = args;

  let workflowState: Record<string, any> | null = null;
  if (args.targetWorkflowId) {
    const { data } = await sb.from("workspace_workflows")
      .select("*").eq("id", args.targetWorkflowId).eq("workspace_id", workspaceId).maybeSingle();
    if (data) workflowState = data;
  }

  let agentConfigState: Record<string, any> | null = null;
  let agentSettingsState: Record<string, unknown> | null = null;
  if (args.targetAgentId) {
    const [{ data: cfg }, { data: agent }] = await Promise.all([
      sb.from("custom_agent_configs")
        .select("*")
        .eq("workspace_id", workspaceId).eq("agent_id", args.targetAgentId)
        .order("updated_at", { ascending: false }).limit(1).maybeSingle(),
      sb.from("agents").select("settings").eq("id", args.targetAgentId).eq("workspace_id", workspaceId).maybeSingle(),
    ]);
    if (cfg) agentConfigState = cfg;
    if (agent) agentSettingsState = describeAgentSettings(agent.settings);
  }

  // Nothing existing to protect — no snapshot needed.
  if (!workflowState && !agentConfigState) return null;

  const { data, error } = await sb.from("systemmind_build_snapshots").insert({
    workspace_id:         workspaceId,
    created_by_user_id:   args.userId,
    session_id:           args.sessionId,
    version_id:           args.versionId,
    version_number:       args.versionNumber,
    target_workflow_id:   args.targetWorkflowId,
    target_agent_id:      args.targetAgentId,
    reason:               args.reason ?? "pre_apply",
    workflow_state:       workflowState,
    agent_config_state:   agentConfigState,
    agent_settings_state: agentSettingsState,
  }).select("id").single();
  if (error) throw new Error(`Could not take a rollback snapshot — the apply was stopped to stay safe: ${error.message}`);

  return { snapshotId: data.id as string };
}

export async function listBuildSnapshotsServer(
  workspaceId: string,
  sessionId: string,
): Promise<any[]> {
  const sb = supabaseAdmin as Sb;
  const { data } = await sb.from("systemmind_build_snapshots")
    .select("id, session_id, version_id, version_number, target_workflow_id, target_agent_id, reason, restored_at, created_at")
    .eq("workspace_id", workspaceId).eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(50);
  return (data ?? []) as any[];
}

// Fields we restore on workspace_workflows — everything the apply path writes.
const WORKFLOW_RESTORE_FIELDS = [
  "name", "description", "trigger_type", "trigger_config", "flow_definition",
  "status", "source", "source_build_session_id", "source_build_version",
] as const;

const AGENT_CONFIG_RESTORE_FIELDS = [
  "title", "agent_summary", "required_variables", "extraction_fields",
  "deployment_config", "status",
] as const;

export async function rollbackBuildSnapshotServer(args: {
  workspaceId: string;
  userId:      string | null;
  snapshotId:  string;
}): Promise<{ restoredWorkflowId: string | null; restoredAgentConfigId: string | null }> {
  const sb = supabaseAdmin as Sb;
  const { workspaceId, userId, snapshotId } = args;

  const { data: snap, error } = await sb.from("systemmind_build_snapshots")
    .select("*").eq("id", snapshotId).eq("workspace_id", workspaceId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!snap) throw new Error("Rollback snapshot not found in this workspace.");

  const now = new Date().toISOString();
  let restoredWorkflowId: string | null = null;
  let restoredAgentConfigId: string | null = null;

  // 1. Restore the workflow row.
  if (snap.workflow_state && snap.target_workflow_id) {
    const state = snap.workflow_state as Record<string, any>;
    if (String(state.workspace_id ?? workspaceId) !== String(workspaceId)) {
      throw new Error("Snapshot workflow state belongs to a different workspace — rollback refused.");
    }
    const patch: Record<string, any> = { updated_at: now };
    for (const f of WORKFLOW_RESTORE_FIELDS) if (f in state) patch[f] = state[f];

    const { data: existing } = await sb.from("workspace_workflows")
      .select("id").eq("id", snap.target_workflow_id).eq("workspace_id", workspaceId).maybeSingle();
    if (existing) {
      const { error: upErr } = await sb.from("workspace_workflows").update(patch)
        .eq("id", snap.target_workflow_id).eq("workspace_id", workspaceId);
      if (upErr) throw new Error(`Rollback failed while restoring the workflow: ${upErr.message}`);
    } else {
      // Row was deleted since the snapshot — recreate it with the same id.
      const { error: insErr } = await sb.from("workspace_workflows").insert({
        id: snap.target_workflow_id, workspace_id: workspaceId,
        template_id: state.template_id ?? null,
        ...Object.fromEntries(WORKFLOW_RESTORE_FIELDS.map((f) => [f, state[f]])),
      });
      if (insErr) throw new Error(`Rollback failed while recreating the workflow: ${insErr.message}`);
    }
    restoredWorkflowId = snap.target_workflow_id as string;
  }

  // 2. Restore the agent config row (custom_agent_configs ONLY — never agents.settings).
  if (snap.agent_config_state) {
    const state = snap.agent_config_state as Record<string, any>;
    if (String(state.workspace_id ?? workspaceId) !== String(workspaceId)) {
      throw new Error("Snapshot agent config belongs to a different workspace — rollback refused.");
    }
    const patch: Record<string, any> = { updated_at: now };
    for (const f of AGENT_CONFIG_RESTORE_FIELDS) if (f in state) patch[f] = state[f];

    const { data: existingCfg } = await sb.from("custom_agent_configs")
      .select("id").eq("id", state.id).eq("workspace_id", workspaceId).maybeSingle();
    if (existingCfg) {
      const { error: upErr } = await sb.from("custom_agent_configs").update(patch)
        .eq("id", state.id).eq("workspace_id", workspaceId);
      if (upErr) throw new Error(`Rollback failed while restoring the agent config: ${upErr.message}`);
      restoredAgentConfigId = String(state.id);
    } else if (state.agent_id) {
      const { error: insErr } = await sb.from("custom_agent_configs").insert({
        workspace_id: workspaceId,
        agent_id:     state.agent_id,
        ...Object.fromEntries(AGENT_CONFIG_RESTORE_FIELDS.map((f) => [f, state[f]])),
      });
      if (insErr) throw new Error(`Rollback failed while recreating the agent config: ${insErr.message}`);
      restoredAgentConfigId = "recreated";
    }
  }

  // 3. Bookkeeping.
  const { error: markErr } = await sb.from("systemmind_build_snapshots")
    .update({ restored_at: now, restored_by_user_id: userId })
    .eq("id", snapshotId).eq("workspace_id", workspaceId);
  if (markErr) console.error("[build-protection] snapshot restore bookkeeping failed:", markErr.message);

  await writeSystemMindAudit({
    workspaceId, userId,
    actionType: "build_apply_rolled_back",
    targetType: "systemmind_build_snapshot",
    targetId:   snapshotId,
    beforeState: { snapshot_created_at: snap.created_at, version_number: snap.version_number },
    finalAfterState: {
      restored_workflow_id:     restoredWorkflowId,
      restored_agent_config_id: restoredAgentConfigId,
    },
    executedAt: now,
  });

  return { restoredWorkflowId, restoredAgentConfigId };
}
