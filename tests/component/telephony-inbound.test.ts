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
  it("accepts when the subaccount resolves and the signature is valid", async () => {
    const resolveSubaccount = vi.fn().mockResolvedValue({ accountSid: "ACsub", authToken: FAKE_TOKEN });
    const sig = computeTwilioSignature(FAKE_TOKEN, URL, PARAMS);
    const request = fakeRequest({ "X-Twilio-Signature": sig, host: "webee.example.com" });

    const result = await resolveAndVerifyInboundSignature("ws-1", request, PARAMS, resolveSubaccount);

    expect(result).toEqual({ ok: true });
    expect(resolveSubaccount).toHaveBeenCalledWith({}, "ws-1");
  });

  it("rejects with invalid_signature when the subaccount resolves but the signature is wrong", async () => {
    const resolveSubaccount = vi.fn().mockResolvedValue({ accountSid: "ACsub", authToken: FAKE_TOKEN });
    const request = fakeRequest({ "X-Twilio-Signature": "not-a-real-signature", host: "webee.example.com" });

    const result = await resolveAndVerifyInboundSignature("ws-1", request, PARAMS, resolveSubaccount);

    expect(result).toEqual({ ok: false, reason: "invalid_signature" });
  });

  it("fails closed with credentials_unavailable when subaccount resolution throws — never falls back, never skips verification", async () => {
    const resolveSubaccount = vi.fn().mockRejectedValue(new Error("no subaccount for this workspace"));
    // Even a perfectly well-formed signature must not matter here — resolution
    // failing must short-circuit before verification is ever attempted.
    const request = fakeRequest({ "X-Twilio-Signature": "irrelevant", host: "webee.example.com" });

    const result = await resolveAndVerifyInboundSignature("ws-missing", request, PARAMS, resolveSubaccount);

    expect(result).toEqual({ ok: false, reason: "credentials_unavailable" });
  });

  it("fails closed even with no signature header at all, once credentials are available", async () => {
    const resolveSubaccount = vi.fn().mockResolvedValue({ accountSid: "ACsub", authToken: FAKE_TOKEN });
    const request = fakeRequest({ host: "webee.example.com" }); // no X-Twilio-Signature header

    const result = await resolveAndVerifyInboundSignature("ws-1", request, PARAMS, resolveSubaccount);

    expect(result).toEqual({ ok: false, reason: "invalid_signature" });
  });
});
