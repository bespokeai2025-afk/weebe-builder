// ── Meta (Facebook Page / Instagram professional) "Connect" OAuth flow ────────
// Mirrors the Google Ads OAuth pattern:
//   1. startMetaOAuth — saves the workspace's Meta App ID/Secret into
//      provider_settings (category "social", provider "meta"), then returns the
//      Facebook consent URL with an HMAC-signed state blob.
//   2. Facebook redirects to /api/oauth/meta-callback (route file), which
//      verifies state, exchanges the code for a LONG-LIVED user token, fetches
//      the user's Pages + linked IG professional accounts, and stores one
//      growthmind_social_connections row per account with the token AES-256-GCM
//      encrypted (server-only column).
// Tokens NEVER reach the client: the encrypted column is excluded from the
// authenticated role's column grants, and no server fn ever returns it.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isSafeRelativePath, isAllowedOAuthOrigin } from "@/lib/providers/advertising/google-ads-oauth.functions";
import { upsertProviderSetting } from "@/lib/providers/usage.server";

export const META_OAUTH_CALLBACK_PATH = "/api/oauth/meta-callback";
export const META_GRAPH_VERSION = "v21.0";

// Requested scopes — publishing + insights for Pages and IG professional accounts.
export const META_OAUTH_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "pages_read_user_content",
  "instagram_basic",
  "instagram_content_publish",
  "instagram_manage_insights",
  "instagram_manage_comments",
  "business_management",
  "read_insights",
];

// ── HMAC-signed state (same construction as Google Ads, different context) ────

async function getStateSecret(): Promise<string> {
  const { createHash } = await import("crypto");
  const raw = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "meta-oauth-fallback";
  return createHash("sha256").update(`${raw}:meta-social-oauth-state`).digest("hex");
}

export interface MetaOAuthState {
  workspaceId: string;
  userId:      string;
  returnTo:    string;
  origin:      string;
  ts:          number;
}

export async function signMetaOAuthState(state: MetaOAuthState): Promise<string> {
  const { createHmac } = await import("crypto");
  const secret  = await getStateSecret();
  const payload = Buffer.from(JSON.stringify(state)).toString("base64url");
  const sig     = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export async function verifyMetaOAuthState(raw: string): Promise<MetaOAuthState | null> {
  try {
    const { createHmac, timingSafeEqual } = await import("crypto");
    const [payload, sig] = raw.split(".");
    if (!payload || !sig) return null;
    const secret   = await getStateSecret();
    const expected = createHmac("sha256", secret).update(payload).digest("base64url");
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const state = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as MetaOAuthState;
    if (!state.ts || Date.now() - state.ts > 15 * 60 * 1000) return null;
    if (!state.workspaceId || !state.userId) return null;
    return state;
  } catch {
    return null;
  }
}

// ── Status + connections list (no tokens ever returned) ───────────────────────

export const getMetaSocialStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const sb = context.supabase as any;

    const [{ data: setting }, { data: conns, error }] = await Promise.all([
      sb.from("provider_settings")
        .select("credentials, status")
        .eq("workspace_id", workspaceId)
        .eq("provider_category", "social")
        .eq("provider_name", "meta")
        .maybeSingle(),
      sb.from("growthmind_social_connections")
        .select("id, provider, account_type, external_account_id, account_name, username, profile_picture_url, permissions, capabilities, token_expires_at, status, last_error, last_sync_at, created_at, updated_at")
        .eq("workspace_id", workspaceId)
        .order("account_type", { ascending: true })
        .order("account_name", { ascending: true }),
    ]);
    if (error) throw new Error(error.message);

    const creds = (setting?.credentials ?? {}) as Record<string, string>;
    return {
      hasAppId:     !!creds.appId,
      hasAppSecret: !!creds.appSecret,
      callbackPath: META_OAUTH_CALLBACK_PATH,
      connections:  (conns ?? []) as Array<{
        id: string; provider: string; account_type: string; external_account_id: string;
        account_name: string | null; username: string | null; profile_picture_url: string | null;
        permissions: string[]; capabilities: Record<string, boolean>;
        token_expires_at: string | null; status: string; last_error: string | null;
        last_sync_at: string | null; created_at: string; updated_at: string;
      }>,
    };
  });

