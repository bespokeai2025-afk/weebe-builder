/**
 * Shared Mind tool registry — client-safe types & metadata.
 *
 * Every consequential capability of the four Minds (HiveMind, GrowthMind,
 * SystemMind, AccountsMind) is described by a MindToolMeta descriptor so
 * web, mobile and the developer API all see the SAME catalog with the same
 * permission / approval semantics. No server imports, no secrets.
 */
import type { ActionKey } from "@/lib/permissions/permissions.shared";

export type MindKey = "hivemind" | "growthmind" | "systemmind" | "accountsmind";

export type MindToolAccess = "read" | "write";

export type MindToolPlatform = "web" | "mobile" | "api" | "system";

/** Real execution statuses — no optimistic success, ever. */
export type MindToolExecutionStatus =
  | "proposed"
  | "approval_required"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "blocked";

export type MindToolCost = "none" | "low" | "medium" | "high";

/**
 * How a tool is actually executed:
 *  - "registry"        — executable directly through executeMindTool().
 *  - "hivemind_action" — executed via the HiveMind action approval flow
 *                        (propose → approve → execute); the registry audits
 *                        the execution step.
 *  - "server_fn"       — user-driven server function that reports its runs
 *                        into the registry audit trail.
 */
export type MindToolSurface = "registry" | "hivemind_action" | "server_fn";

export interface MindToolMeta {
  /** Unique name, `<mind>.<tool>` e.g. "hivemind.create_task". */
  name: string;
  mind: MindKey;
  title: string;
  description: string;
  access: MindToolAccess;
  surface: MindToolSurface;
  /** Sensitive tools ALWAYS require explicit human approval (all modes). */
  sensitive: boolean;
  /** Entitlement ActionKey required to run/approve this tool (if any). */
  requiredActionKey?: ActionKey;
  /**
   * HiveMind action type used for mode-gate evaluation when the tool is
   * Mind-initiated. Defaults to the tool's short name.
   */
  modeGateActionType?: string;
  idempotent: boolean;
  estimatedCost: MindToolCost;
  platforms: MindToolPlatform[];
}

/** Catalog entry returned to clients (adds per-user allowance). */
export interface MindToolCatalogEntry extends MindToolMeta {
  allowed: boolean;
  deniedReason?: string;
}
