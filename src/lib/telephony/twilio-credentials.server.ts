/**
 * Workspace-scoped Twilio credential resolution.
 *
 * Settings → Providers → Telephony persists to `workspace_settings`; platform
 * deploys can still fall back to TWILIO_* env vars. Runtime code should prefer
 * workspace credentials when present.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  resolveTwilioCredentials as resolveEnvTwilioCredentials,
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
