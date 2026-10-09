/**
 * Auto Dialer engine — advances a session's queue one target at a time.
 *
 * Plain functions, not `createServerFn`s: this runs both from a user action
 * (Start) and from the Twilio webhooks that report a target's outcome, and a
 * webhook has no user session to authenticate — it always uses the
 * service-role client and re-derives the workspace from the row it looked up
 * by call_sid, the same pattern as `telephony/status.ts` and `inbound.ts`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolvePublicHost } from "./twilio-env";
import { resolveTwilioCredentialsForWorkspace } from "./twilio-credentials.server";
import {
  IN_FLIGHT_TARGET_STATUSES,
  capacityUsed,
  dialerCapacity,
  type DialerTargetStatus,
} from "./auto-dialer.shared";

type DbClient = SupabaseClient | { from: (table: string) => any };

/**
 * Fill the session's free capacity: dial pending targets until the live calls equal the number
 * of people who can take them (`dialerCapacity`). With two people, a third lead is never dialled
 * while both are on calls; as soon as one is free again, the next lead is dialled.
 *
 * Safe to call redundantly and concurrently — the Start action and every webhook call it. Each
 * pending target is claimed with a conditional update, and a dial that would overshoot capacity
 * (two webhooks racing) is handed back to the queue before any phone rings.
 */
