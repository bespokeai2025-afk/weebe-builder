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

        // If initiated from GrowthMind, upsert the google growthmind_ads_accounts
        // row honestly: OAuth is now connected, but an advertising account still
        // needs to be selected (via discovery) before anything can sync.
        if (state.source === "growthmind") {
          try {
            const { encryptTokenForAds } = await import("@/lib/growthmind/growthmind.ads");
            const tokenEnc = await encryptTokenForAds(refreshToken);
            const now = new Date().toISOString();

            const { data: existingAcc } = await sb
              .from("growthmind_ads_accounts")
              .select("id, customer_id")
              .eq("workspace_id", state.workspaceId)
              .eq("platform", "google")
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();

            let accountRowId: string | null = null;
            let selectedCustomerId: string | null = existingAcc?.customer_id ?? null;
            if (existingAcc?.id) {
              await sb.from("growthmind_ads_accounts")
                .update({
                  token_enc: tokenEnc, status: "active",
                  connection_state: selectedCustomerId ? "account_selected" : "oauth_connected",
                  sync_error: null, updated_at: now,
                  ...(state.label ? { label: state.label } : {}),
                })
                .eq("id", existingAcc.id);
              accountRowId = existingAcc.id;
            } else {
              const { data: inserted } = await sb.from("growthmind_ads_accounts")
                .insert({
                  workspace_id:     state.workspaceId,
                  platform:         "google",
                  label:            state.label || "Google Ads",
                  account_id:       state.customerId || "pending-selection",
                  status:           "active",
                  connection_state: "oauth_connected",
                  token_enc:        tokenEnc,
                  created_at:       now,
                  updated_at:       now,
                })
                .select("id")
                .single();
              accountRowId = inserted?.id ?? null;
            }

            // If a numeric customer ID was supplied up-front (or already selected),
            // verify + select it and fire the initial sync in the background.
            const candidate = selectedCustomerId ?? (state.customerId && /^[\d-]{5,20}$/.test(state.customerId) ? state.customerId.replace(/-/g, "") : null);
            if (accountRowId && candidate) {
              const { gaqlSearch, runGadsSync } = await import("@/lib/growthmind/gads-live-core.server");
              const wsId = state.workspaceId;
              const rowId = accountRowId;
              (async () => {
                try {
                  const rows = await gaqlSearch(
                    { workspaceId: wsId, customerId: candidate },
                    "SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.manager FROM customer LIMIT 1",
                  );
                  const cust = rows[0]?.customer ?? {};
                  if (!cust.manager) {
                    await sb.from("growthmind_ads_accounts").update({
                      customer_id: candidate, account_id: candidate,
                      descriptive_name: cust.descriptiveName ?? null,
                      currency_code: cust.currencyCode ?? null,
                      time_zone: cust.timeZone ?? null,
                      connection_state: "account_selected",
                      updated_at: new Date().toISOString(),
                    }).eq("id", rowId);
                    await runGadsSync(wsId, rowId, "initial");
                  }
                } catch { /* verification failed — the UI selector will handle it */ }
              })().catch(() => {});
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
