/**
 * Capability registry helpers — client-safe.
 *
 * enrichCapability()               — normalises a tool definition: fills safe
 *                                    defaults, derives mobileAvailable from
 *                                    platforms, validates required fields.
 *
 * validateCapabilityRegistration() — throws CapabilityRegistrationError when a
 *                                    definition fails the enrichment checks.
 *                                    Architecture tests call this across the
 *                                    whole registry to enforce the standard.
 *
 * validateActionKind()             — throws "Unregistered capability kind" when
 *                                    the kind is not in EXECUTABLE_KINDS.  Used
 *                                    inside executeMindTool to gate dispatch.
 */
import type { MindToolMeta, CapabilityState } from "./tool-registry.shared";
import { EXECUTABLE_KINDS } from "@/lib/hivemind/execution-state.shared";

// ── Error type ────────────────────────────────────────────────────────────────

export class CapabilityRegistrationError extends Error {
  constructor(
    public readonly toolName: string,
    public readonly field: string,
    message: string,
  ) {
    super(`[capability-registry] ${toolName}: ${message}`);
    this.name = "CapabilityRegistrationError";
  }
}

// ── Enrichment ────────────────────────────────────────────────────────────────

/**
 * Normalise a tool definition:
 *  - derives mobileAvailable from platforms when not set explicitly
 *  - defaults capabilityState to "approval_required" for sensitive write tools,
 *    "available" for everything else
 *  - defaults currentHealth to "healthy"
 *  - defaults rollbackSupported to false
 *  - fills empty arrays for list fields
 *
 * Validation rule: registry-surface write tools and sensitive write tools MUST
 * declare featureFamily.  All other fields have safe defaults.
 *
 * Throws CapabilityRegistrationError on missing required fields.
 */
export function enrichCapability(def: MindToolMeta): MindToolMeta {
  const isSensitiveWrite = def.access === "write" && def.sensitive;
  const isRegistryWrite  = def.access === "write" && def.surface === "registry";

  if ((isRegistryWrite || isSensitiveWrite) && !def.featureFamily) {
    throw new CapabilityRegistrationError(
      def.name,
      "featureFamily",
      "write / sensitive registry tools must declare featureFamily",
    );
  }

  const mobileAvailable =
    def.mobileAvailable !== undefined
      ? def.mobileAvailable
      : def.platforms.includes("mobile");

  const capabilityState: CapabilityState =
    def.capabilityState ??
    (isSensitiveWrite ? "approval_required" : "available");

  return {
    ...def,
    mobileAvailable,
    capabilityState,
    rollbackSupported:    def.rollbackSupported    ?? false,
    currentHealth:        def.currentHealth        ?? "healthy",
    requiredIntegrations: def.requiredIntegrations ?? [],
    requiredCredentials:  def.requiredCredentials  ?? [],
    supportedObjectives:  def.supportedObjectives  ?? [],
    requiredTargetTypes:  def.requiredTargetTypes   ?? [],
  };
}

/**
 * Validate a single tool definition.  Throws CapabilityRegistrationError when
 * the definition does not meet the universal capability standard.
 *
 * Suitable for architecture tests:
 *   for (const tool of listMindTools()) validateCapabilityRegistration(tool);
 */
export function validateCapabilityRegistration(def: MindToolMeta): void {
  enrichCapability(def);
}

// ── Action-kind gate ──────────────────────────────────────────────────────────

/**
 * Ensure `kind` is in the EXECUTABLE_KINDS registry.
 * Throws if unrecognised — preventing unregistered kind dispatch.
 */
export function validateActionKind(kind: string | null | undefined): void {
  if (kind == null || kind === "") return;
  if (!(kind in EXECUTABLE_KINDS)) {
    throw new Error(
      `Unregistered capability kind "${kind}" — register it in EXECUTABLE_KINDS before creating executable tasks.`,
    );
  }
}