export async function dialNextDialerTarget(sb: DbClient, sessionId: string): Promise<void> {
  for (let guard = 0; guard < 50; guard++) {
    const { data: session } = await sb
      .from("dialer_sessions")
      .select("id, workspace_id, status, from_number, route_numbers, ring_timeout_secs, stats")
      .eq("id", sessionId)
      .maybeSingle();
    if (!session || session.status !== "running") return;

    const capacity = dialerCapacity(session.route_numbers as string[]);
    const live = await liveTargets(sb, sessionId);
    if (live.reduce((n, t) => n + capacityUsed(t), 0) >= capacity) return; // everyone is busy

    const { data: next } = await sb
      .from("dialer_targets")
      .select("id, phone")
      .eq("session_id", sessionId)
      .eq("status", "pending")
      .order("position", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!next) {
      if (live.length === 0) {
        await sb
          .from("dialer_sessions")
          .update({ status: "completed", updated_at: new Date().toISOString() })
          .eq("id", sessionId)
          .eq("status", "running"); // don't stomp a Pause/Cancel that raced us here
      }
      return;
    }

    // Claim it: only one caller can move this row out of "pending".
    const { data: claimed } = await sb
      .from("dialer_targets")
      .update({
        status: "dialing",
        attempt_count: 1,
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", next.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (!claimed) continue; // someone else took it — look again

    // A concurrent caller may have claimed another target at the same moment.
    const after = await liveTargets(sb, sessionId);
    if (after.reduce((n, t) => n + capacityUsed(t), 0) > capacity) {
      await sb
        .from("dialer_targets")
        .update({ status: "pending", started_at: null, updated_at: new Date().toISOString() })
        .eq("id", next.id)
        .eq("status", "dialing")
        .is("call_sid", null);
      return;
    }

    await placeDialerCall(sb, session, next as { id: string; phone: string });
  }
}

async function liveTargets(
  sb: DbClient,
  sessionId: string,
): Promise<Array<{ id: string; status: string; bridged_number: string | null }>> {
  const { data } = await sb
    .from("dialer_targets")
    .select("id, status, bridged_number")
    .eq("session_id", sessionId)
    .in("status", IN_FLIGHT_TARGET_STATUSES);
  return (data ?? []) as Array<{ id: string; status: string; bridged_number: string | null }>;
}

async function placeDialerCall(
  sb: DbClient,
  session: { id: string; workspace_id: string; from_number: string },
  next: { id: string; phone: string },
): Promise<void> {
  const host = resolvePublicHost();
  try {
    const credentials = await resolveTwilioCredentialsForWorkspace(sb, session.workspace_id);
    const { default: twilio } = await import("twilio");
    const client = twilio(credentials.accountSid, credentials.authToken);
    const call = await client.calls.create({
      to: next.phone,
      from: session.from_number,
      url: `${host}/api/public/telephony/dialer-connect/${next.id}`,
      method: "POST",
      statusCallback: `${host}/api/public/telephony/dialer-lead-status/${next.id}`,
      statusCallbackMethod: "POST",
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
      // Voicemail screening: Twilio listens for a few seconds after the lead picks up and reports
      // `AnsweredBy` to dialer-connect, which hangs up on a machine instead of ringing our people.
      // Off unless enabled (AUTO_DIALER_AMD=on): it is billed per call and adds a few seconds
      // before a real person is connected.
      ...(process.env.AUTO_DIALER_AMD === "on"
        ? { machineDetection: "Enable" as const, machineDetectionTimeout: 8 }
        : {}),
    });

    await sb
      .from("dialer_targets")
      .update({ call_sid: call.sid, updated_at: new Date().toISOString() })
      .eq("id", next.id);

    await bumpStat(sb, session.id, "dialed");
  } catch (e: any) {
    // Twilio's SDK throws a RestException with `code`/`status`/`moreInfo` for a rejected call —
    // e.g. a destination country blocked under Voice → Geographic Permissions comes back before
    // the call ever rings. Stored so the run shows why, not just "failed".
    const errorMessage = [e?.status, e?.code, e?.message].filter(Boolean).join(" ") || String(e);
    console.error("[auto-dialer] failed to place call:", errorMessage, e?.moreInfo ?? "");
    await sb
      .from("dialer_targets")
      .update({
        status: "failed",
        error_message: errorMessage.slice(0, 500),
        ended_at: new Date().toISOString(),
        advanced_at: new Date().toISOString(), // nothing will call us back for this leg
        updated_at: new Date().toISOString(),
      })
      .eq("id", next.id);
    await bumpStat(sb, session.id, "failed");
    // The caller's loop moves on to the next target, so one bad number doesn't stall the list.
  }
}

async function bumpStat(sb: DbClient, sessionId: string, key: "dialed" | "bridged" | "no_answer" | "failed") {
  const { data } = await sb.from("dialer_sessions").select("stats").eq("id", sessionId).maybeSingle();
  const stats = { total: 0, dialed: 0, bridged: 0, no_answer: 0, failed: 0, ...(data?.stats ?? {}) };
  stats[key] = (stats[key] ?? 0) + 1;
  await sb.from("dialer_sessions").update({ stats, updated_at: new Date().toISOString() }).eq("id", sessionId);
}

/**
 * Claim the right to advance the queue past a target.
 *
 * Both the Dial-result webhook and the lead's own call-status webhook can
 * report a terminal outcome for the same target (a normal <Dial> completion
 * fires both). Only the first one to land here should trigger the next dial;
 * the DB `advanced_at IS NULL` guard makes that atomic regardless of which
 * webhook wins the race.
 */
export async function claimDialerAdvance(sb: DbClient, targetId: string): Promise<boolean> {
  const { data } = await sb
    .from("dialer_targets")
    .update({ advanced_at: new Date().toISOString() })
    .eq("id", targetId)
    .is("advanced_at", null)
    .select("id")
    .maybeSingle();
  return Boolean(data);
}

export async function recordTargetOutcome(
  sb: DbClient,
  targetId: string,
  status: DialerTargetStatus,
  extra: Record<string, unknown> = {},
): Promise<{ sessionId: string } | null> {
  const { data: target } = await sb
    .from("dialer_targets")
    .select("id, session_id, status")
    .eq("id", targetId)
    .maybeSingle();
  if (!target) return null;

  // Never downgrade a status we've already recorded terminally (e.g. a second
  // webhook re-reporting after the queue already advanced past it).
  await sb
    .from("dialer_targets")
    .update({
      status,
      ended_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...extra,
    })
    .eq("id", targetId);

  if (status === "bridged") await bumpStat(sb, target.session_id as string, "bridged");
  else if (status === "no_answer" || status === "busy") await bumpStat(sb, target.session_id as string, "no_answer");
  else if (status === "failed") await bumpStat(sb, target.session_id as string, "failed");

  return { sessionId: target.session_id as string };
}
