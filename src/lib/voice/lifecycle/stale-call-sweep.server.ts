/**
 * Stale native-call reconciliation sweep.
 *
 * A native-engine call's `calls` row only leaves `in_progress` when its
 * `NativeCallLifecycle.ended()` webhook (`call_ended`/`call_analyzed`) is
 * delivered — see call-lifecycle.ts. If the process exits or that delivery
 * fails (dev-server reload mid-call, a deploy landing mid-call, a dropped
 * loopback request) nothing ever retries it, and the row is stuck showing
 * "in progress" forever with no self-correction.
 *
 * This cannot recover the transcript or run real analysis for those calls:
 * `call_turns` only ever stored latency metrics, never the turn text, so once
 * the live `NativeCallLifecycle` instance that held the transcript in memory
 * is gone, that content is gone too. All this can honestly do is stop the row
 * from lying about still being active, so it closes out calls abandoned past
 * a generous grace period as failed, with a disconnection reason that marks
 * them as recovered-after-the-fact rather than a real hangup.
 *
 * Relative imports only (reachable from vite.config.ts).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** Generous on purpose: a real call can sit quiet during a long IVR wait or hold. */
const STALE_AFTER_MS = 10 * 60 * 1000;

export interface StaleCallSweepResult {
  checked: number;
  closed: number;
  callIds: string[];
}

/**
 * Close out native calls (`provider is null`) stuck in `in_progress` whose
 * `updated_at` is older than the stale threshold. Retell-routed calls are left
 * alone — those have their own webhook/dashboard lifecycle, not this one.
 */
export async function sweepStaleNativeCalls(
  sb: SupabaseClient,
  now: number = Date.now(),
): Promise<StaleCallSweepResult> {
  const cutoff = new Date(now - STALE_AFTER_MS).toISOString();

  const { data: stale, error } = await sb
    .from("calls")
    .select("id, started_at, updated_at")
    .eq("call_status", "in_progress")
    .is("provider", null)
    .lt("updated_at", cutoff);

  if (error) throw new Error(`stale-call-sweep select failed: ${error.message}`);

  const rows = stale ?? [];
  if (rows.length === 0) return { checked: 0, closed: 0, callIds: [] };

  const ids = rows.map((r: { id: string }) => r.id);
  const { error: updateError } = await sb
    .from("calls")
    .update({
      call_status: "failed",
      disconnection_reason: "lost_connection_unrecovered",
      ended_at: new Date(now).toISOString(),
    })
    .in("id", ids)
    // Re-check the status in the WHERE clause: a call that genuinely ended between the
    // select above and this update (its real webhook landing late) must not be clobbered.
    .eq("call_status", "in_progress");

  if (updateError) throw new Error(`stale-call-sweep update failed: ${updateError.message}`);

  return { checked: rows.length, closed: ids.length, callIds: ids };
}
