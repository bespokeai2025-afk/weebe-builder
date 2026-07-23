/**
 * Google Ads OAuth token-refresh acceptance test.
 *
 * Spec requirement: "Add a test that deliberately expires the stored access
 * token and confirms that WEBEE uses the refresh token to generate a new one
 * and completes the campaign sync without user interaction."
 *
 * Google's token endpoint is mocked (no live Google account is required), but
 * the real getGadsAccessToken code path — cache expiry, single-flight refresh,
 * revoked-token classification — is exercised end to end.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __expireGadsTokenCache,
  getGadsAccessToken,
  GADS_API_VERSION,
  normalizeGadsCustomerId,
  parseGoogleAdsFailure,
  type GadsCreds,
} from "@/lib/growthmind/gads-live-core.server";

const WS = "00000000-0000-4000-8000-00000000e2e1";
const creds: GadsCreds = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  developerToken: "test-dev-token",
  refreshToken: "test-refresh-token",
};

const realFetch = globalThis.fetch;
let tokenCalls: Array<Record<string, string>> = [];
let nextToken = 0;
let failWith: null | { status: number; body: any } = null;

function mockTokenEndpoint() {
  tokenCalls = [];
  nextToken = 0;
  failWith = null;
  globalThis.fetch = vi.fn(async (url: any, init?: any) => {
    if (String(url).includes("oauth2.googleapis.com/token")) {
      const params = Object.fromEntries(new URLSearchParams(String(init?.body)));
      tokenCalls.push(params);
      if (failWith) {
        return new Response(JSON.stringify(failWith.body), { status: failWith.status });
      }
      nextToken += 1;
      return new Response(
        JSON.stringify({ access_token: `fresh-token-${nextToken}`, expires_in: 3600, token_type: "Bearer" }),
        { status: 200 },
      );
    }
    return realFetch(url, init);
  }) as any;
}

describe("Google Ads token refresh (deliberately expired access token)", () => {
  beforeEach(() => {
    __expireGadsTokenCache();
    mockTokenEndpoint();
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    __expireGadsTokenCache();
  });

  it("mints a new access token from the refresh token after the cached one is expired", async () => {
    // First acquisition: refresh grant is used with the stored refresh token.
    const t1 = await getGadsAccessToken(WS, creds);
    expect(t1).toBe("fresh-token-1");
    expect(tokenCalls).toHaveLength(1);
    expect(tokenCalls[0].grant_type).toBe("refresh_token");
    expect(tokenCalls[0].refresh_token).toBe("test-refresh-token");

    // Cached: no second network call while the token is still valid.
    const t1again = await getGadsAccessToken(WS, creds);
    expect(t1again).toBe("fresh-token-1");
    expect(tokenCalls).toHaveLength(1);

    // Deliberately expire the stored access token — the next request must
    // transparently mint a NEW access token using the refresh token, with no
    // user interaction.
    __expireGadsTokenCache(WS);
    const t2 = await getGadsAccessToken(WS, creds);
    expect(t2).toBe("fresh-token-2");
    expect(tokenCalls).toHaveLength(2);
    expect(tokenCalls[1].grant_type).toBe("refresh_token");
  });

  it("coalesces concurrent refreshes into a single token request (single-flight)", async () => {
    const results = await Promise.all([
      getGadsAccessToken(WS, creds),
      getGadsAccessToken(WS, creds),
      getGadsAccessToken(WS, creds),
      getGadsAccessToken(WS, creds),
    ]);
    expect(new Set(results).size).toBe(1);
    expect(tokenCalls).toHaveLength(1);
  });

  it("classifies invalid_grant as revoked (reconnection required), not a transient error", async () => {
    failWith = { status: 400, body: { error: "invalid_grant", error_description: "Token has been expired or revoked." } };
    await expect(getGadsAccessToken(WS, creds)).rejects.toThrow(/GADS_TOKEN_REVOKED/);
    // A failed refresh must not poison the cache: after reconnect (working
    // endpoint again), a fresh token is minted.
    failWith = null;
    const t = await getGadsAccessToken(WS, creds);
    expect(t).toMatch(/^fresh-token-/);
  });
});

describe("Google Ads API version + identifier hygiene", () => {
  it("uses a supported API version (v20 was sunset by Google)", () => {
    const n = Number(GADS_API_VERSION.replace(/^v/, ""));
    expect(Number.isFinite(n)).toBe(true);
    expect(n).toBeGreaterThanOrEqual(21);
  });

  it("never accepts an email or connected identity as a customer ID", () => {
    expect(normalizeGadsCustomerId("admin@webespokeai.com")).toBeNull();
    expect(normalizeGadsCustomerId("pending-selection")).toBeNull();
    expect(normalizeGadsCustomerId("")).toBeNull();
    expect(normalizeGadsCustomerId(null)).toBeNull();
  });

  it("normalises hyphens, spaces and customers/ prefixes to bare digits", () => {
    expect(normalizeGadsCustomerId("123-456-7890")).toBe("1234567890");
    expect(normalizeGadsCustomerId("customers/1234567890")).toBe("1234567890");
    expect(normalizeGadsCustomerId(" 123 456 7890 ")).toBe("1234567890");
    expect(normalizeGadsCustomerId("1234567890")).toBe("1234567890");
  });

  it("extracts GoogleAdsFailure error codes, messages and requestId", () => {
    const body = JSON.stringify({
      error: {
        code: 400, status: "INVALID_ARGUMENT", message: "Request contains an invalid argument.",
        details: [{
          "@type": "type.googleapis.com/google.ads.googleads.v20.errors.GoogleAdsFailure",
          errors: [{ errorCode: { requestError: "UNSUPPORTED_VERSION" }, message: "Version v20 is deprecated. Requests to this version will be blocked." }],
          requestId: "abc123",
        }],
      },
    });
    const parsed = parseGoogleAdsFailure(body);
    expect(parsed.codes).toContain("requestError:UNSUPPORTED_VERSION");
    expect(parsed.messages[0]).toMatch(/deprecated/);
    expect(parsed.requestId).toBe("abc123");
  });
});
