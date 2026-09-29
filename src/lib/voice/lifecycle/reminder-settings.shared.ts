/**
 * `reminderTriggerMs` / `reminderMaxCount` — Retell's proactive "are you still there?" nudge
 * while the agent is waiting on the caller. Stored by the builder from the start; read by nobody
 * on a native call, so a caller who went quiet got nothing but eventual silence-timeout routing —
 * no nudge in between, no matter how the flow author configured it.
 *
 * This only decides *whether and how often* to nudge. What actually gets spoken and re-armed
 * lives in the graph VM's own "reminder" input (`graph/vm.ts`) — the same speak pipeline every
 * other line of dialogue goes through, not a side channel.
 *
 * Relative imports only — reachable from the voice gateway bundle.
 */

export interface ReminderSettings {
  triggerMs: number;
  maxCount: number;
}

/** Both fields must be present and positive — a nudge with no count, or vice versa, is not configured. */
export function resolveReminderSettings(
  settings: Record<string, unknown> | null | undefined,
): ReminderSettings | null {
  const triggerMs = Number(settings?.reminderTriggerMs);
  const maxCount = Number(settings?.reminderMaxCount);
  if (!Number.isFinite(triggerMs) || triggerMs <= 0) return null;
  if (!Number.isFinite(maxCount) || maxCount <= 0) return null;
  return { triggerMs, maxCount };
}

/**
 * No separate "reminder message" field exists in the builder schema (Retell's own reminder has
 * none either — it's an internal nudge, not author-configurable text), so this is the one
 * reasonable default rather than something invented per call.
 */
export const DEFAULT_REMINDER_TEXT = "Are you still there?";
