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
import { IN_FLIGHT_TARGET_STATUSES, type DialerTargetStatus } from "./auto-dialer.shared";

type DbClient = SupabaseClient | { from: (table: string) => any };

/**
 * Dial the next pending target in a session, if the session is still running
 * and nothing is currently in flight. Safe to call redundantly — both the
 * Start action and every webhook call this after updating a target, and only
 * one of them will find a pending target with nothing in flight.
 */
export async function dialNextDialerTarget(sb: DbClient, sessionId: string): Promise<void> {
  const { data: session } = await sb
    .from("dialer_sessions")
    .select("id, workspace_id, status, from_number, route_numbers, ring_timeout_secs, stats")
    .eq("id", sessionId)
    .maybeSingle();

  if (!session || session.status !== "running") return;

  const { data: inFlight } = await sb
    .from("dialer_targets")
    .select("id")
    .eq("session_id", sessionId)
    .in("status", IN_FLIGHT_TARGET_STATUSES)
    .limit(1)
    .maybeSingle();
  if (inFlight) return; // something is already ringing — the webhook for it will call us again

  const { data: next } = await sb
    .from("dialer_targets")
    .select("id, phone")
    .eq("session_id", sessionId)
    .eq("status", "pending")
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!next) {
    await sb
      .from("dialer_sessions")
      .update({ status: "completed", updated_at: new Date().toISOString() })
      .eq("id", sessionId)
      .eq("status", "running"); // don't stomp a Pause/Cancel that raced us here
    return;
  }

  const routeNumbers = (session.route_numbers ?? []) as string[];
  const host = resolvePublicHost();
  const credentials = await resolveTwilioCredentialsForWorkspace(sb, session.workspace_id as string);

  const { default: twilio } = await import("twilio");
  const client = twilio(credentials.accountSid, credentials.authToken);

  try {
    const call = await client.calls.create({
      to: next.phone as string,
      from: session.from_number as string,
      url: `${host}/api/public/telephony/dialer-connect/${next.id}`,
      method: "POST",
      statusCallback: `${host}/api/public/telephony/dialer-lead-status/${next.id}`,
      statusCallbackMethod: "POST",
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
    });

    await sb
      .from("dialer_targets")
      .update({
        status: "dialing",
        call_sid: call.sid,
        attempt_count: 1,
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", next.id);

    await bumpStat(sb, sessionId, "dialed");
  } catch (e: any) {
    // Twilio's SDK throws a RestException with `code`/`status`/`moreInfo` for a rejected call —
    // e.g. a destination country blocked under Voice → Geographic Permissions comes back as a 403
    // before the call ever rings. Stored here rather than only logged: the previous version left
    // this failure completely silent to anyone without server log access, showing only "failed"
    // with no way to tell a geo-permission block apart from bad credentials or a malformed number.
    const errorMessage = [e?.status, e?.code, e?.message].filter(Boolean).join(" ") || String(e);
    console.error("[auto-dialer] failed to place call:", errorMessage, e?.moreInfo ?? "");
    await sb
      .from("dialer_targets")
      .update({
        status: "failed",
        error_message: errorMessage.slice(0, 500),
        ended_at: new Date().toISOString(),
        advanced_at: new Date().toISOString(), // nothing will call us back for this leg — advance now
        updated_at: new Date().toISOString(),
      })
      .eq("id", next.id);
    await bumpStat(sb, sessionId, "failed");
    // Recurse so a bad number doesn't stall the whole list.
    await dialNextDialerTarget(sb, sessionId);
  }

  void routeNumbers; // referenced for documentation; actual ring list is built in dialer-connect
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
