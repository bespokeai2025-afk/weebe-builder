import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  resolveAndVerifyInboundSignature,
  verifyTwilioSignature,
} from "@/routes/api/public/telephony/inbound";

// Fake Twilio Account SIDs/tokens below are not real credentials — they exist
// only to prove the code paths under test and are never asserted in a way
// that would matter if leaked. No real Twilio API calls are made.

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));

/** Same HMAC construction as verifyTwilioSignature, used to produce a genuinely valid test signature. */
function computeTwilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const sortedKeys = Object.keys(params).sort();
  const data = sortedKeys.reduce((acc, k) => acc + k + params[k], url);
  return createHmac("sha1", authToken).update(data).digest("base64");
}

const FAKE_TOKEN = "fake_subaccount_token_for_tests_only";
const URL = "https://webee.example.com/api/public/telephony/inbound";
const PARAMS = { CallSid: "CAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", To: "+15551234567", From: "+15559876543" };

function fakeRequest(headers: Record<string, string>): Request {
  return new Request(URL, { method: "POST", headers });
}

describe("verifyTwilioSignature", () => {
  it("accepts a correctly computed signature", () => {
    const sig = computeTwilioSignature(FAKE_TOKEN, URL, PARAMS);
    expect(verifyTwilioSignature(FAKE_TOKEN, sig, URL, PARAMS)).toBe(true);
  });

  it("rejects a signature computed with the wrong token", () => {
    const sig = computeTwilioSignature("a_different_token", URL, PARAMS);
    expect(verifyTwilioSignature(FAKE_TOKEN, sig, URL, PARAMS)).toBe(false);
  });

  it("rejects a signature computed for different params (tampered request)", () => {
    const sig = computeTwilioSignature(FAKE_TOKEN, URL, PARAMS);
    const tamperedParams = { ...PARAMS, To: "+19995550000" };
    expect(verifyTwilioSignature(FAKE_TOKEN, sig, URL, tamperedParams)).toBe(false);
  });

  it("rejects a missing signature header", () => {
    expect(verifyTwilioSignature(FAKE_TOKEN, null, URL, PARAMS)).toBe(false);
  });
});

describe("resolveAndVerifyInboundSignature", () => {
  // The number may live in a WEBEE subaccount, the workspace's own Twilio account, or the platform
  // account — the request is accepted only if one of those accounts' tokens produced the signature.
  it("accepts when the signature matches one of the workspace's Twilio accounts", async () => {
    const candidates = vi.fn().mockResolvedValue(["other_account_token", FAKE_TOKEN]);
    const sig = computeTwilioSignature(FAKE_TOKEN, URL, PARAMS);
    const request = fakeRequest({ "X-Twilio-Signature": sig, host: "webee.example.com" });

    const result = await resolveAndVerifyInboundSignature("ws-1", request, PARAMS, candidates);

    expect(result).toEqual({ ok: true });
    expect(candidates).toHaveBeenCalledWith({}, "ws-1");
  });

  it("rejects with invalid_signature when no account's token produced the signature", async () => {
    const candidates = vi.fn().mockResolvedValue([FAKE_TOKEN, "another_token"]);
    const request = fakeRequest({ "X-Twilio-Signature": "not-a-real-signature", host: "webee.example.com" });

    const result = await resolveAndVerifyInboundSignature("ws-1", request, PARAMS, candidates);

    expect(result).toEqual({ ok: false, reason: "invalid_signature" });
  });

  it("fails closed with credentials_unavailable when the workspace has no Twilio account at all", async () => {
    const candidates = vi.fn().mockResolvedValue([]);
    const request = fakeRequest({ "X-Twilio-Signature": "irrelevant", host: "webee.example.com" });

    const result = await resolveAndVerifyInboundSignature("ws-missing", request, PARAMS, candidates);

    expect(result).toEqual({ ok: false, reason: "credentials_unavailable" });
  });

  it("fails closed when looking up the accounts throws — never skips verification", async () => {
    const candidates = vi.fn().mockRejectedValue(new Error("db down"));
    const sig = computeTwilioSignature(FAKE_TOKEN, URL, PARAMS);
    const request = fakeRequest({ "X-Twilio-Signature": sig, host: "webee.example.com" });

    const result = await resolveAndVerifyInboundSignature("ws-1", request, PARAMS, candidates);

    expect(result).toEqual({ ok: false, reason: "credentials_unavailable" });
  });

  it("fails closed with no signature header at all", async () => {
    const candidates = vi.fn().mockResolvedValue([FAKE_TOKEN]);
    const request = fakeRequest({ host: "webee.example.com" }); // no X-Twilio-Signature header

    const result = await resolveAndVerifyInboundSignature("ws-1", request, PARAMS, candidates);

    expect(result).toEqual({ ok: false, reason: "invalid_signature" });
  });
});
