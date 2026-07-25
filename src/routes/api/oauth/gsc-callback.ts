// GET /api/oauth/gsc-callback — Google Search Console OAuth redirect target.
// Canonical server-side callback (register this exact URI per allowed origin in
// the Google Cloud console). Verifies the HMAC-signed state, exchanges the auth
// code for tokens, stores them in workspace_settings, then redirects back to
// the SEO page with ?gsc=connected|error.
import { createFileRoute } from "@tanstack/react-router";
import { verifyGscState, consumeGscStateNonce, exchangeAndStoreGscCode } from "@/lib/growthmind/growthmind.seo";
import { isSafeRelativePath, isAllowedOAuthOrigin } from "@/lib/providers/advertising/google-ads-oauth.functions";

function redirectBack(returnTo: string, params: Record<string, string>): Response {
  const safePath = isSafeRelativePath(returnTo) ? returnTo : "/growthmind/seo";
  const qs = new URLSearchParams(params).toString();
  const sep = safePath.includes("?") ? "&" : "?";
  return new Response(null, {
    status: 302,
    headers: { Location: `${safePath}${sep}${qs}` },
  });
}

export const Route = createFileRoute("/api/oauth/gsc-callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url      = new URL(request.url);
        const code     = url.searchParams.get("code");
        const rawState = url.searchParams.get("state");
        const oauthErr = url.searchParams.get("error");

        const fallback = "/growthmind/seo";

        if (!rawState) return redirectBack(fallback, { gsc: "error", gsc_msg: "Missing state" });

        const state = await verifyGscState(rawState);
        if (!state) return redirectBack(fallback, { gsc: "error", gsc_msg: "Invalid or expired sign-in link. Please try connecting again." });

        const returnTo = isSafeRelativePath(state.returnTo) ? state.returnTo : fallback;
        if (!(await consumeGscStateNonce(state.nonce))) {
          return redirectBack(returnTo, { gsc: "error", gsc_msg: "This sign-in link was already used. Please try connecting again." });
        }
        if (!isAllowedOAuthOrigin(state.origin)) {
          return redirectBack(returnTo, { gsc: "error", gsc_msg: "Sign-in origin not allowed." });
        }

        if (oauthErr) {
          return redirectBack(returnTo, { gsc: "error", gsc_msg: oauthErr === "access_denied" ? "Google sign-in was cancelled." : `Google error: ${oauthErr}` });
        }
        if (!code) return redirectBack(returnTo, { gsc: "error", gsc_msg: "Google did not return an authorisation code." });

        try {
          await exchangeAndStoreGscCode({
            workspaceId: state.workspaceId,
            code,
            origin: state.origin,
          });
        } catch (e: any) {
          return redirectBack(returnTo, { gsc: "error", gsc_msg: String(e?.message ?? e).slice(0, 160) });
        }

        return redirectBack(returnTo, { gsc: "connected" });
      },
    },
  },
});
