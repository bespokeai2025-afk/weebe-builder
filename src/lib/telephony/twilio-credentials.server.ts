/**
 * Workspace-scoped Twilio credential resolution.
 *
 * Settings → Providers → Telephony persists to `workspace_settings`; platform
 * deploys can still fall back to TWILIO_* env vars. Runtime code should prefer
 * workspace credentials when present.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Twilio } from "twilio";
import {
  resolveTwilioCredentials as resolveEnvTwilioCredentials,
  resolveMasterTwilioCredentials,
  type TwilioCredentials,
} from "./twilio-env";

export type TwilioCredentialSource = "workspace" | "env" | "none";

export interface ResolvedTwilioCredentials extends TwilioCredentials {
  source: TwilioCredentialSource;
}

type DbClient = Pick<SupabaseClient, "from"> | { from: (table: string) => any };

export async function loadWorkspaceTwilioCredentials(
  sb: DbClient,
  workspaceId: string,
): Promise<TwilioCredentials | null> {
  const { data } = await sb
    .from("workspace_settings")
    .select("twilio_account_sid, twilio_auth_token")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  const accountSid = String(data?.twilio_account_sid ?? "").trim();
  const authToken = String(data?.twilio_auth_token ?? "").trim();
  if (accountSid && authToken) return { accountSid, authToken };
  return null;
}

export function resolveTwilioCredentialsFromEnv(): TwilioCredentials | null {
  try {
    return resolveEnvTwilioCredentials();
  } catch {
    return null;
  }
}

export async function resolveTwilioCredentialsForWorkspace(
  sb: DbClient,
  workspaceId: string | null | undefined,
): Promise<ResolvedTwilioCredentials> {
  if (workspaceId) {
    const ws = await loadWorkspaceTwilioCredentials(sb, workspaceId);
    if (ws) return { ...ws, source: "workspace" };
  }
  const env = resolveTwilioCredentialsFromEnv();
  if (env) return { ...env, source: "env" };
  throw new Error(
    "Twilio is not configured. Add credentials in Settings → Providers → Telephony, or set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in the environment.",
  );
}

async function masterClient(): Promise<Twilio> {
  const { accountSid, authToken } = resolveMasterTwilioCredentials();
  // Same CommonJS-interop workaround as twilio-numbers.server.ts's client().
  const mod = (await import("twilio")) as unknown as {
    default: (sid: string, token: string) => Twilio;
  };
  return mod.default(accountSid, authToken);
}

/**
 * Get (or lazily create) the Twilio Subaccount WEBEE provisions for a
 * workspace under its own master account.
 *
 * Not yet called from any live code path — this is the additive first half
 * of the Twilio reseller cutover (plan step 1a). `resolveTwilioCredentialsForWorkspace`
 * below is not yet rewired to use it; that is the gated step 1b.
 *
 * A DB unique constraint on workspace_id (the primary key) plus
 * `ON CONFLICT ... DO NOTHING` + re-select prevents a race between two
 * concurrent callers from creating two subaccounts for one workspace — only
 * one insert can ever win, and both callers end up returning the same row.
 */
export async function resolveOrCreateWorkspaceSubaccount(
  sb: DbClient,
  workspaceId: string,
): Promise<TwilioCredentials> {
  const existing = await sb
    .from("workspace_twilio_subaccounts")
    .select("twilio_subaccount_sid, twilio_subaccount_auth_token")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (existing.data?.twilio_subaccount_sid && existing.data?.twilio_subaccount_auth_token) {
    return {
      accountSid: existing.data.twilio_subaccount_sid,
      authToken: existing.data.twilio_subaccount_auth_token,
    };
  }

  const client = await masterClient();
  const subaccount = await client.api.v2010.accounts.create({
    friendlyName: `WEBEE workspace ${workspaceId}`,
  });

  // ignoreDuplicates: if another concurrent call already inserted this
  // workspace's row first, this upsert becomes a no-op rather than
  // overwriting it with a second, different subaccount.
  await sb
    .from("workspace_twilio_subaccounts")
    .upsert(
      {
        workspace_id: workspaceId,
        twilio_subaccount_sid: subaccount.sid,
        twilio_subaccount_auth_token: subaccount.authToken,
        friendly_name: subaccount.friendlyName,
      },
      { onConflict: "workspace_id", ignoreDuplicates: true },
    );

  const resolved = await sb
    .from("workspace_twilio_subaccounts")
    .select("twilio_subaccount_sid, twilio_subaccount_auth_token")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (!resolved.data?.twilio_subaccount_sid || !resolved.data?.twilio_subaccount_auth_token) {
    throw new Error(`Failed to provision or read back a Twilio subaccount for workspace ${workspaceId}.`);
  }

  return {
    accountSid: resolved.data.twilio_subaccount_sid,
    authToken: resolved.data.twilio_subaccount_auth_token,
  };
}

export async function getTwilioCredentialStatus(
  sb: DbClient,
  workspaceId: string,
): Promise<{
  workspace_sid_configured: boolean;
  workspace_token_configured: boolean;
  env_sid_configured: boolean;
  env_token_configured: boolean;
  credentials_ready: boolean;
  credential_source: TwilioCredentialSource;
  workspace_account_sid: string | null;
  workspace_auth_token_set: boolean;
}> {
  const ws = await loadWorkspaceTwilioCredentials(sb, workspaceId);
  const envSid = !!process.env.TWILIO_ACCOUNT_SID?.trim();
  const envToken = !!process.env.TWILIO_AUTH_TOKEN?.trim();
  const wsSid = !!ws?.accountSid;
  const wsToken = !!ws?.authToken;
  const credentials_ready = (wsSid && wsToken) || (envSid && envToken);
  const credential_source: TwilioCredentialSource =
    wsSid && wsToken ? "workspace" : envSid && envToken ? "env" : "none";

  return {
    workspace_sid_configured: wsSid,
    workspace_token_configured: wsToken,
    env_sid_configured: envSid,
    env_token_configured: envToken,
    credentials_ready,
    credential_source,
    workspace_account_sid: ws?.accountSid ?? null,
    workspace_auth_token_set: wsToken,
  };
}
