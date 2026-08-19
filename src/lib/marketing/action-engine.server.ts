// Marketing Action Engine — server-only core.
//
// Lifecycle: discovered → recommended → awaiting_approval → approved →
// executing → executed → verified → measuring → success | failed | rolled_back.
//
// Principles:
// • confirm-then-verify: an action only reaches "executed" when the platform
//   API confirmed the write, and "verified" only after an independent
//   read-back shows the new state. No silent assumptions.
// • fail closed: unknown autonomy level ⇒ observe; guardrail read failure ⇒
//   no automation; missing executor ⇒ honest failure, never a fake success.
// • high-risk action types ALWAYS require explicit human approval.
//
// All writes go through supabaseAdmin — marketing_actions has REVOKEd
// authenticated writes; members only read via RLS.

import {
  MARKETING_ACTION_TRANSITIONS,
  HIGH_RISK_MARKETING_ACTION_TYPES,
  UNDOABLE_MARKETING_STATUSES,
  DEFAULT_MARKETING_GUARDRAILS,
  normalizeGuardrails,
  type MarketingActionRecord,
  type MarketingActionStatus,
  type MarketingAutonomyLevel,
  type MarketingGuardrails,
  type MarketingRiskLevel,
} from "./action-engine.shared";

// ── Executor registry (pluggable) ────────────────────────────────────────────
export interface MarketingExecuteResult {
  /** True ONLY when the platform API confirmed the change. */
  confirmed: boolean;
  apiResponse?: any;
  externalResourceId?: string | null;
  /** Payload sufficient to build a compensating (undo) action later. */
  rollbackPayload?: any;
  error?: string;
}
export interface MarketingVerifyResult {
  verified: boolean;
  observedState?: any;
  note?: string;
}
export interface MarketingExecutor {
  platform: string;
  /**
   * Explicit allowlist of action types this executor may run WITHOUT human
   * approval (autopilot). Anything not listed — including unknown action
   * types — always routes to approval. Fail closed by default: omit or leave
   * empty to require approval for everything.
   */
  autoExecutableActionTypes?: string[];
  /** Perform the change against the real platform API. */
  execute(action: MarketingActionRecord): Promise<MarketingExecuteResult>;
  /** Independent read-back proving the change took effect. */
  verify(action: MarketingActionRecord): Promise<MarketingVerifyResult>;
  /**
   * Build the input for a compensating action from a completed action.
   * Return null when the action cannot be undone.
   */
  buildRollback?(action: MarketingActionRecord): CreateMarketingActionInput | null;
}

const EXECUTORS = new Map<string, MarketingExecutor>();

// Lazily load executor modules (they self-register on import) so any engine
// entry point finds them regardless of which module was loaded first.
let executorsLoaded = false;
export async function ensureMarketingExecutorsLoaded(): Promise<void> {
  if (executorsLoaded) return;
  executorsLoaded = true;
  try {
    await import("./executors/google-ads.executor.server");
    await import("./executors/seo.executor.server");
    await import("./executors/website.executor.server");
  } catch (e: any) {
    executorsLoaded = false; // allow retry on next call
    console.error("[marketing-engine] executor module load failed:", e?.message);
  }
}

export function registerMarketingExecutor(executor: MarketingExecutor) {
  EXECUTORS.set(executor.platform, executor);
}
export function getMarketingExecutor(platform: string): MarketingExecutor | null {
  return EXECUTORS.get(platform) ?? null;
}

// ── Autonomy + guardrails (fail closed) ──────────────────────────────────────
export interface MarketingAutonomyConfig {
  level: MarketingAutonomyLevel;
  guardrails: MarketingGuardrails;
}

