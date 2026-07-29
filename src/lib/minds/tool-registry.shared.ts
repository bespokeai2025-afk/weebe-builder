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

/**
 * Describes the effective availability of a capability.
 *
 * Static values (set per-tool):
 *   "available"             — fully functional when declared prerequisites are met.
 *   "read_only"             — capability only supports read operations.
 *   "draft_only"            — creates drafts / proposals only; never auto-executes.
 *   "approval_required"     — ALWAYS requires explicit human sign-off.
 *
 * Computed values (overlaid by getCapabilityManifest for a specific workspace):
 *   "integration_required"  — one or more required integrations are not connected.
 *   "credential_required"   — one or more required credentials are not set.
 */
export type CapabilityState =
  | "available"
  | "read_only"
  | "draft_only"
  | "approval_required"
  | "integration_required"
  | "credential_required";

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

  // ── Universal capability spec fields ────────────────────────────────────────

  /**
   * Logical grouping for this capability, e.g. "seo", "ads_management",
   * "content_publishing", "finance", "monitoring", "workflow_management".
   * Required for write/sensitive tools; recommended for all tools.
   */
  featureFamily?: string;

  /**
   * High-level objectives this tool can satisfy, e.g.
   * ["improve_campaign_roas", "reduce_cpa"].
   */
  supportedObjectives?: string[];

  /**
   * Entity types (DB tables or domain concepts) the tool needs a target of,
   * e.g. ["growthmind_trend_items", "leads"].
   */
  requiredTargetTypes?: string[];

  /**
   * External integration keys that MUST be connected for this tool to work,
   * e.g. ["google_ads", "google_search_console", "meta_social", "whatsapp"].
   * getCapabilityManifest overlays "integration_required" when any are absent.
   */
  requiredIntegrations?: string[];

  /**
   * Environment/secrets that must be present, e.g. ["RETELL_API_KEY"].
   * getCapabilityManifest overlays "credential_required" when any are absent.
   */
  requiredCredentials?: string[];

  /**
   * Static capability state declaration.  The manifest function may override
   * this with "integration_required" or "credential_required" at request time.
   */
  capabilityState?: CapabilityState;

  /**
   * Whether the execution engine snapshots state before apply so a rollback
   * can restore it if the operation fails mid-way.
   */
  rollbackSupported?: boolean;

  /**
   * Human-readable note about known provider constraints or honest limitations,
   * e.g. "No TikTok publish API — publication is always manual."
   */
  providerLimitations?: string;

  /**
   * Whether this tool is available to mobile clients (web, native).
   * Defaults to true when "mobile" is included in `platforms`.
   */
  mobileAvailable?: boolean;

  /**
   * Statically seeded operational health of this capability.
   * "degraded" / "unavailable" are used for known outages or missing infra;
   * live polling is a future workstream.
   */
  currentHealth?: "healthy" | "degraded" | "unavailable";
}

/** Catalog entry returned to clients (adds per-user allowance). */
export interface MindToolCatalogEntry extends MindToolMeta {
  allowed: boolean;
  deniedReason?: string;
}
