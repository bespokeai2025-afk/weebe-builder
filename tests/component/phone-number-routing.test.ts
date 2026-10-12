import { describe, expect, it, vi } from "vitest";
import {
  agentsOnNumber,
  chooseInboundAgent,
  chooseOutboundAgent,
  countriesForE164,
  isCountryAllowed,
  normaliseAgentWeights,
  parseInboundWebhookResponse,
  pickWeightedAgent,
  validateAgentWeights,
  validateWebhookUrl,
} from "@/lib/telephony/number-routing.shared";
import { buildUnansweredCallEvents } from "@/lib/telephony/unanswered-call.server";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const C = "33333333-3333-3333-3333-333333333333";

describe("weighted agents", () => {
  it("drops invalid rows and rescales weights to sum to 1", () => {
    expect(
      normaliseAgentWeights([
        { agent_id: A, weight: 30 },
        { agent_id: B, weight: 70 },
        { agent_id: "", weight: 10 },
        { agent_id: C, weight: 0 },
        { agent_id: A, weight: 50 }, // duplicate
      ]),
    ).toEqual([
      { agent_id: A, weight: 0.3 },
      { agent_id: B, weight: 0.7 },
    ]);
    expect(normaliseAgentWeights(null)).toEqual([]);
    expect(normaliseAgentWeights("x")).toEqual([]);
  });

  it("picks by weight", () => {
    const list = [
      { agent_id: A, weight: 0.25 },
      { agent_id: B, weight: 0.75 },
    ];
    expect(pickWeightedAgent(list, () => 0.1)).toBe(A);
    expect(pickWeightedAgent(list, () => 0.3)).toBe(B);
    expect(pickWeightedAgent(list, () => 0.9999)).toBe(B);
    expect(pickWeightedAgent([], () => 0.5)).toBeNull();
  });

  it("falls back to the number's assigned agent when there is no list", () => {
    expect(chooseInboundAgent({ agent_id: A })).toBe(A);
    expect(chooseOutboundAgent({ agent_id: A, outbound_agents: [{ agent_id: B, weight: 1 }] })).toBe(B);
    expect(chooseInboundAgent({ agent_id: null })).toBeNull();
    expect(agentsOnNumber({ agent_id: A, outbound_agents: [{ agent_id: B, weight: 1 }] }, "outbound")).toEqual([B]);
    expect(agentsOnNumber({ agent_id: A }, "inbound")).toEqual([A]);
  });

  it("validates the form's rows", () => {
    expect(validateAgentWeights([{ agent_id: A, weight: 50 }, { agent_id: A, weight: 50 }])).toMatch(/once/);
    expect(validateAgentWeights([{ agent_id: A, weight: 0 }])).toMatch(/more than 0/);
    expect(validateAgentWeights([{ agent_id: "", weight: 1 }])).toMatch(/Choose/);
    expect(validateAgentWeights([{ agent_id: A, weight: 60 }, { agent_id: B, weight: 40 }])).toBeNull();
  });
});

describe("countries", () => {
  it.each([
    ["+447700900123", ["GB", "GG", "JE", "IM"]],
    ["+353871234567", ["IE"]],
    ["+919737807299", ["IN"]],
    ["+971501234567", ["AE"]],
    ["+12025550123", expect.arrayContaining(["US", "CA"])],
    ["+79161234567", ["RU", "KZ"]],
  ])("%s", (phone, expected) => {
    expect(countriesForE164(phone)).toEqual(expected);
  });

  it("returns nothing for junk", () => {
    expect(countriesForE164("")).toEqual([]);
    expect(countriesForE164("abc")).toEqual([]);
  });

  it("allows everything with an empty list and refuses unknown numbers with a list", () => {
    expect(isCountryAllowed(null, ["IN"])).toBe(true);
    expect(isCountryAllowed([], [])).toBe(true);
    expect(isCountryAllowed(["gb"], ["GB", "JE"])).toBe(true);
    expect(isCountryAllowed(["GB"], ["IN"])).toBe(false);
    expect(isCountryAllowed(["GB"], [])).toBe(false);
  });
});