export async function getMarketingAutonomyConfig(sbAdmin: any, workspaceId: string): Promise<MarketingAutonomyConfig> {
  try {
    const { data, error } = await sbAdmin.from("workspace_settings")
      .select("marketing_autonomy_level, marketing_guardrails")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (error) throw error;
    const raw = String(data?.marketing_autonomy_level ?? "recommend");
    const level: MarketingAutonomyLevel =
      raw === "observe" || raw === "recommend" || raw === "approval" || raw === "autopilot" ? raw : "observe";
    return { level, guardrails: normalizeGuardrails(data?.marketing_guardrails) };
  } catch {
    // Fail closed: unreadable settings mean no automation at all.
    return { level: "observe", guardrails: { ...DEFAULT_MARKETING_GUARDRAILS, max_auto_actions_per_day: 0 } };
  }
}

function targetStrings(action: Pick<MarketingActionRecord, "target">): string[] {
  const out: string[] = [];
  const t = action.target ?? {};
  for (const v of Object.values(t)) {
    if (typeof v === "string") out.push(v.toLowerCase());
    if (typeof v === "number") out.push(String(v));
  }
  return out;
}

/** Protected-target check — applies to ALL executions, even human-approved ones. */
export function protectedTargetBlockReason(
  action: Pick<MarketingActionRecord, "target">,
  guardrails: MarketingGuardrails,
): string | null {
  const targets = targetStrings(action as any);
  const hit = (list: string[]) => list.find((p) => targets.some((t) => t.includes(p.toLowerCase())));
  const pc = hit(guardrails.protected_campaigns);
  if (pc) return `Target matches protected campaign "${pc}".`;
  const pk = hit(guardrails.protected_keywords);
  if (pk) return `Target matches protected keyword "${pk}".`;
  const pp = hit(guardrails.protected_pages);
  if (pp) return `Target matches protected page "${pp}".`;
  return null;
}

/** Guardrail check for AUTOMATED execution. Returns null when allowed, else a human-readable reason. */
export function guardrailBlockReason(
  action: Pick<MarketingActionRecord, "action_type" | "risk_level" | "target" | "existing_value" | "proposed_value" | "platform">,
  guardrails: MarketingGuardrails,
): string | null {
  if (HIGH_RISK_MARKETING_ACTION_TYPES.has(action.action_type) || action.risk_level !== "low") {
    return "Only explicitly low-risk actions may run automatically; everything else requires approval.";
  }
  // Unknown or non-allowlisted action types NEVER auto-execute (fail closed).
  const executor = getMarketingExecutor((action as any).platform ?? "");
  if (!executor || !(executor.autoExecutableActionTypes ?? []).includes(action.action_type)) {
    return "This action type is not allowlisted for automatic execution.";
  }
  const targets = targetStrings(action as any);
  const hit = (list: string[]) => list.find((p) => targets.some((t) => t.includes(p.toLowerCase())));
  const pc = hit(guardrails.protected_campaigns);
  if (pc) return `Target matches protected campaign "${pc}".`;
  const pk = hit(guardrails.protected_keywords);
  if (pk) return `Target matches protected keyword "${pk}".`;
  const pp = hit(guardrails.protected_pages);
  if (pp) return `Target matches protected page "${pp}".`;

  // Per-action budget ceiling: applies whenever a proposed numeric budget is
  // present, even for new campaigns or zero/unknown existing budgets.
  const oldB = numericBudget(action.existing_value);
  const newB = numericBudget(action.proposed_value);
  if (newB != null && guardrails.max_daily_ad_spend != null && newB > guardrails.max_daily_ad_spend) {
    return `Proposed daily budget exceeds the £${guardrails.max_daily_ad_spend} per-action budget cap.`;
  }
  // Percentage-delta caps need a meaningful existing budget to compare against.
  if (oldB != null && newB != null && oldB > 0) {
    const deltaPct = ((newB - oldB) / oldB) * 100;
    if (deltaPct > guardrails.max_auto_budget_increase_pct) {
      return `Budget increase ${deltaPct.toFixed(0)}% exceeds the ${guardrails.max_auto_budget_increase_pct}% auto limit.`;
    }
    if (-deltaPct > guardrails.max_auto_budget_decrease_pct) {
      return `Budget decrease ${(-deltaPct).toFixed(0)}% exceeds the ${guardrails.max_auto_budget_decrease_pct}% auto limit.`;
    }
    if (guardrails.max_daily_ad_spend != null && newB > guardrails.max_daily_ad_spend) {
      return `Proposed daily budget exceeds the £${guardrails.max_daily_ad_spend} daily spend cap.`;
    }
  }
  return null;
}

