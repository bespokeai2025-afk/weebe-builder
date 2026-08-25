/**
 * Twilio phone number provisioning.
 *
 * Replaces the Retell phone APIs (`create-phone-number`, `import-phone-number`,
 * `update-phone-number`) with direct Twilio calls, so numbers belong to us rather
 * than to a reseller. That matters beyond cost: a number bought through Retell
 * can only be pointed at a Retell agent, which makes the native engine
 * unreachable on it.
 *
 * Every number this module provisions is wired to our own TwiML endpoints, which
 * is the step that actually connects a call to the voice gateway.
 */
import type { Twilio } from "twilio";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  buildNumberWebhooks,
  resolvePublicHost,
  type TwilioCredentials,
} from "./twilio-env";
import { resolveTwilioCredentialsForWorkspace } from "./twilio-credentials.server";

export {
  buildNumberWebhooks,
  resolvePublicHost,
  type TwilioCredentials,
};

async function client(workspaceId?: string): Promise<Twilio> {
  const { accountSid, authToken } = await resolveTwilioCredentialsForWorkspace(
    supabaseAdmin,
    workspaceId,
  );
  // `twilio` is CommonJS (`export =`): at runtime the callable factory arrives on
  // `default`, but its types describe the bare namespace, so the cast is needed
  // to reach it. Calling the namespace directly typechecks and then fails at
  // runtime, which is the trap here.
  const mod = (await import("twilio")) as unknown as {
    default: (sid: string, token: string) => Twilio;
  };
  return mod.default(accountSid, authToken);
}

export interface AvailableNumber {
  phoneNumber: string;
  friendlyName: string;
  locality: string | null;
  region: string | null;
  isoCountry: string;
  capabilities: { voice: boolean; sms: boolean; mms: boolean };
}

export interface SearchOptions {
  country: string;
  areaCode?: string;
  contains?: string;
  /** Toll-free inventory is a separate Twilio resource, not a filter. */
  tollFree?: boolean;
  smsEnabled?: boolean;
  limit?: number;
  workspaceId?: string;
}

export async function searchAvailableNumbers(options: SearchOptions): Promise<AvailableNumber[]> {
  const twilioClient = await client(options.workspaceId);
  const country = options.country.toUpperCase();
  const filters: Record<string, unknown> = {
    limit: Math.min(options.limit ?? 20, 50),
    voiceEnabled: true,
  };
  if (options.areaCode) filters.areaCode = Number(options.areaCode);
  if (options.contains) filters.contains = options.contains;
  if (options.smsEnabled) filters.smsEnabled = true;

  const inventory = twilioClient.availablePhoneNumbers(country);
  const results = options.tollFree
    ? await inventory.tollFree.list(filters)
    : await inventory.local.list(filters);

  return results.map((n) => ({
    phoneNumber: n.phoneNumber,
    friendlyName: n.friendlyName ?? n.phoneNumber,
    locality: n.locality ?? null,
    region: n.region ?? null,
    isoCountry: n.isoCountry ?? country,
    capabilities: {
      voice: Boolean(n.capabilities?.voice),
      sms: Boolean(n.capabilities?.sms),
      mms: Boolean(n.capabilities?.mms),
    },
  }));
}

export interface OwnedNumber {
  sid: string;
  phoneNumber: string;
  friendlyName: string | null;
  voiceUrl: string | null;
}

/** Look up a number already in the Twilio account, for the import path. */
export async function findOwnedNumber(
  phoneNumber: string,
  workspaceId?: string,
): Promise<OwnedNumber | null> {
  const twilioClient = await client(workspaceId);
  const [match] = await twilioClient.incomingPhoneNumbers.list({ phoneNumber, limit: 1 });
  if (!match) return null;
  return {
    sid: match.sid,
    phoneNumber: match.phoneNumber,
    friendlyName: match.friendlyName ?? null,
    voiceUrl: match.voiceUrl ?? null,
  };
}

/** Buy a number and point it at our endpoints in one call. */
export async function purchaseNumber(args: {
  phoneNumber: string;
  friendlyName?: string;
  workspaceId?: string;
}): Promise<OwnedNumber> {
  const twilioClient = await client(args.workspaceId);
  const created = await twilioClient.incomingPhoneNumbers.create({
    phoneNumber: args.phoneNumber,
    friendlyName: args.friendlyName,
    ...buildNumberWebhooks(),
  });
  return {
    sid: created.sid,
    phoneNumber: created.phoneNumber,
    friendlyName: created.friendlyName ?? null,
    voiceUrl: created.voiceUrl ?? null,
  };
}

/** Repoint an existing number at our endpoints. */
export async function configureNumberWebhooks(sid: string, workspaceId?: string): Promise<void> {
  const twilioClient = await client(workspaceId);
  await twilioClient.incomingPhoneNumbers(sid).update(buildNumberWebhooks());
}

/**
 * Give a number back to Twilio.
 *
 * Irreversible: the number returns to the pool and someone else can buy it.
 * Callers must confirm with the user first.
 */
export async function releaseNumber(sid: string, workspaceId?: string): Promise<void> {
  const twilioClient = await client(workspaceId);
  await twilioClient.incomingPhoneNumbers(sid).remove();
}

/**
 * Record a provisioned number against a workspace.
 *
 * Upserts on `(workspace_id, phone_number)` so re-importing a number already on
 * file updates it instead of creating a duplicate the UI would show twice.
 */
export async function savePhoneNumberRow(args: {
  workspaceId: string;
  phoneNumber: string;
  providerSid: string;
  friendlyName?: string | null;
  agentId?: string | null;
  capabilities?: { voice: boolean; sms: boolean };
}): Promise<string> {
  const { data: config } = await supabaseAdmin
    .from("telephony_configs")
    .select("id")
    .eq("workspace_id", args.workspaceId)
    .maybeSingle();

  const { data: existing } = await supabaseAdmin
    .from("phone_numbers")
    .select("id")
    .eq("workspace_id", args.workspaceId)
    .eq("phone_number", args.phoneNumber)
    .maybeSingle();

  const row = {
    workspace_id: args.workspaceId,
    telephony_config_id: config?.id ?? null,
    phone_number: args.phoneNumber,
    friendly_name: args.friendlyName ?? null,
    provider: "twilio",
    provider_sid: args.providerSid,
    agent_id: args.agentId ?? null,
    capabilities: args.capabilities ?? { voice: true, sms: false },
    is_active: true,
    updated_at: new Date().toISOString(),
  };

  if (existing?.id) {
    const { error } = await supabaseAdmin
      .from("phone_numbers")
      .update(row)
      .eq("id", existing.id as string);
    if (error) throw new Error(error.message);
    return existing.id as string;
  }

  const { data: inserted, error } = await supabaseAdmin
    .from("phone_numbers")
    .insert(row)
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return inserted.id as string;
}
