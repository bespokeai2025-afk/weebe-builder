// GET /api/oauth/google-ads-callback — Google Ads OAuth redirect target.
// Verifies the HMAC-signed state, exchanges the auth code for a refresh token,
// stores it in provider_settings credentials, and (when initiated from
// GrowthMind) upserts a growthmind_ads_accounts row with the encrypted token.
import { createFileRoute } from "@tanstack/react-router";
import { verifyOAuthState, GOOGLE_ADS_CALLBACK_PATH, isSafeRelativePath, isAllowedOAuthOrigin } from "@/lib/providers/advertising/google-ads-oauth.functions";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { upsertProviderSetting } from "@/lib/providers/usage.server";

function redirectBack(returnTo: string, params: Record<string, string>): Response {
  const safePath = isSafeRelativePath(returnTo) ? returnTo : "/settings/providers/advertising";
  const qs = new URLSearchParams(params).toString();
  const sep = safePath.includes("?") ? "&" : "?";
  return new Response(null, {
    status: 302,
    headers: { Location: `${safePath}${sep}${qs}` },
  });
}

export const Route = createFileRoute("/api/oauth/google-ads-callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url      = new URL(request.url);
        const code     = url.searchParams.get("code");
        const rawState = url.searchParams.get("state");
        const oauthErr = url.searchParams.get("error");

        const fallback = "/settings/providers/advertising";

        if (!rawState) return redirectBack(fallback, { gads: "error", gads_msg: "Missing state" });

        const state = await verifyOAuthState(rawState);
        if (!state) return redirectBack(fallback, { gads: "error", gads_msg: "Invalid or expired sign-in link. Please try connecting again." });

        const returnTo = isSafeRelativePath(state.returnTo) ? state.returnTo : fallback;
        if (!isAllowedOAuthOrigin(state.origin)) {
          return redirectBack(returnTo, { gads: "error", gads_msg: "Sign-in origin not allowed." });
        }

        if (oauthErr) {
          return redirectBack(returnTo, { gads: "error", gads_msg: oauthErr === "access_denied" ? "Google sign-in was cancelled." : `Google error: ${oauthErr}` });
        }
        if (!code) return redirectBack(returnTo, { gads: "error", gads_msg: "Google did not return an authorisation code." });

        const sb = supabaseAdmin as any;

        // Load clientId/clientSecret for this workspace from provider_settings
        const { data: setting } = await sb
          .from("provider_settings")
          .select("credentials")
          .eq("workspace_id", state.workspaceId)
          .eq("provider_category", "advertising")
          .eq("provider_name", "google_ads")
          .maybeSingle();

        const creds = (setting?.credentials ?? {}) as Record<string, string>;
        if (!creds.clientId || !creds.clientSecret) {
          return redirectBack(returnTo, { gads: "error", gads_msg: "OAuth Client ID/Secret not found for this workspace." });
        }

        // Exchange the auth code for tokens
        let tokenJson: any;
        try {
          const res = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              grant_type:    "authorization_code",
              code,
              client_id:     creds.clientId,
              client_secret: creds.clientSecret,
              redirect_uri:  `${state.origin}${GOOGLE_ADS_CALLBACK_PATH}`,
            }),
          });
          tokenJson = await res.json();
          if (!res.ok || tokenJson.error) {
            const msg = tokenJson?.error_description ?? tokenJson?.error ?? `HTTP ${res.status}`;
            return redirectBack(returnTo, { gads: "error", gads_msg: `Token exchange failed: ${String(msg).slice(0, 160)}` });
          }
        } catch (e: any) {
          return redirectBack(returnTo, { gads: "error", gads_msg: `Token exchange failed: ${String(e?.message ?? e).slice(0, 160)}` });
        }

        const refreshToken: string | undefined = tokenJson.refresh_token;
        if (!refreshToken) {
          return redirectBack(returnTo, {
            gads: "error",
            gads_msg: "Google did not return a refresh token. Remove the app's access at myaccount.google.com/permissions and try again.",
          });
        }

        // Store refresh token in provider_settings (merged) and mark connected
        await upsertProviderSetting({
          workspaceId: state.workspaceId,
          category: "advertising",
          providerName: "google_ads",
          status: "connected",
          credentials: { ...creds, refreshToken },
        });

        // If initiated from GrowthMind, also upsert a growthmind_ads_accounts row
        if (state.source === "growthmind" && state.customerId) {
          try {
            const { encryptTokenForAds } = await import("@/lib/growthmind/growthmind.ads");
            const tokenEnc = await encryptTokenForAds(refreshToken);
            const now = new Date().toISOString();

            const { data: existingAcc } = await sb
              .from("growthmind_ads_accounts")
              .select("id")
              .eq("workspace_id", state.workspaceId)
              .eq("platform", "google")
              .eq("account_id", state.customerId)
              .maybeSingle();

            let accountRowId: string | null = null;
            if (existingAcc?.id) {
              await sb.from("growthmind_ads_accounts")
                .update({ token_enc: tokenEnc, status: "active", updated_at: now, ...(state.label ? { label: state.label } : {}) })
                .eq("id", existingAcc.id);
              accountRowId = existingAcc.id;
            } else {
              const { data: inserted } = await sb.from("growthmind_ads_accounts")
                .insert({
                  workspace_id: state.workspaceId,
                  platform:     "google",
                  label:        state.label || `Google Ads ${state.customerId}`,
                  account_id:   state.customerId,
                  status:       "active",
                  token_enc:    tokenEnc,
                  created_at:   now,
                  updated_at:   now,
                })
                .select("id")
                .single();
              accountRowId = inserted?.id ?? null;
            }

            // Fire a background sync so live data appears straight away
            if (accountRowId) {
              const { syncAdAccountById } = await import("@/lib/growthmind/growthmind.ads-sync.server");
              syncAdAccountById(accountRowId, state.workspaceId).catch(() => {});
            }
          } catch {
            // Account row failure is non-fatal — provider_settings already updated
          }
        }

        return redirectBack(returnTo, { gads: "connected" });
      },
    },
  },
});
