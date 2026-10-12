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
import { resolvePublicHost } from "./twilio-env";
import { resolveTwilioCredentialsForWorkspace } from "./twilio-credentials.server";
import {
  agentsOnNumber,
  countriesForE164,
  isCountryAllowed,
  type NumberRoutingRow,
} from "./number-routing.shared";

export interface NativeDialParams {
  /** Service-role client; this runs from schedulers with no user session. */
  sb: SupabaseClient | { from: (table: string) => any };
  workspaceId: string;
  agentId: string;
  to: string;
  campaignId?: string | null;
  /** Overrides number selection. Must be a number we own. */
  fromNumber?: string | null;
  /**
   * Values for the agent's {{variables}} on this call — Retell's `retell_llm_dynamic_variables`
   * (lead name, address, …). Coerced to strings, as Retell does.
   */
  dynamicVariables?: Record<string, unknown> | null;
  /** Free-form tags carried to the call's webhook events (Retell's `metadata`), e.g. lead_id. */
  metadata?: Record<string, unknown> | null;
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
): Promise<{ number: string; id: string | null; routing: NumberRoutingRow } | null> {
  const { data } = await sb
    .from("phone_numbers")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("is_active", true)
    .order("created_at", { ascending: true });
  const rows = (data ?? []) as Array<NumberRoutingRow & { id: string; phone_number: string; provider?: string }>;
  // A Retell SIP import can't be dialled through Twilio here.
  const usable = rows.filter((r) => r.provider !== "retell_sip");
  const own =
    usable.find((r) => agentsOnNumber(r, "outbound").includes(agentId)) ??
    usable.find((r) => r.agent_id === agentId);
  const pick = own ?? usable[0];
  return pick ? { number: pick.phone_number, id: pick.id ?? null, routing: pick } : null;
}

async function loadNumberRouting(
  sb: NativeDialParams["sb"],
  workspaceId: string,
  phoneNumber: string,
): Promise<{ id: string | null; routing: NumberRoutingRow }> {
  const { data } = await sb
    .from("phone_numbers")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("phone_number", phoneNumber)
    .limit(1)
    .maybeSingle();
  return { id: (data?.id as string | undefined) ?? null, routing: (data ?? {}) as NumberRoutingRow };
}

/** Retell requires dynamic variables to be strings; objects and empty values are dropped. */
export function toDynamicVariables(input: Record<string, unknown> | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input ?? {})) {
    const key = k.trim();
    if (!key || v === null || v === undefined || typeof v === "object") continue;
    const value = String(v);
    if (value !== "") out[key] = value;
  }
  return out;
}

export async function placeNativeOutboundCall(
  params: NativeDialParams,
): Promise<NativeDialResult> {
  const { sb, workspaceId, agentId, to } = params;

  let from: { number: string; id: string | null; routing: NumberRoutingRow } | null = params.fromNumber
    ? { number: params.fromNumber, ...(await loadNumberRouting(sb, workspaceId, params.fromNumber)) }
    : null;
  if (!from) from = await resolveFromNumber(sb, workspaceId, agentId);
  if (!from) {
    throw new Error(
      "No active phone number for this workspace — buy or import one before dialling on the native engine.",
    );
  }
  // The number's allowed outbound countries (Retell's allowed_outbound_country_list).
  const destination = countriesForE164(to);
  if (!isCountryAllowed(from.routing.allowed_outbound_countries, destination)) {
    throw new Error(
      `${from.number} is not allowed to call ${destination.join("/") || "this destination"}. Change the number's allowed outbound countries to dial it.`,
    );
  }
  const dynamicVariables = toDynamicVariables(params.dynamicVariables);
  const callMetadata: Record<string, unknown> = {};
  if (Object.keys(dynamicVariables).length) callMetadata.dynamic_variables = dynamicVariables;
  if (params.metadata && Object.keys(params.metadata).length) callMetadata.call_metadata = params.metadata;

  const host = resolvePublicHost();
  const credentials = await resolveTwilioCredentialsForWorkspace(sb, workspaceId);

  // `ringDurationMs` is agent-level builder policy (matches Retell's own field of the same
  // purpose) — how long to let an outbound call ring before giving up. Previously stored and
  // never read, so every native outbound call rang for however long Twilio's own default allows.
  let ringSeconds: number | undefined;
  try {
    const { data: agentRow } = await sb
      .from("agents")
      .select("settings")
      .eq("id", agentId)
      .maybeSingle();
    const ms = Number((agentRow?.settings as Record<string, unknown> | null)?.ringDurationMs);
    if (Number.isFinite(ms) && ms > 0) ringSeconds = Math.max(5, Math.min(120, Math.round(ms / 1000)));
  } catch {
    // Ring duration is a nicety, not a call blocker — fall back to Twilio's own default.
  }

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
      metadata: callMetadata,
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
    ringSeconds,
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