function numericBudget(v: any): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v && typeof v === "object") {
    for (const k of ["daily_budget", "budget", "amount", "value"]) {
      if (typeof v[k] === "number" && Number.isFinite(v[k])) return v[k];
    }
  }
  return null;
}

/**
 * Automated attempts claimed today — every autopilot reservation counts,
 * regardless of later status (failed/rolled_back rows were still real
 * external-write attempts), keyed on the immutable auto_claimed_at timestamp.
 */
async function autoActionsInFlightToday(sbAdmin: any, workspaceId: string): Promise<number> {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const { count, error } = await sbAdmin.from("marketing_actions")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .gte("auto_claimed_at", dayStart.toISOString());
  if (error) throw error;
  return count ?? 0;
}

// ── CRUD + transitions ───────────────────────────────────────────────────────
export interface CreateMarketingActionInput {
  source: string;
  requested_by?: string | null;
  objective?: string | null;
  platform: string;
  action_type: string;
  target: Record<string, any>;
  existing_value?: any;
  proposed_value?: any;
  expected_impact?: string | null;
  confidence?: number | null;
  risk_level?: MarketingRiskLevel;
  evidence?: Record<string, any>;
  rollback_of?: string | null;
  status?: "discovered" | "recommended";
}

export async function createMarketingAction(
  sbAdmin: any, workspaceId: string, input: CreateMarketingActionInput,
): Promise<MarketingActionRecord> {
  const risk: MarketingRiskLevel =
    HIGH_RISK_MARKETING_ACTION_TYPES.has(input.action_type) ? "high" : (input.risk_level ?? "medium");
  const status = input.status ?? "recommended";
  const { data, error } = await sbAdmin.from("marketing_actions").insert({
    workspace_id: workspaceId,
    source: input.source,
    requested_by: input.requested_by ?? null,
    objective: input.objective ?? null,
    platform: input.platform,
    action_type: input.action_type,
    target: input.target ?? {},
    existing_value: input.existing_value ?? null,
    proposed_value: input.proposed_value ?? null,
    expected_impact: input.expected_impact ?? null,
    confidence: input.confidence ?? null,
    risk_level: risk,
    evidence: input.evidence ?? {},
    rollback_of: input.rollback_of ?? null,
    status,
    status_history: [{ from: null, to: status, at: new Date().toISOString() }],
  }).select("*").single();
  if (error) throw error;
  return data as MarketingActionRecord;
}

/**
 * Compare-and-set transition. Fails loudly on illegal transitions and returns
 * false when the row was concurrently moved (CAS lost) — callers must treat
 * false as "someone else owns this action now".
 */
