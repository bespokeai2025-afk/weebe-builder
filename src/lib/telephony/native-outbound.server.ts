/**
 * Place an outbound call on the native voice engine.
 *
 * Everything that dials — campaigns, auto-call on a new lead, "call now" — has so
 * far gone through Retell's `create-phone-call`, which requires a Retell agent id.
 * A migrated agent has none, so those paths would skip it and its campaigns would
 * quietly stop dialling. This is the equivalent for `WEBEE_NATIVE` agents.
 *
 * The mechanics are the same as `initiateOutboundCall`: insert a `telephony_calls`
 * row first, then hand Twilio TwiML that connects the call to
 * `/api/telephony/stream/<callId>`. That row id is the only handle the gateway
 * gets, which is why it must exist before the call is created.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolvePublicHost, resolveTwilioCredentials } from "./twilio-env";

export interface NativeDialParams {
  /** Service-role client; this runs from schedulers with no user session. */
  sb: SupabaseClient | { from: (table: string) => any };
  workspaceId: string;
  agentId: string;
  to: string;
  campaignId?: string | null;
  /** Overrides number selection. Must be a number we own. */
  fromNumber?: string | null;
}

export interface NativeDialResult {
  callId: string;
  callSid: string;
  status: string;
  fromNumber: string;
}

/**
 * Pick the caller ID for a native call.
 *
 * An agent's own number is preferred so the callee sees a number that reaches
 * this agent when they call back. Falling back to any active workspace number is
 * better than not dialling, but a callback then lands on whichever agent that
 * number is wired to.
 */
async function resolveFromNumber(
  sb: NativeDialParams["sb"],
  workspaceId: string,
  agentId: string,
): Promise<{ number: string; id: string | null } | null> {
  const { data: own } = await sb
    .from("phone_numbers")
    .select("id, phone_number")
    .eq("workspace_id", workspaceId)
    .eq("agent_id", agentId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (own?.phone_number) {
    return { number: own.phone_number as string, id: (own.id as string) ?? null };
  }

  const { data: any_ } = await sb
    .from("phone_numbers")
    .select("id, phone_number")
    .eq("workspace_id", workspaceId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (any_?.phone_number) {
    return { number: any_.phone_number as string, id: (any_.id as string) ?? null };
  }
  return null;
}

export async function placeNativeOutboundCall(
  params: NativeDialParams,
): Promise<NativeDialResult> {
  const { sb, workspaceId, agentId, to } = params;

  let from: { number: string; id: string | null } | null = params.fromNumber
    ? { number: params.fromNumber, id: null }
    : null;
  if (!from) from = await resolveFromNumber(sb, workspaceId, agentId);
  if (!from) {
    throw new Error(
      "No active phone number for this workspace — buy or import one before dialling on the native engine.",
    );
  }

  const host = resolvePublicHost();
  const credentials = resolveTwilioCredentials();

  const { data: callRow, error: insertErr } = await sb
    .from("telephony_calls")
    .insert({
      workspace_id: workspaceId,
      phone_number_id: from.id,
      agent_id: agentId,
      campaign_id: params.campaignId ?? null,
      direction: "outbound",
      from_number: from.number,
      to_number: to,
      status: "initiated",
      provider: "twilio",
    })
    .select("id")
    .single();
  if (insertErr) throw new Error(insertErr.message);

  // Imported here rather than at module scope: the campaign scheduler reaches
  // this file from vite.config.ts, and pulling the Twilio SDK in at config-load
  // time is both needless and fragile (it is CommonJS).
  const { TwilioProvider } = await import("./twilio.provider");
  const provider = new TwilioProvider(credentials);
  const result = await provider.makeCall({
    to,
    from: from.number,
    statusCallbackUrl: `${host}/api/public/telephony/status`,
    streamUrl: `wss://${new URL(host).host}/api/telephony/stream/${callRow.id}`,
  });

  await sb
    .from("telephony_calls")
    .update({ call_sid: result.callSid, status: result.status })
    .eq("id", callRow.id);

  return {
    callId: callRow.id as string,
    callSid: result.callSid,
    status: result.status,
    fromNumber: from.number,
  };
}
