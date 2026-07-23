// GET /api/oauth/meta-callback — Meta (Facebook/Instagram) OAuth redirect target.
// Verifies the HMAC-signed state, exchanges the code for a LONG-LIVED user
// token, discovers the user's Facebook Pages + linked Instagram professional
// accounts, and upserts growthmind_social_connections rows with tokens stored
// AES-256-GCM encrypted (server-only column). Tokens never reach the browser.
import { createFileRoute } from "@tanstack/react-router";
import {
  verifyMetaOAuthState, META_OAUTH_CALLBACK_PATH, META_GRAPH_VERSION,
} from "@/lib/growthmind/meta-oauth.functions";
import { isSafeRelativePath, isAllowedOAuthOrigin } from "@/lib/providers/advertising/google-ads-oauth.functions";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const GRAPH = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

function redirectBack(returnTo: string, params: Record<string, string>): Response {
  const safePath = isSafeRelativePath(returnTo) ? returnTo : "/growthmind/social-accounts";
  const qs = new URLSearchParams(params).toString();
  const sep = safePath.includes("?") ? "&" : "?";
  return new Response(null, { status: 302, headers: { Location: `${safePath}${sep}${qs}` } });
}

async function graphGet(path: string, token: string, params: Record<string, string> = {}): Promise<any> {
  const qs = new URLSearchParams({ ...params, access_token: token }).toString();
  const res  = await fetch(`${GRAPH}${path}?${qs}`);
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(String(json?.error?.message ?? `Graph API HTTP ${res.status}`).slice(0, 200));
  }
  return json;
}

