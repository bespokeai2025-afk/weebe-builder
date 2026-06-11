/**
 * Runtime Definition Migration
 *
 * Upgrades older AgentRuntimeDefinition exports to the current RUNTIME_VERSION.
 *
 * When the schema changes in a backward-incompatible way:
 *   1. Increment RUNTIME_VERSION in schema.ts.
 *   2. Add the old version to SUPPORTED_RUNTIME_VERSIONS (or remove it when
 *      you decide to drop support).
 *   3. Add a migration function below and register it in MIGRATION_CHAIN.
 *
 * Migration chain: each step takes the output of the previous step.
 * Running migrateDefinition() on an already-current definition is a no-op.
 *
 * RULES:
 *   - Migrations only add or rename fields — they never remove data.
 *   - Migrations never call Builder functions (no prompt compilation).
 *   - The final output is always validated by the current schema before return.
 */

import { RUNTIME_VERSION, SUPPORTED_RUNTIME_VERSIONS, AgentRuntimeDefinitionSchema } from "./schema";
import type { AgentRuntimeDefinition } from "./schema";

// ─── Migration registry ───────────────────────────────────────────────────────

/**
 * Each entry upgrades from one version to the next.
 * Migrations are applied in order until the target version is reached.
 */
const MIGRATION_CHAIN: {
  from: string;
  to: string;
  apply: (raw: Record<string, unknown>) => Record<string, unknown>;
}[] = [
  // Example for when 1.0.0 → 1.1.0 is needed:
  //
  // {
  //   from: "1.0.0",
  //   to: "1.1.0",
  //   apply: (raw) => ({
  //     ...raw,
  //     runtimeVersion: "1.1.0",
  //     newField: raw.newField ?? "default",
  //   }),
  // },
];

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Upgrade a raw definition to the target version (defaults to RUNTIME_VERSION).
 *
 * Accepts any unknown value — validates the final output against the current
 * schema before returning. Throws on validation failure.
 *
 * Running this on a current definition is a safe no-op.
 */
export function migrateDefinition(
  raw: unknown,
  targetVersion: string = RUNTIME_VERSION,
): AgentRuntimeDefinition {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("migrateDefinition: input must be a non-null object");
  }

  let current = raw as Record<string, unknown>;
  const inputVersion = String(current.runtimeVersion ?? "unknown");

  if (inputVersion === targetVersion) {
    // Already at target — just validate and return.
    return AgentRuntimeDefinitionSchema.parse(current);
  }

  if (inputVersion === "unknown") {
    throw new Error(
      "migrateDefinition: input has no runtimeVersion field. " +
        "Cannot determine migration path.",
    );
  }

  // Walk the migration chain from inputVersion to targetVersion.
  let version = inputVersion;
  for (const step of MIGRATION_CHAIN) {
    if (version === targetVersion) break;
    if (step.from === version) {
      current = step.apply(current);
      version = step.to;
    }
  }

  if (version !== targetVersion) {
    const supported = SUPPORTED_RUNTIME_VERSIONS as readonly string[];
    throw new Error(
      `migrateDefinition: no migration path from "${inputVersion}" to "${targetVersion}". ` +
        `Supported versions: ${supported.join(", ")}. ` +
        `Re-export from the Builder to get a current definition.`,
    );
  }

  // Final strict validation — catches migration bugs.
  return AgentRuntimeDefinitionSchema.parse(current);
}

/**
 * Check whether a raw value's runtimeVersion is one the current build supports
 * without applying any migration.
 */
export function isSupportedVersion(raw: unknown): boolean {
  if (typeof raw !== "object" || raw === null) return false;
  const version = (raw as Record<string, unknown>).runtimeVersion;
  return (SUPPORTED_RUNTIME_VERSIONS as readonly unknown[]).includes(version);
}

/**
 * Return the runtimeVersion from a raw value, or null if absent/invalid.
 */
export function getRuntimeVersion(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null) return null;
  const v = (raw as Record<string, unknown>).runtimeVersion;
  return typeof v === "string" ? v : null;
}
