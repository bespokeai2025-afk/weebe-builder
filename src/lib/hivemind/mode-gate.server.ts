// ── HiveMind mode gate — SERVER ONLY ──────────────────────────────────────────
// One guard consulted by every task / action / recommendation write path.
// Reads workspace_settings.hivemind_mode + operator enablement config.
//
// Modes (default: "recommend" — spec):
//   observe   — watch only. No tasks, no actions, no recommendations written.
//   recommend — proposals/tasks allowed; EXTERNAL actions never execute.
//   assistant — prepares work; sensitive actions still need explicit approval.
//   operator  — may auto-execute NON-sensitive actions, but only when
//               explicitly enabled by an owner/admin, the action's category is
//               permitted, and confidence/data quality is adequate.
// Sensitive actions ALWAYS require explicit human approval, in every mode.

import {
  DEFAULT_HIVEMIND_MODE,
  HIVEMIND_MODES,
  INTERNAL_ACTION_TYPES,
  ACTION_OPERATOR_CATEGORY,
  isSensitiveActionType,
  isOperatorClassMode,
  type HiveMindModeName,
  type OperatorCategory,
} from "./action-safety.shared";

type Sb = any;

export interface HiveMindModeConfig {
  mode: HiveMindModeName;
  operatorEnabled: boolean;
  operatorPermissions: Partial<Record<OperatorCategory, boolean>>;
}

export class ModeGateError extends Error {
  readonly gate: string;
  constructor(gate: string, message: string) {
    super(message);
    this.name = "ModeGateError";
    this.gate = gate;
  }
}

/** Read the workspace's mode config. Fails CLOSED to observe (most restrictive) on read errors. */
export async function getHiveMindModeConfig(
  sb: Sb,
  workspaceId: string,
): Promise<HiveMindModeConfig> {
  try {
    const { data, error } = await sb
      .from("workspace_settings")
      .select("hivemind_mode, hivemind_operator_enabled, hivemind_operator_permissions")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    // Supabase builders return { error } instead of throwing — an ignored read
    // error must NOT degrade to the (more permissive) default mode.
    if (error) {
      return { mode: "observe", operatorEnabled: false, operatorPermissions: {} };
    }
    const rawMode = data?.hivemind_mode;
    const mode: HiveMindModeName =
      (HIVEMIND_MODES as readonly string[]).includes(rawMode) ? (rawMode as HiveMindModeName) : DEFAULT_HIVEMIND_MODE;
    return {
      mode,
      operatorEnabled: data?.hivemind_operator_enabled === true,
      operatorPermissions:
        data?.hivemind_operator_permissions && typeof data.hivemind_operator_permissions === "object"
          ? data.hivemind_operator_permissions
          : {},
    };
  } catch {
    // Fail CLOSED: if the mode cannot be read, behave as the most restrictive
    // mode so no engine writes or executions can proceed on a fault.
    return { mode: "observe", operatorEnabled: false, operatorPermissions: {} };
  }
}

/**
 * Gate for WRITE paths that create tasks / actions / recommendations.
 * Observe mode blocks all engine-generated writes.
 */
export async function assertProposalAllowed(sb: Sb, workspaceId: string): Promise<HiveMindModeConfig> {
  const cfg = await getHiveMindModeConfig(sb, workspaceId);
  if (cfg.mode === "observe") {
    throw new ModeGateError(
      "observe_no_writes",
      "HiveMind is in Observe mode — it watches only and does not create tasks or actions.",
    );
  }
  return cfg;
}

/** Non-throwing variant for background engines (skip silently). */
export async function isProposalAllowed(sb: Sb, workspaceId: string): Promise<boolean> {
  const cfg = await getHiveMindModeConfig(sb, workspaceId);
  return cfg.mode !== "observe";
}

/**
 * Gate for EXECUTING an action (called both pre-consume for UX and
 * post-consume for the TOCTOU re-validation).
 *
 * - observe:   nothing executes.
 * - recommend: only internal action types (create_task, sync_ad_stats).
 * - assistant / operator: execution allowed WITH explicit human approval.
 *   (Sensitive actions are always explicit-approval-only — enforced by the
 *   caller requiring `explicitApproval` + entitlement checks.)
 */
export function assertExecutionAllowed(
  cfg: HiveMindModeConfig,
  actionType: string,
  opts: { explicitApproval: boolean },
): void {
  if (cfg.mode === "observe") {
    throw new ModeGateError(
      "observe_no_execute",
      "HiveMind is in Observe mode — actions cannot be executed.",
    );
  }
  if (cfg.mode === "recommend" && !INTERNAL_ACTION_TYPES.has(actionType)) {
    throw new ModeGateError(
      "recommend_no_external",
      "HiveMind is in Recommend mode — external actions are not executed. Switch to Assistant mode to run this with approval.",
    );
  }
  if (!opts.explicitApproval) {
    // Auto-execution path (no human in the loop) — operator mode only.
    if (isSensitiveActionType(actionType)) {
      throw new ModeGateError(
        "sensitive_needs_approval",
        "This is a sensitive action — it always requires explicit human approval.",
      );
    }
    if (!isOperatorClassMode(cfg.mode)) {
      throw new ModeGateError(
        "auto_exec_operator_only",
        "Automatic execution requires Operator mode.",
      );
    }
    if (!cfg.operatorEnabled) {
      throw new ModeGateError(
        "operator_not_enabled",
        "Operator mode has not been explicitly enabled by a workspace owner/admin.",
      );
    }
    const category = ACTION_OPERATOR_CATEGORY[actionType];
    if (!category || cfg.operatorPermissions[category] !== true) {
      throw new ModeGateError(
        "operator_category_denied",
        `Operator mode is not permitted to auto-execute "${actionType}" (category ${category ?? "unknown"} not enabled).`,
      );
    }
  }
}

/**
 * Operator confidence / data-quality stop: auto-execution must halt when the
 * underlying signal is weak. Fail closed when values are missing.
 */
export function operatorConfidenceAdequate(input: {
  confidence?: number | null;
  dataQualityOk?: boolean | null;
}): boolean {
  const conf = typeof input.confidence === "number" ? input.confidence : null;
  if (conf === null || conf < 0.7) return false;
  if (input.dataQualityOk !== true) return false;
  return true;
}
