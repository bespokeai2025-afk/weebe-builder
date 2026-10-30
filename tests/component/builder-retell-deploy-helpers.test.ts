/**
 * Retell deploy helpers: what the builder sends Retell, and how it checks what Retell stored.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
vi.mock("@/lib/calendar/booking-tools.server", () => ({ buildBookingTools: () => [] }));
vi.mock("@/lib/deploy/config.server", () => ({ getRetailRetellApiKey: () => process.env.TEST_RETAIL_KEY ?? "" }));

import {
  READONLY_KEYS,
  readProductionRetellApiKey,
  redactRetellPayload,
  resolveProductionApiKey,
  sanitizeRetellConversationFlow,
  stripKeys,
  transferSchemaMismatches,
} from "@/lib/builder/retell-deploy-helpers.server";

afterEach(() => vi.unstubAllEnvs());

describe("sanitizeRetellConversationFlow", () => {
  it("turns our hybrid nodes into a Retell prompt that says the exact line first", () => {
    const out = sanitizeRetellConversationFlow({
      nodes: [{ id: "n1", instruction: { type: "hybrid", prefix: "Hi, it's Clare.", text: "Ask about the property." } }],
    }) as { nodes: Array<Record<string, any>> };
    expect(out.nodes[0]).toMatchObject({
      response_mode: "llm",
      instruction: {
        type: "prompt",
        text: 'First say exactly this (do not rephrase): "Hi, it\'s Clare."\nThen:\nAsk about the property.',
      },
    });
    expect(out.nodes[0]!.instruction.prefix).toBeUndefined();
  });

  it("turns template nodes into static text", () => {
    const out = sanitizeRetellConversationFlow({
      nodes: [{ id: "n1", response_mode: "template", instruction: { type: "template", text: "Goodbye." } }],
    }) as { nodes: Array<Record<string, any>> };
    expect(out.nodes[0]).toMatchObject({ response_mode: "static", instruction: { type: "static_text", text: "Goodbye." } });
  });

  it("leaves other nodes and odd entries alone", () => {
    const prompt = { id: "p", instruction: { type: "prompt", text: "x" } };
    const out = sanitizeRetellConversationFlow({ nodes: [prompt, null, { id: "e" }], start: "p" });
    expect(out).toEqual({ nodes: [prompt, null, { id: "e" }], start: "p" });
  });
});

describe("stripKeys", () => {
  it("drops read-only Retell fields and empty values", () => {
    expect(
      stripKeys({ agent_id: "a", version: 3, voice_id: "v", language: null, webhook_url: undefined }, READONLY_KEYS),
    ).toEqual({ voice_id: "v" });
  });
});

describe("redactRetellPayload", () => {
  it("hides keys, tokens and secrets at any depth", () => {
    expect(
      redactRetellPayload({
        api_key: "k",
        nested: { Authorization: "Bearer x", list: [{ client_secret: "s", ok: 1 }] },
        voice_id: "v",
      }),
    ).toEqual({
      api_key: "[REDACTED]",
      nested: { Authorization: "[REDACTED]", list: [{ client_secret: "[REDACTED]", ok: 1 }] },
      voice_id: "v",
    });
  });
});

describe("transferSchemaMismatches", () => {
  it("fails on a changed destination, warns on optional fields, ignores Retell's own defaults", () => {
    const sent = { type: "transfer_call", transfer_destination: { number: "+441" }, transfer_option: { type: "cold" } };
    const stored = {
      type: "transfer_call",
      transfer_destination: { number: "+442" },
      transfer_option: { type: "warm" },
      ring_duration_ms: 30000,
    };
    expect(transferSchemaMismatches(sent, stored)).toEqual({ hard: ["transfer_destination"], soft: ["transfer_option"] });
    expect(transferSchemaMismatches(sent, { ...sent, ring_duration_ms: 30000 })).toEqual({ hard: [], soft: [] });
  });
});

describe("production API key", () => {
  it("uses the key given, then the retail key, else asks for one", () => {
    expect(resolveProductionApiKey("  key_given ")).toBe("key_given");
    vi.stubEnv("TEST_RETAIL_KEY", "key_retail");
    expect(resolveProductionApiKey(undefined)).toBe("key_retail");
    vi.stubEnv("TEST_RETAIL_KEY", "");
    expect(() => resolveProductionApiKey("")).toThrow(/production Retell API key is required/);
  });

  it("reads the key saved on the agent's settings", () => {
    expect(readProductionRetellApiKey({ productionRetellApiKey: " k " })).toBe("k");
    expect(readProductionRetellApiKey({ productionRetellApiKey: "" })).toBeNull();
    expect(readProductionRetellApiKey(null)).toBeNull();
  });
});