// ── Start the OAuth flow (admin-only) ─────────────────────────────────────────

const StartInput = z.object({
  origin:    z.string().url().max(300),
  returnTo:  z.string().min(1).max(300).refine(isSafeRelativePath, "returnTo must be a relative in-app path"),
  appId:     z.string().max(200).optional(),
  appSecret: z.string().max(200).optional(),
});

export const startMetaOAuth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: z.infer<typeof StartInput>) => StartInput.parse(i))
  .handler(async ({ data, context }) => {
    const workspaceId = context.workspaceId;
    const userId      = context.userId;
    if (!workspaceId) throw new Error("No workspace");

    if (!isAllowedOAuthOrigin(data.origin)) {
      throw new Error("This app origin is not allowed for Meta sign-in.");
    }

    // Admin-only — mirrors the Google Ads flow
    const { data: member } = await (context.supabase as any)
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .maybeSingle();
    if (member?.role !== "owner" && member?.role !== "admin") {
      throw new Error("Only workspace owners and admins can connect social accounts.");
    }

    const sb = context.supabase as any;
    const { data: existing } = await sb
      .from("provider_settings")
      .select("credentials")
      .eq("workspace_id", workspaceId)
      .eq("provider_category", "social")
      .eq("provider_name", "meta")
      .maybeSingle();

    const creds: Record<string, string> = { ...((existing?.credentials as Record<string, string>) ?? {}) };
    if (data.appId?.trim())     creds.appId     = data.appId.trim();
    if (data.appSecret?.trim()) creds.appSecret = data.appSecret.trim();

    if (!creds.appId || !creds.appSecret) {
      throw new Error("Missing Meta App ID / App Secret. Enter them first (from developers.facebook.com), then click Connect with Meta.");
    }

    await upsertProviderSetting({
      workspaceId,
      category: "social",
      providerName: "meta",
      credentials: creds,
    });

    const state = await signMetaOAuthState({
      workspaceId, userId,
      returnTo: data.returnTo,
      origin:   data.origin,
      ts:       Date.now(),
    });

    const redirectUri = `${data.origin}${META_OAUTH_CALLBACK_PATH}`;
    const params = new URLSearchParams({
      client_id:     creds.appId,
      redirect_uri:  redirectUri,
      response_type: "code",
      scope:         META_OAUTH_SCOPES.join(","),
      state,
    });

    return {
      url: `https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth?${params.toString()}`,
      redirectUri,
    };
  });

// ── Disconnect a connection (admin-only, token destroyed) ─────────────────────

const DisconnectInput = z.object({ connectionId: z.string().uuid() });

export const disconnectMetaSocial = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: z.infer<typeof DisconnectInput>) => DisconnectInput.parse(i))
  .handler(async ({ data, context }) => {
    const workspaceId = context.workspaceId;
    const userId      = context.userId;
    if (!workspaceId) throw new Error("No workspace");

    const { data: member } = await (context.supabase as any)
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .maybeSingle();
    if (member?.role !== "owner" && member?.role !== "admin") {
      throw new Error("Only workspace owners and admins can disconnect social accounts.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;

    // Workspace-scoped update — clears the token and marks disconnected.
    const { data: updated, error } = await admin
      .from("growthmind_social_connections")
      .update({
        status: "disconnected",
        access_token_encrypted: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.connectionId)
      .eq("workspace_id", workspaceId)
      .select("id, account_name, account_type")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!updated) throw new Error("Connection not found");

    const { logGrowthMindActivity } = await import("@/lib/growthmind/growthmind.activity.server");
    await logGrowthMindActivity({
      workspaceId,
      actor: "user",
      actorUserId: userId,
      category: "social",
      action: "social.disconnected",
      summary: `Disconnected ${updated.account_type} "${updated.account_name ?? updated.id}"`,
      entityType: "growthmind_social_connections",
      entityId: updated.id,
    });

    return { ok: true };
  });
