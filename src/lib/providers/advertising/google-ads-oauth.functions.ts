// ── Google Ads "Connect with Google" OAuth flow ───────────────────────────────
// Server functions used by both the Universal Provider Framework advertising
// setup page and the GrowthMind ads setup page.
//
// Flow:
//   1. startGoogleAdsOAuth — saves any supplied clientId/clientSecret/etc into
//      provider_settings, then returns the Google consent URL with an
//      HMAC-signed state blob (workspaceId, source, ts, returnTo…).
//   2. Google redirects to /api/oauth/google-ads-callback (see route file),
//      which verifies the state, exchanges the code for a refresh token and
//      stores it (provider_settings + optional growthmind_ads_accounts row).

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { upsertProviderSetting } from "../usage.server";

export const GOOGLE_ADS_OAUTH_SCOPE = "https://www.googleapis.com/auth/adwords";
export const GOOGLE_ADS_CALLBACK_PATH = "/api/oauth/google-ads-callback";

/** A safe in-app relative path: starts with exactly one "/" (blocks "//evil.com"). */
export function isSafeRelativePath(p: string): boolean {
  return typeof p === "string" && p.startsWith("/") && !p.startsWith("//") && !p.startsWith("/\\");
}

/** Origins we are willing to use as the OAuth redirect_uri base. */
export function isAllowedOAuthOrigin(origin: string): boolean {
  let host: string;
  try {
    const u = new URL(origin);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    if (u.pathname !== "/" || u.search || u.hash || u.username || u.password) return false;
    host = u.hostname.toLowerCase();
  } catch {
    return false;
  }
  const allowed = new Set<string>([
    "webeereceptionist.com",
    "www.webeereceptionist.com",
    "webespokeai.com",
    "www.webespokeai.com",
    "localhost",
    "127.0.0.1",
  ]);
  const devDomain = process.env.REPLIT_DEV_DOMAIN?.toLowerCase();
  if (devDomain) allowed.add(devDomain);
  return allowed.has(host) || host.endsWith(".replit.app") || host.endsWith(".replit.dev");
}

// ── HMAC-signed state helpers (shared with the callback route) ────────────────

async function getStateSecret(): Promise<string> {
  const { createHash } = await import("crypto");
  const raw = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "gads-oauth-fallback";
  return createHash("sha256").update(`${raw}:google-ads-oauth-state`).digest("hex");
}

export interface GoogleAdsOAuthState {
  workspaceId: string;
  userId:      string;
  source:      "provider" | "growthmind";
  customerId?: string;
  label?:      string;
  returnTo:    string;
  origin:      string;
  ts:          number;
}

export async function signOAuthState(state: GoogleAdsOAuthState): Promise<string> {
  const { createHmac } = await import("crypto");
  const secret  = await getStateSecret();
  const payload = Buffer.from(JSON.stringify(state)).toString("base64url");
  const sig     = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export async function verifyOAuthState(raw: string): Promise<GoogleAdsOAuthState | null> {
  try {
    const { createHmac, timingSafeEqual } = await import("crypto");
    const [payload, sig] = raw.split(".");
    if (!payload || !sig) return null;
    const secret   = await getStateSecret();
    const expected = createHmac("sha256", secret).update(payload).digest("base64url");
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const state = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as GoogleAdsOAuthState;
    // 15 minute expiry
    if (!state.ts || Date.now() - state.ts > 15 * 60 * 1000) return null;
    if (!state.workspaceId || !state.source) return null;
    return state;
  } catch {
    return null;
  }
}

// ── Read current OAuth readiness for the workspace ────────────────────────────

export const getGoogleAdsOAuthStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const sb = context.supabase as any;

    const { data } = await sb
      .from("provider_settings")
      .select("status, credentials")
      .eq("workspace_id", workspaceId)
      .eq("provider_category", "advertising")
      .eq("provider_name", "google_ads")
      .maybeSingle();

    const creds = (data?.credentials ?? {}) as Record<string, string>;
    return {
      hasClientId:       !!creds.clientId,
      hasClientSecret:   !!creds.clientSecret,
      hasDeveloperToken: !!creds.developerToken,
      hasRefreshToken:   !!creds.refreshToken,
      hasCustomerId:     !!creds.customerId,
      status:            (data?.status as string) ?? "disconnected",
      callbackPath:      GOOGLE_ADS_CALLBACK_PATH,
    };
  });

// ── Start the OAuth flow ───────────────────────────────────────────────────────

const StartInput = z.object({
  source:         z.enum(["provider", "growthmind"]),
  origin:         z.string().url().max(300),
  returnTo:       z.string().min(1).max(300).refine(isSafeRelativePath, "returnTo must be a relative in-app path"),
  // Optional credentials supplied inline (saved before redirecting)
  clientId:       z.string().max(300).optional(),
  clientSecret:   z.string().max(300).optional(),
  developerToken: z.string().max(300).optional(),
  customerId:     z.string().max(60).optional(),
  managerId:      z.string().max(60).optional(),
  label:          z.string().max(120).optional(),
});

export const startGoogleAdsOAuth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: z.infer<typeof StartInput>) => StartInput.parse(i))
  .handler(async ({ data, context }) => {
    const workspaceId = context.workspaceId;
    const userId      = context.userId;
    if (!workspaceId) throw new Error("No workspace");

    if (!isAllowedOAuthOrigin(data.origin)) {
      throw new Error("This app origin is not allowed for Google sign-in.");
    }

    // Admin-only — mirrors saveProviderCredentials
    const { data: member } = await (context.supabase as any)
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .maybeSingle();
    if (member?.role !== "owner" && member?.role !== "admin") {
      throw new Error("Only workspace owners and admins can connect Google Ads.");
    }

    const sb = context.supabase as any;

    // Read existing credentials so we can merge
    const { data: existing } = await sb
      .from("provider_settings")
      .select("credentials")
      .eq("workspace_id", workspaceId)
      .eq("provider_category", "advertising")
      .eq("provider_name", "google_ads")
      .maybeSingle();

    const creds: Record<string, string> = { ...((existing?.credentials as Record<string, string>) ?? {}) };
    if (data.clientId?.trim())       creds.clientId       = data.clientId.trim();
    if (data.clientSecret?.trim())   creds.clientSecret   = data.clientSecret.trim();
    if (data.developerToken?.trim()) creds.developerToken = data.developerToken.trim();
    if (data.customerId?.trim())     creds.customerId     = data.customerId.trim();
    if (data.managerId?.trim())      creds.managerId      = data.managerId.trim();

    if (!creds.clientId || !creds.clientSecret) {
      throw new Error("Missing Google OAuth Client ID / Client Secret. Enter them first (from your Google Cloud console), then click Connect with Google.");
    }

    // Persist merged credentials (keeps status if already connected)
    await upsertProviderSetting({
      workspaceId,
      category: "advertising",
      providerName: "google_ads",
      credentials: creds,
    });

    const state = await signOAuthState({
      workspaceId,
      userId,
      source:     data.source,
      customerId: data.customerId?.trim() || creds.customerId || undefined,
      label:      data.label?.trim() || undefined,
      returnTo:   data.returnTo,
      origin:     data.origin,
      ts:         Date.now(),
    });

    const redirectUri = `${data.origin}${GOOGLE_ADS_CALLBACK_PATH}`;
    const params = new URLSearchParams({
      client_id:     creds.clientId,
      redirect_uri:  redirectUri,
      response_type: "code",
      scope:         GOOGLE_ADS_OAUTH_SCOPE,
      access_type:   "offline",
      prompt:        "consent",
      state,
    });

    return {
      url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
      redirectUri,
    };
  });