export const Route = createFileRoute("/api/oauth/meta-callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url      = new URL(request.url);
        const code     = url.searchParams.get("code");
        const rawState = url.searchParams.get("state");
        const oauthErr = url.searchParams.get("error");

        const fallback = "/growthmind/social-accounts";
        if (!rawState) return redirectBack(fallback, { meta: "error", meta_msg: "Missing state" });

        const state = await verifyMetaOAuthState(rawState);
        if (!state) return redirectBack(fallback, { meta: "error", meta_msg: "Invalid or expired sign-in link. Please try connecting again." });

        const returnTo = isSafeRelativePath(state.returnTo) ? state.returnTo : fallback;
        if (!isAllowedOAuthOrigin(state.origin)) {
          return redirectBack(returnTo, { meta: "error", meta_msg: "Sign-in origin not allowed." });
        }
        if (oauthErr) {
          return redirectBack(returnTo, { meta: "error", meta_msg: oauthErr === "access_denied" ? "Meta sign-in was cancelled." : `Meta error: ${oauthErr}` });
        }
        if (!code) return redirectBack(returnTo, { meta: "error", meta_msg: "Meta did not return an authorisation code." });

        const sb = supabaseAdmin as any;

        // Re-validate authorization: the state's user must STILL be an
        // owner/admin member of the workspace (they may have been demoted or
        // removed between starting the flow and this callback).
        const { data: member } = await sb
          .from("workspace_members")
          .select("role")
          .eq("workspace_id", state.workspaceId)
          .eq("user_id", state.userId)
          .maybeSingle();
        if (member?.role !== "owner" && member?.role !== "admin") {
          return redirectBack(returnTo, { meta: "error", meta_msg: "Only workspace owners and admins can connect social accounts." });
        }

        // Load the workspace's Meta app credentials
        const { data: setting } = await sb
          .from("provider_settings")
          .select("credentials")
          .eq("workspace_id", state.workspaceId)
          .eq("provider_category", "social")
          .eq("provider_name", "meta")
          .maybeSingle();
        const creds = (setting?.credentials ?? {}) as Record<string, string>;
        if (!creds.appId || !creds.appSecret) {
          return redirectBack(returnTo, { meta: "error", meta_msg: "Meta App ID/Secret not found for this workspace." });
        }

        try {
          // 1. Code → short-lived user token
          const tokenRes = await fetch(`${GRAPH}/oauth/access_token?` + new URLSearchParams({
            client_id:     creds.appId,
            client_secret: creds.appSecret,
            redirect_uri:  `${state.origin}${META_OAUTH_CALLBACK_PATH}`,
            code,
          }).toString());
          const tokenJson = await tokenRes.json();
          if (!tokenRes.ok || tokenJson.error) {
            const msg = tokenJson?.error?.message ?? `HTTP ${tokenRes.status}`;
            return redirectBack(returnTo, { meta: "error", meta_msg: `Token exchange failed: ${String(msg).slice(0, 160)}` });
          }

          // 2. Short-lived → long-lived user token (~60 days)
          const llRes = await fetch(`${GRAPH}/oauth/access_token?` + new URLSearchParams({
            grant_type:        "fb_exchange_token",
            client_id:         creds.appId,
            client_secret:     creds.appSecret,
            fb_exchange_token: tokenJson.access_token,
          }).toString());
          const llJson = await llRes.json();
          if (!llRes.ok || llJson.error) {
            const msg = llJson?.error?.message ?? `HTTP ${llRes.status}`;
            return redirectBack(returnTo, { meta: "error", meta_msg: `Long-lived token exchange failed: ${String(msg).slice(0, 160)}` });
          }
          const userToken: string = llJson.access_token;
          const userTokenExpiresAt = llJson.expires_in
            ? new Date(Date.now() + Number(llJson.expires_in) * 1000).toISOString()
            : new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString();

          // 3. Granted permissions (stored per connection for the status UI)
          let grantedScopes: string[] = [];
          try {
            const perms = await graphGet("/me/permissions", userToken);
            grantedScopes = (perms.data ?? [])
              .filter((p: any) => p.status === "granted")
              .map((p: any) => String(p.permission));
          } catch { /* non-fatal */ }

          // 4. Pages (with per-Page tokens — these do not expire for long-lived user tokens)
          const pagesJson = await graphGet("/me/accounts", userToken, {
            fields: "id,name,username,access_token,picture{url},instagram_business_account{id,username,name,profile_picture_url}",
            limit:  "100",
          });
          const pages: any[] = pagesJson.data ?? [];
          if (pages.length === 0) {
            return redirectBack(returnTo, { meta: "error", meta_msg: "No Facebook Pages found on this Meta account. Publishing requires a Facebook Page (Instagram must be a professional account linked to a Page)." });
          }

          const { encryptMetaToken } = await import("@/lib/growthmind/meta-token.server");
          const now = new Date().toISOString();
          let connected = 0;
          const writeFailures: string[] = [];
          const fbPublishOk = grantedScopes.includes("pages_manage_posts");
          const igPublishOk = grantedScopes.includes("instagram_content_publish");

          for (const page of pages) {
            const pageToken: string = page.access_token ?? userToken;
            // Facebook Page connection
            const { error: fbErr } = await sb.from("growthmind_social_connections").upsert({
              workspace_id:           state.workspaceId,
              provider:               "meta",
              account_type:           "facebook_page",
              external_account_id:    String(page.id),
              account_name:           page.name ?? null,
              username:               page.username ?? null,
              profile_picture_url:    page.picture?.data?.url ?? null,
              permissions:            grantedScopes,
              capabilities:           {
                publishing: grantedScopes.includes("pages_manage_posts"),
                analytics:  grantedScopes.includes("read_insights") || grantedScopes.includes("pages_read_engagement"),
              },
              access_token_encrypted: encryptMetaToken(pageToken),
              token_type:             "long_lived",
              token_expires_at:       null, // Page tokens from long-lived user tokens don't expire
              status:                 fbPublishOk ? "connected" : "needs_reconnect",
              last_error:             fbPublishOk ? null : "Missing pages_manage_posts permission — reconnect and grant it to enable publishing.",
              connected_by_user_id:   state.userId,
              metadata:               { source: "oauth", connected_at: now },
              updated_at:             now,
            }, { onConflict: "workspace_id,provider,account_type,external_account_id" });
            if (fbErr) writeFailures.push(`Page ${page.name ?? page.id}: ${fbErr.message}`);
            else connected++;

            // Linked Instagram professional account
            const ig = page.instagram_business_account;
            if (ig?.id) {
              const { error: igErr } = await sb.from("growthmind_social_connections").upsert({
                workspace_id:           state.workspaceId,
                provider:               "meta",
                account_type:           "instagram_professional",
                external_account_id:    String(ig.id),
                account_name:           ig.name ?? page.name ?? null,
                username:               ig.username ?? null,
                profile_picture_url:    ig.profile_picture_url ?? null,
                permissions:            grantedScopes,
                capabilities:           {
                  publishing: grantedScopes.includes("instagram_content_publish"),
                  analytics:  grantedScopes.includes("instagram_manage_insights"),
                  comments:   grantedScopes.includes("instagram_manage_comments"),
                },
                // IG publishing uses the linked Page's token
                access_token_encrypted: encryptMetaToken(pageToken),
                token_type:             "long_lived",
                token_expires_at:       userTokenExpiresAt,
                status:                 igPublishOk ? "connected" : "needs_reconnect",
                last_error:             igPublishOk ? null : "Missing instagram_content_publish permission — reconnect and grant it to enable publishing.",
                connected_by_user_id:   state.userId,
                metadata:               { source: "oauth", linked_page_id: String(page.id), connected_at: now },
                updated_at:             now,
              }, { onConflict: "workspace_id,provider,account_type,external_account_id" });
              if (igErr) writeFailures.push(`Instagram ${ig.username ?? ig.id}: ${igErr.message}`);
              else connected++;
            }
          }

          if (connected === 0) {
            const why = writeFailures[0] ?? "no accounts could be saved";
            return redirectBack(returnTo, { meta: "error", meta_msg: `Failed to save connections: ${String(why).slice(0, 160)}` });
          }

          // Mark provider connected (credentials only hold appId/appSecret — user tokens live per-connection)
          const { upsertProviderSetting } = await import("@/lib/providers/usage.server");
          await upsertProviderSetting({
            workspaceId: state.workspaceId,
            category: "social",
            providerName: "meta",
            status: "connected",
            credentials: creds,
          });

          const { logGrowthMindActivity } = await import("@/lib/growthmind/growthmind.activity.server");
          await logGrowthMindActivity({
            workspaceId: state.workspaceId,
            actor: "user",
            actorUserId: state.userId,
            category: "social",
            action: "social.connected",
            summary: `Connected ${connected} Meta account${connected === 1 ? "" : "s"} via OAuth`,
            detail: { accounts: connected, scopes: grantedScopes },
          });

          return redirectBack(returnTo, { meta: "connected", meta_count: String(connected) });
        } catch (e: any) {
          return redirectBack(returnTo, { meta: "error", meta_msg: String(e?.message ?? e).slice(0, 180) });
        }
      },
    },
  },
});