describe("inbound webhook replies", () => {
  it("reads Retell's call_inbound shape", () => {
    expect(
      parseInboundWebhookResponse({
        call_inbound: {
          override_agent_id: "agent_abc",
          dynamic_variables: { first_name: "Jane", visits: 3, skip: { nested: true }, empty: null },
          metadata: { crm_id: 7 },
        },
      }),
    ).toEqual({
      reject: false,
      overrideAgentId: "agent_abc",
      dynamicVariables: { first_name: "Jane", visits: "3" },
      metadata: { crm_id: 7 },
    });
  });

  it("accepts the fields at the top level, and reject", () => {
    expect(parseInboundWebhookResponse({ reject: true }).reject).toBe(true);
    expect(parseInboundWebhookResponse({ dynamic_variables: { a: "1" } }).dynamicVariables).toEqual({ a: "1" });
    expect(parseInboundWebhookResponse("nonsense")).toEqual({
      reject: false,
      overrideAgentId: null,
      dynamicVariables: {},
      metadata: {},
    });
  });

  it("requires https webhook URLs", () => {
    expect(validateWebhookUrl("http://x.test/a")).toMatch(/https/);
    expect(validateWebhookUrl("not a url")).toMatch(/full URL/);
    expect(validateWebhookUrl("https://x.test/a")).toBeNull();
    expect(validateWebhookUrl("")).toBeNull();
  });
});

/** Minimal stand-in for the Supabase query builder used by resolveOverrideAgent. */
function fakeSb(agents: Array<{ id: string; workspace_id: string; retell_agent_id?: string | null; settings?: unknown }>) {
  return {
    from(table: string) {
      expect(table).toBe("agents");
      const filters: Record<string, unknown> = {};
      const builder: any = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          filters[col] = val;
          return builder;
        },
        maybeSingle: async () => ({
          data: agents.find((a) => a.id === filters.id && a.workspace_id === filters.workspace_id) ?? null,
        }),
        then: (resolve: (v: unknown) => void) =>
          resolve({ data: agents.filter((a) => a.workspace_id === filters.workspace_id) }),
      };
      return builder;
    },
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("decideInboundRouting", async () => {
  const { decideInboundRouting } = await import("@/routes/api/public/telephony/inbound");
  const base = { workspaceId: "ws-1", callSid: "CA1", from: "+447700900123", to: "+441218177178" };
  const sb = fakeSb([
    { id: A, workspace_id: "ws-1", retell_agent_id: "agent_retell_a" },
    { id: B, workspace_id: "ws-1", settings: { deployedRetellAgentId: "agent_deployed_b" } },
    { id: C, workspace_id: "ws-OTHER" },
  ]);

  it("routes to the assigned agent", async () => {
    expect(await decideInboundRouting({ ...base, number: { agent_id: A } }, { sb })).toMatchObject({
      kind: "agent",
      agentId: A,
    });
  });

  it("rejects callers from countries that aren't allowed, using Twilio's FromCountry first", async () => {
    const number = { agent_id: A, allowed_inbound_countries: ["IE"] };
    expect((await decideInboundRouting({ ...base, number }, { sb })).kind).toBe("reject");
    expect(
      (await decideInboundRouting({ ...base, fromCountry: "IE", number }, { sb })).kind,
    ).toBe("agent");
  });

  it("splits calls by weight (A/B)", async () => {
    const number = { agent_id: A, inbound_agents: [{ agent_id: A, weight: 0.5 }, { agent_id: B, weight: 0.5 }] };
    expect(await decideInboundRouting({ ...base, number }, { sb, rand: () => 0.2 })).toMatchObject({ agentId: A });
    expect(await decideInboundRouting({ ...base, number }, { sb, rand: () => 0.8 })).toMatchObject({ agentId: B });
  });

  it("lets the webhook swap the agent (WEBEE or Retell id) and pass variables", async () => {
    const number = { agent_id: A, inbound_webhook_url: "https://crm.test/inbound" };
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ call_inbound: { override_agent_id: "agent_deployed_b", dynamic_variables: { first_name: "Jane" } } }),
    );
    const out = await decideInboundRouting({ ...base, number }, { sb, fetchImpl: fetchImpl as never });
    expect(out).toMatchObject({ kind: "agent", agentId: B, dynamicVariables: { first_name: "Jane" }, webhookUsed: true });
    const sent = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(sent).toEqual({
      event: "call_inbound",
      call_inbound: { call_id: "CA1", agent_id: A, agent_version: null, from_number: base.from, to_number: base.to },
    });
  });

  it("ignores an override that points at another workspace's agent", async () => {
    const number = { agent_id: A, inbound_webhook_url: "https://crm.test/inbound" };
    const fetchImpl = vi.fn(async () => jsonResponse({ call_inbound: { override_agent_id: C } }));
    expect(await decideInboundRouting({ ...base, number }, { sb, fetchImpl: fetchImpl as never })).toMatchObject({
      agentId: A,
    });
  });

  it("rejects when the webhook says so", async () => {
    const number = { agent_id: A, inbound_webhook_url: "https://crm.test/inbound" };
    const fetchImpl = vi.fn(async () => jsonResponse({ call_inbound: { reject: true } }));
    expect((await decideInboundRouting({ ...base, number }, { sb, fetchImpl: fetchImpl as never })).kind).toBe("reject");
  });

  it("retries a failing webhook once, then uses the number's own agent", async () => {
    const number = { agent_id: A, inbound_webhook_url: "https://crm.test/inbound" };
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "down" }, 500));
    const out = await decideInboundRouting({ ...base, number }, { sb, fetchImpl: fetchImpl as never });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(out).toMatchObject({ kind: "agent", agentId: A, webhookUsed: false });
  });

  it("forwards to the fallback number when no agent is assigned", async () => {
    expect(
      await decideInboundRouting({ ...base, number: { agent_id: null, fallback_number: "+447700900999" } }, { sb }),
    ).toMatchObject({ kind: "fallback", number: "+447700900999" });
    expect((await decideInboundRouting({ ...base, number: { agent_id: null } }, { sb })).kind).toBe("message");
  });
});

