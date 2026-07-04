/**
 * SystemMind Deployment Execution — CONTRACT / SCAFFOLDING ONLY (Task #298, spec step 5).
 *
 * This file defines the *shape* of a future, human-supervised deployment
 * execution layer WITHOUT implementing any of it. It exists so that later work
 * has a clear, reviewable boundary to build against.
 *
 * ⚠️ AUTONOMOUS DEPLOYMENT IS DISABLED AND MUST STAY DISABLED. ⚠️
 * Nothing in SystemMind provisions, deploys, or executes anything. Deployment
 * plans are DESCRIPTIVE artifacts a human operator carries out by hand. The
 * constant below is the single source of truth for that policy, and
 * `assertExecutionDisabled()` is the guard every future executor MUST call
 * first — today it always throws.
 *
 * Safe to import anywhere (pure types + constants, no side effects, no I/O).
 */

/** Global kill-switch. Flipping this true is intentionally NOT enough on its own —
 *  a real executor would still require explicit, audited, per-step human approval. */
export const AUTONOMOUS_DEPLOYMENT_ENABLED = false as const;

export type ExecutionStepKind =
  | "provision_infrastructure"
  | "configure_provider"
  | "install_credential"
  | "register_webhook"
  | "import_workflow"
  | "run_validation"
  | "run_test";

/** A single unit of work a human (or, some day, a supervised executor) performs. */
export interface ExecutionStep {
  id: string;
  kind: ExecutionStepKind;
  title: string;
  description: string;
  /** Deployment-variable KEYS this step needs — never their values. */
  requiresVariableKeys: string[];
  /** Whether this step is safe to retry without side effects. */
  idempotent: boolean;
  /** Must be true for a step to be eligible — defaults false everywhere today. */
  humanApproved: boolean;
}

export interface ExecutionContext {
  workspaceId: string;
  planId: string;
  /** Resolved out-of-band by a human operator; never populated by SystemMind. */
  approvedBy: string | null;
}

export interface ExecutionResult {
  stepId: string;
  status: "skipped" | "succeeded" | "failed";
  message: string;
}

/**
 * The interface a future, human-supervised executor would implement. There is
 * intentionally NO concrete implementation in the codebase. Any implementation
 * MUST call `assertExecutionDisabled()` before doing anything.
 */
export interface DeploymentExecutor {
  readonly enabled: boolean;
  plan(context: ExecutionContext): Promise<ExecutionStep[]>;
  execute(context: ExecutionContext, step: ExecutionStep): Promise<ExecutionResult>;
}

export class DeploymentExecutionDisabledError extends Error {
  constructor() {
    super(
      "Autonomous/automated deployment execution is disabled in SystemMind. " +
        "Deployment plans are descriptive only and must be executed by a human operator.",
    );
    this.name = "DeploymentExecutionDisabledError";
  }
}

/** The guard every execution path must call first. Always throws today. */
export function assertExecutionDisabled(): never {
  throw new DeploymentExecutionDisabledError();
}

/** True only if execution were ever enabled AND a human approved the step. Always false today. */
export function isStepExecutable(step: ExecutionStep): boolean {
  return AUTONOMOUS_DEPLOYMENT_ENABLED && step.humanApproved === true;
}