export async function transitionMarketingAction(
  sbAdmin: any, actionId: string, from: MarketingActionStatus, to: MarketingActionStatus,
  patch: Record<string, any> = {}, note?: string,
): Promise<boolean> {
  if (!MARKETING_ACTION_TRANSITIONS[from]?.includes(to)) {
    throw new Error(`Illegal marketing action transition ${from} → ${to}`);
  }
  const { data: row } = await sbAdmin.from("marketing_actions")
    .select("status_history").eq("id", actionId).maybeSingle();
  const history = Array.isArray(row?.status_history) ? row.status_history : [];
  const { data, error } = await sbAdmin.from("marketing_actions")
    .update({
      ...patch,
      status: to,
      status_history: [...history, { from, to, at: new Date().toISOString(), ...(note ? { note } : {}) }],
      updated_at: new Date().toISOString(),
    })
    .eq("id", actionId)
    .eq("status", from)
    .select("id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

// ── Routing: submit an action for execution ─────────────────────────────────
export interface SubmitResult {
  outcome: "not_allowed" | "awaiting_approval" | "executed" | "executed_unverified" | "failed";
  detail: string;
  approvalActionId?: string;
}

/**
 * Route a recommended action according to autonomy level + guardrails.
 * observe/recommend ⇒ refuse; approval ⇒ queue a HiveMind approval;
 * autopilot ⇒ run directly IF low-risk and within guardrails, else queue approval.
 */
export async function submitMarketingActionForExecution(
  sbAdmin: any, workspaceId: string, actionId: string,
): Promise<SubmitResult> {
  await ensureMarketingExecutorsLoaded();
  const action = await loadAction(sbAdmin, workspaceId, actionId);
  if (action.status !== "recommended" && action.status !== "discovered") {
    return { outcome: "not_allowed", detail: `Action is ${action.status}, not submittable.` };
  }
  if (action.status === "discovered") {
    const ok = await transitionMarketingAction(sbAdmin, action.id, "discovered", "recommended");
    if (!ok) return { outcome: "not_allowed", detail: "Action changed concurrently." };
    action.status = "recommended";
  }

  const cfg = await getMarketingAutonomyConfig(sbAdmin, workspaceId);
  if (cfg.level === "observe" || cfg.level === "recommend") {
    return { outcome: "not_allowed", detail: `Marketing autonomy is set to "${cfg.level}" — execution is disabled.` };
  }

  const blockReason = guardrailBlockReason(action, cfg.guardrails);
  if (cfg.level === "autopilot" && blockReason == null) {
    // Claim first (reservation), THEN count including our own claim — so
    // concurrent submissions cannot all see remaining capacity.
    const ok = await transitionMarketingAction(sbAdmin, action.id, "recommended", "approved",
      { approval_required: false, auto_claimed_at: new Date().toISOString() }, "Autopilot: within guardrails");
    if (!ok) return { outcome: "not_allowed", detail: "Action changed concurrently." };
    let reservedToday: number;
    try { reservedToday = await autoActionsInFlightToday(sbAdmin, workspaceId); }
    catch { reservedToday = Number.POSITIVE_INFINITY; } // fail closed
    if (reservedToday > cfg.guardrails.max_auto_actions_per_day) {
      return await queueApproval(sbAdmin, workspaceId, action, `Daily automated-action cap (${cfg.guardrails.max_auto_actions_per_day}) reached.`, "approved");
    }
    const run = await runMarketingAction(sbAdmin, workspaceId, action.id);
    return run;
  }

  return await queueApproval(sbAdmin, workspaceId, action, blockReason ?? undefined, "recommended");
}

async function queueApproval(
  sbAdmin: any, workspaceId: string, action: MarketingActionRecord, reason: string | undefined,
  fromStatus: "recommended" | "approved",
): Promise<SubmitResult> {
  // CAS to awaiting_approval FIRST — a lost CAS must never leave a live,
  // orphaned approval row that could later execute the action.
  const ok = await transitionMarketingAction(sbAdmin, action.id, fromStatus, "awaiting_approval",
    { approval_required: true }, reason);
  if (!ok) return { outcome: "not_allowed", detail: "Action changed concurrently." };

  const title = `Marketing action: ${action.action_type} (${action.platform})`;
  const descParts = [
    action.expected_impact ? `Expected impact: ${action.expected_impact}` : null,
    reason ? `Requires approval: ${reason}` : null,
  ].filter(Boolean);
  const { data, error } = await sbAdmin.from("hivemind_actions").insert({
    workspace_id: workspaceId,
    title,
    description: descParts.join(" · ") || `Approve to run this ${action.platform} change.`,
    action_type: "marketing_action_execute",
    action_payload: { marketing_action_id: action.id },
    proposed_by: "hivemind",
    status: "pending",
    sensitive: true, // marketing writes always take the sensitive approval path
  }).select("id").single();
  if (error) {
    // Honest terminal state instead of a stuck awaiting_approval row.
    const msg = `Could not create approval: ${error.message ?? "insert failed"}`;
    await transitionMarketingAction(sbAdmin, action.id, "awaiting_approval", "failed", { error_message: msg });
    await syncLinkedChangeRequests(sbAdmin, workspaceId, action.id, "failed", msg);
    throw error;
  }
  // Bind the approval row to the action — execution verifies this linkage.
  // A failed bind would leave an orphaned pending approval that can never
  // execute, so compensate: cancel the approval row and fail the action.
  const { data: bindRows, error: bindError } = await sbAdmin.from("marketing_actions")
    .update({ approval_action_id: data.id, updated_at: new Date().toISOString() })
    .eq("id", action.id).eq("status", "awaiting_approval")
    .select("id");
  if (bindError || !bindRows?.length) {
    const msg = `Could not link approval to action: ${bindError?.message ?? "action left awaiting_approval unexpectedly"}`;
    try {
      await sbAdmin.from("hivemind_actions")
        .update({ status: "cancelled", updated_at: new Date().toISOString() })
        .eq("id", data.id).eq("status", "pending");
    } catch { /* best-effort compensation */ }
    await transitionMarketingAction(sbAdmin, action.id, "awaiting_approval", "failed", { error_message: msg });
    await syncLinkedChangeRequests(sbAdmin, workspaceId, action.id, "failed", msg);
    return { outcome: "failed", detail: msg };
  }
  return { outcome: "awaiting_approval", detail: reason ?? "Queued for approval.", approvalActionId: String(data.id) };
}

// ── Execution (confirm-then-verify) ──────────────────────────────────────────
export async function runMarketingAction(
  sbAdmin: any, workspaceId: string, actionId: string,
): Promise<SubmitResult> {
  await ensureMarketingExecutorsLoaded();
  const action = await loadAction(sbAdmin, workspaceId, actionId);
  if (action.status !== "approved") {
    return { outcome: "not_allowed", detail: `Action is ${action.status}, not approved.` };
  }

  // Re-read governance immediately before the external write (TOCTOU).
  const cfg = await getMarketingAutonomyConfig(sbAdmin, workspaceId);
  // If execution has been disabled since approval, refuse — even for
  // human-approved actions. Stale approvals must not fire.
  // Every transition to "failed" must also sync linked change requests —
  // an approved action that fails pre-execution must never leave its
  // originating change request stuck at "submitted".
  const failAndSync = async (fromStatus: string, msg: string): Promise<SubmitResult> => {
    await transitionMarketingAction(sbAdmin, action.id, fromStatus, "failed", { error_message: msg });
    await syncLinkedChangeRequests(sbAdmin, workspaceId, action.id, "failed", msg);
    return { outcome: "failed", detail: msg };
  };
  if (cfg.level === "observe" || cfg.level === "recommend") {
    return await failAndSync("approved", `Marketing autonomy is now "${cfg.level}" — execution disabled; approval is stale.`);
  }
  // Protected targets always block, including explicitly approved actions —
  // tightening the protected lists must take effect immediately.
  const protectedBlock = protectedTargetBlockReason(action, cfg.guardrails);
  if (protectedBlock) return await failAndSync("approved", protectedBlock);
  if (action.approval_required === false) {
    // Automated runs re-check the FULL auto guardrails; explicitly approved
    // actions may exceed auto-only limits by design (human decision).
    if (cfg.level !== "autopilot") {
      return await failAndSync("approved", "Autonomy level changed before execution.");
    }
    const block = guardrailBlockReason(action, cfg.guardrails);
    if (block) return await failAndSync("approved", block);
  }

  const claimed = await transitionMarketingAction(sbAdmin, action.id, "approved", "executing",
    { execution_attempts: (action.execution_attempts ?? 0) + 1 });
  if (!claimed) return { outcome: "not_allowed", detail: "Action is already being executed." };

  const executor = getMarketingExecutor(action.platform);
  if (!executor) {
    return await failAndSync("executing", `No executor registered for platform "${action.platform}" — external write not performed.`);
  }

  // Execute — "executed" only on API-confirmed writes.
  let exec: MarketingExecuteResult;
  try { exec = await executor.execute(action); }
  catch (e: any) { exec = { confirmed: false, error: e?.message || "Executor threw." }; }
  if (!exec.confirmed) {
    const msg = exec.error || "Platform API did not confirm the change.";
    await transitionMarketingAction(sbAdmin, action.id, "executing", "failed",
      { error_message: msg, api_response: exec.apiResponse ?? null });
    await syncLinkedChangeRequests(sbAdmin, workspaceId, action.id, "failed", msg);
    return { outcome: "failed", detail: msg };
  }
  await transitionMarketingAction(sbAdmin, action.id, "executing", "executed", {
    api_response: exec.apiResponse ?? null,
    external_resource_id: exec.externalResourceId ?? null,
    rollback_payload: exec.rollbackPayload ?? null,
    executed_at: new Date().toISOString(),
    verification_status: "pending",
  });

  // Verify — independent read-back. Reload so the verifier sees the confirmed
  // execution fields (external_resource_id, api_response, rollback_payload) —
  // create-style executors need the returned resource ID to read back.
  const executedAction = await loadAction(sbAdmin, workspaceId, action.id);
  let verify: MarketingVerifyResult;
  try { verify = await executor.verify(executedAction); }
  catch (e: any) { verify = { verified: false, note: e?.message || "Verifier threw." }; }
  if (!verify.verified) {
    // The external write WAS confirmed — this is a real applied change that
    // just failed read-back. Keep it in the undoable "executed" state
    // (verification_status=failed) rather than a terminal failure, so the
    // compensating-action path stays available.
    const msg = `Change executed but verification failed: ${verify.note ?? "state read-back did not match."}`;
    await sbAdmin.from("marketing_actions").update({
      verification_status: "failed",
      verification_evidence: verify.observedState ?? null,
      error_message: msg,
      updated_at: new Date().toISOString(),
    }).eq("id", action.id).eq("status", "executed").select("id");
    // The external write DID happen — linked change requests must say so.
    await syncLinkedChangeRequests(sbAdmin, workspaceId, action.id, "executed", msg);
    return { outcome: "executed_unverified", detail: msg };
  }
  await transitionMarketingAction(sbAdmin, action.id, "executed", "verified", {
    verification_status: "verified",
    verification_evidence: verify.observedState ?? null,
    verified_at: new Date().toISOString(),
  });

  // If this action was a compensating (undo) action, close out the original.
  if (action.rollback_of) {
    try {
      const original = await loadAction(sbAdmin, workspaceId, action.rollback_of);
      if (UNDOABLE_MARKETING_STATUSES.includes(original.status)) {
        await transitionMarketingAction(sbAdmin, original.id, original.status, "rolled_back",
          {}, `Undone by compensating action ${action.id}`);
      }
    } catch { /* best-effort linkage; the undo itself succeeded */ }
  }

  await syncLinkedChangeRequests(sbAdmin, workspaceId, action.id, "executed", "Change executed and verified.");
  return { outcome: "executed", detail: "Change executed and verified." };
}

/**
 * Keep records that link to a marketing action (via marketing_action_id)
 * in sync with the action's real terminal outcome, so an approved-then-run
 * action never leaves its originating change request stale. Best-effort but
 * logged loudly on failure. Exported for tests.
 */
export async function syncLinkedChangeRequests(
  sbAdmin: any, workspaceId: string, marketingActionId: string,
  status: "executed" | "failed", detail: string,
): Promise<void> {
  try {
    const { error } = await sbAdmin.from("growthmind_gads_change_requests").update({
      status,
      status_detail: detail,
      ...(status === "executed" ? { executed_at: new Date().toISOString() } : {}),
    }).eq("workspace_id", workspaceId).eq("marketing_action_id", marketingActionId);
    if (error) throw error;
  } catch (e: any) {
    console.error("[marketing-engine] linked change-request sync failed:", e?.message);
  }
}

// ── Undo (compensating action) ───────────────────────────────────────────────
export async function requestMarketingActionUndo(
  sbAdmin: any, workspaceId: string, actionId: string, requestedBy: string | null,
): Promise<SubmitResult & { undoActionId?: string }> {
  await ensureMarketingExecutorsLoaded();
  const action = await loadAction(sbAdmin, workspaceId, actionId);
  if (!UNDOABLE_MARKETING_STATUSES.includes(action.status)) {
    return { outcome: "not_allowed", detail: `Only executed/verified/measuring/successful actions can be undone (this one is ${action.status}).` };
  }
  const executor = getMarketingExecutor(action.platform);
  const rollbackInput =
    executor?.buildRollback?.(action) ??
    (action.rollback_payload != null
      ? {
          source: "undo",
          platform: action.platform,
          action_type: action.action_type,
          target: action.target,
          existing_value: action.proposed_value,
          proposed_value: action.rollback_payload,
          expected_impact: `Undo of action ${action.id}`,
          risk_level: action.risk_level,
        } satisfies CreateMarketingActionInput
      : null);
  if (!rollbackInput) {
    return { outcome: "not_allowed", detail: "This action has no rollback information and cannot be undone automatically." };
  }
  let undoAction: MarketingActionRecord;
  try {
    undoAction = await createMarketingAction(sbAdmin, workspaceId, {
      ...rollbackInput,
      requested_by: requestedBy,
      rollback_of: action.id,
      status: "recommended",
    });
  } catch (e: any) {
    if (e?.code === "23505") {
      return { outcome: "not_allowed", detail: "An undo for this action is already in progress." };
    }
    throw e;
  }
  const routed = await submitMarketingActionForExecution(sbAdmin, workspaceId, undoAction.id);
  return { ...routed, undoActionId: undoAction.id };
}

// ── Approval bridge (called from hivemind executeAction) ────────────────────
export async function executeApprovedMarketingAction(
  workspaceId: string, payload: Record<string, any>, approvalActionId: string | null,
): Promise<Record<string, any>> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const sbAdmin = supabaseAdmin as any;
  const actionId = String(payload?.marketing_action_id ?? "");
  if (!actionId) throw new Error("marketing_action_id missing from approval payload");
  const action = await loadAction(sbAdmin, workspaceId, actionId);
  // Bind execution to the exact approval row that was consumed — an orphaned
  // or superseded approval must never execute the action.
  if (!approvalActionId || String(action.approval_action_id ?? "") !== String(approvalActionId)) {
    throw new Error("Approval is not linked to this marketing action (stale or orphaned approval).");
  }
  if (action.status === "awaiting_approval") {
    const ok = await transitionMarketingAction(sbAdmin, action.id, "awaiting_approval", "approved", {}, "Human approved");
    if (!ok) throw new Error("Marketing action changed concurrently during approval.");
  } else if (action.status !== "approved") {
    throw new Error(`Marketing action is ${action.status}; cannot execute.`);
  }
  const result = await runMarketingAction(sbAdmin, workspaceId, actionId);
  if (result.outcome !== "executed") throw new Error(result.detail);
  return { marketing_action_id: actionId, outcome: result.outcome, detail: result.detail };
}

// ── Helpers ──────────────────────────────────────────────────────────────────
async function loadAction(sbAdmin: any, workspaceId: string, actionId: string): Promise<MarketingActionRecord> {
  const { data, error } = await sbAdmin.from("marketing_actions")
    .select("*")
    .eq("id", actionId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Marketing action not found in this workspace.");
  return data as MarketingActionRecord;
}
