/**
 * Legacy creator test utilities — Task #500
 *
 * Provides `assertNoLegacyDirectInsert` (and its async variant) for use in
 * architecture tests that verify creator functions are properly guarded.
 *
 * Workstream 7 architecture tests import these helpers to assert that:
 *   - Migrated creators produce intelligence-packet-backed rows.
 *   - Disabled (LEGACY_CREATOR_BLOCKED) creators throw before touching the DB.
 *
 * These are pure test utilities; they have no runtime side-effects.
 */

export class LegacyCreatorBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LegacyCreatorBlockedError";
  }
}

/**
 * Assert that a DISABLED creator function throws before reaching the DB.
 * Call with an async wrapper around the creator — e.g.:
 *
 *   await assertNoLegacyDirectInsert(
 *     () => someDisabledCreator(sb, workspaceId),
 *     "LEGACY_CREATOR_BLOCKED",
 *   );
 */
export async function assertNoLegacyDirectInsert(
  fn: () => Promise<unknown>,
  expectedFragment = "LEGACY_CREATOR_BLOCKED",
): Promise<void> {
  let threw = false;
  try {
    await fn();
  } catch (e: unknown) {
    threw = true;
    const msg = String((e as Error)?.message ?? e);
    if (!msg.includes(expectedFragment)) {
      throw new Error(
        `assertNoLegacyDirectInsert: expected error message to contain "${expectedFragment}" ` +
        `but got: "${msg}"`,
      );
    }
  }
  if (!threw) {
    throw new Error(
      `assertNoLegacyDirectInsert: expected the creator to throw with "${expectedFragment}" ` +
      "but it returned normally — the legacy guard is missing.",
    );
  }
}

/**
 * Assert that a migrated creator row contains a valid intelligence packet.
 * Checks the fields that `prepareMindTaskInsert` always sets.
 *
 * Usage (after capturing an insert from a mocked Supabase builder):
 *
 *   assertRowHasIntelligencePacket(capturedRow, {
 *     expectedMind: "growthmind",
 *     expectedSource: "growthmind_monitoring",
 *   });
 */
export function assertRowHasIntelligencePacket(
  row: Record<string, unknown>,
  opts: {
    expectedMind?: string;
    expectedSource?: string;
    expectedTriggerType?: string;
  } = {},
): void {
  const { expectedMind, expectedSource, expectedTriggerType } = opts;

  if (!row.intelligence_packet) {
    throw new Error(
      "assertRowHasIntelligencePacket: row is missing intelligence_packet — " +
      "the creator is not using prepareMindTaskInsert.",
    );
  }

  const packet = row.intelligence_packet as Record<string, unknown>;

  if (!packet.version) {
    throw new Error(
      "assertRowHasIntelligencePacket: intelligence_packet is missing `version` — " +
      "it may not have been built via buildIntelligencePacket.",
    );
  }

  if (!packet.objective || String(packet.objective).trim() === "") {
    throw new Error(
      "assertRowHasIntelligencePacket: intelligence_packet.objective is empty.",
    );
  }

  if (expectedMind && packet.mind !== expectedMind) {
    throw new Error(
      `assertRowHasIntelligencePacket: expected mind "${expectedMind}" but got "${String(packet.mind)}".`,
    );
  }

  if (expectedSource && row.source !== expectedSource) {
    throw new Error(
      `assertRowHasIntelligencePacket: expected source "${expectedSource}" but got "${String(row.source)}".`,
    );
  }

  if (expectedTriggerType && row.trigger_type !== expectedTriggerType) {
    throw new Error(
      `assertRowHasIntelligencePacket: expected trigger_type "${expectedTriggerType}" but got "${String(row.trigger_type)}".`,
    );
  }

  if (!row.readiness_state) {
    throw new Error(
      "assertRowHasIntelligencePacket: row is missing readiness_state — " +
      "prepareMindTaskInsert always sets this field.",
    );
  }

  if (!row.packet_version) {
    throw new Error(
      "assertRowHasIntelligencePacket: row is missing packet_version — " +
      "prepareMindTaskInsert always sets this field.",
    );
  }
}