describe("unanswered outbound calls", () => {
  const row = {
    id: "call-1",
    agent_id: A,
    workspace_id: "ws-1",
    direction: "outbound",
    status: "ringing",
    from_number: "+441218177178",
    to_number: "+447700900123",
    campaign_id: "camp-1",
    started_at: "2026-10-12T10:00:00.000Z",
    metadata: { dynamic_variables: { full_name: "Jane" }, call_metadata: { lead_id: "lead-1" } },
  };

  it("reports no-answer the way the processor recognises it", () => {
    const events = buildUnansweredCallEvents(row, "no-answer", Date.parse("2026-10-12T10:00:30.000Z"));
    expect(events.map((e) => e.event)).toEqual(["call_ended", "call_analyzed"]);
    expect(events[0]!.call).toMatchObject({
      call_id: "call-1",
      call_status: "no_answer",
      disconnection_reason: "dial_no_answer",
      direction: "outbound",
      to_number: "+447700900123",
      metadata: { engine: "webee_native", workspace_id: "ws-1", campaign_id: "camp-1", lead_id: "lead-1" },
      retell_llm_dynamic_variables: { full_name: "Jane" },
    });
    expect(events[1]!.call.call_analysis?.call_successful).toBe(false);
  });

  it("maps busy and failed, and stays silent otherwise", () => {
    expect(buildUnansweredCallEvents(row, "busy")[0]!.call.disconnection_reason).toBe("dial_busy");
    expect(buildUnansweredCallEvents(row, "failed")[0]!.call.disconnection_reason).toBe("dial_failed");
    expect(buildUnansweredCallEvents(row, "completed")).toEqual([]);
    expect(buildUnansweredCallEvents({ ...row, status: "active" }, "no-answer")).toEqual([]);
    // A repeated callback after the first one recorded the failure.
    expect(buildUnansweredCallEvents({ ...row, status: "failed" }, "no-answer")).toEqual([]);
    expect(buildUnansweredCallEvents({ ...row, direction: "inbound" }, "no-answer")).toEqual([]);
    expect(buildUnansweredCallEvents({ ...row, agent_id: null }, "no-answer")).toEqual([]);
  });
});

describe("phone call variables", async () => {
  const { phoneCallSystemVariables, fillKnownVariables } = await import("@/lib/voice/gateway/telephony-core");

  it("names the other party user_number in both directions", () => {
    expect(
      phoneCallSystemVariables({ callId: "c1", direction: "outbound", fromNumber: "+441", toNumber: "+447" }),
    ).toEqual({ call_id: "c1", direction: "outbound", user_number: "+447", agent_number: "+441" });
    expect(
      phoneCallSystemVariables({ callId: "c1", direction: "inbound", fromNumber: "+447", toNumber: "+441" }),
    ).toMatchObject({ user_number: "+447", agent_number: "+441" });
  });

  it("fills only the variables it knows", () => {
    expect(fillKnownVariables("Hi {{ first_name }}, re {{address}}", { first_name: "Jane" })).toBe(
      "Hi Jane, re {{address}}",
    );
  });
});
