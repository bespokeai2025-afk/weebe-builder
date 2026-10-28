/**
 * call_d432d4a7887e6d9443e8dba836d (28 Oct): the caller booked on a lead Dynamics already had as
 * Qualified. Allen's Logic asked to reopen it, Dynamics refused the whole PATCH ("You do not have
 * the correct permissions to reactivate leads"), and the run stopped — no address, appointment,
 * summary, timeline note, dashboard post or calls row.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const steps = vi.hoisted(() => ({ allens: async (): Promise<void> => {} }));

vi.mock("@/lib/providers/crm/adapters/dynamics.adapter", () => ({
  fetchDynamicsAccessToken: vi.fn(async () => "test-token"),
}));
vi.mock("@/lib/automation-engine/plugins/wbah/wbah-step-handlers.server", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/automation-engine/plugins/wbah/wbah-step-handlers.server")>();
  return {
    ...real,
    wbahStepFormatData: () => ({ hasBookingSlot: false, structuredJsonOutput: null }),
    wbahStepCalendlyLink: async () => null,
    wbahStepDynamicsAllens: async () => steps.allens(),
  };
});

import {
  applyAllensLogicV5,
  WBAH_DYNAMICS_STATE_QUALIFIED,
} from "@/lib/wbah/post-call/wbah-allens-logic.shared";
import { buildWbahAllensCrmPayload } from "@/lib/wbah/post-call/wbah-crm-payload.shared";
import { isStateChangeRefused, patchWbahLead } from "@/lib/wbah/post-call/wbah-dynamics.server";
import { WBAH_NODE_DEFINITIONS } from "@/lib/automation-engine/plugins/wbah/register-wbah-nodes";
import type { NodeContext } from "@/lib/automation-engine/types/node.types";

const LOGGED = 100000008;
const booked = {
  userSentiment: "Positive",
  calendlyBookingUrl: "https://calendly.com/d/abc/slot",
  appointmentBooked: true,
  existingCurrentStatus: LOGGED,
  callSummary: "Booked a consultation for Wednesday.",
};

describe("Allen's Logic on a lead that is already Qualified", () => {
  it("leaves its state and status alone instead of reopening it", () => {
    const result = applyAllensLogicV5({ ...booked, existingStateCode: WBAH_DYNAMICS_STATE_QUALIFIED });
    expect(result.newCurrentStatus).toBeNull();
    expect(result.skipStatecodeUpdate).toBe(true);
    expect(result.allenLogicResult).toMatch(/already Qualified/);

    const payload = buildWbahAllensCrmPayload({
      formatted: {
        hasBookingSlot: true,
        requestedStartUtc: "2026-10-28T12:25:00.000Z",
        appointmentDate: "2026-10-28",
        userSentiment: "Positive",
        callSummary: "Booked",
      } as any,
      allens: result,
      calendlyBookingUrl: booked.calendlyBookingUrl,
      callbackUtc: null,
    });
    expect(payload).not.toHaveProperty("statecode");
    expect(payload).not.toHaveProperty("new_currentstatus");
    expect(payload).toMatchObject({
      cos_appointment_date: "2026-10-28",
      cos_calendly_booking_url: booked.calendlyBookingUrl,
    });
  });

  it("still reopens and logs an open lead that books", () => {
    const result = applyAllensLogicV5({ ...booked, existingCurrentStatus: null, existingStateCode: 0 });
    expect(result.newCurrentStatus).toBe(LOGGED);
    expect(result.statecodeOverride).toBe(0);
    expect(result.skipStatecodeUpdate).toBe(false);
  });
});

describe("Dynamics refuses a state change", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("recognises the refusals seen in production", () => {
    expect(isStateChangeRefused('{"error":{"message":"You do not have the correct permissions to reactivate leads"}}')).toBe(true);
    expect(isStateChangeRefused('{"error":{"message":"You cannot re-open a qualified Lead. If you t…"}}')).toBe(true);
    expect(isStateChangeRefused('{"error":{"message":"A validation error occurred."}}')).toBe(false);
  });

  it("writes the call's other fields without the state change", async () => {
    vi.stubEnv("DYNAMICS_TENANT_ID", "t");
    vi.stubEnv("DYNAMICS_CLIENT_ID", "c");
    vi.stubEnv("DYNAMICS_CLIENT_SECRET", "s");
    vi.stubEnv("DYNAMICS_ORG_URL", "https://org.example.com");
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        bodies.push(body);
        return "statecode" in body
          ? new Response(
              '{"error":{"code":"0x80040265","message":"You do not have the correct permissions to reactivate leads"}}',
              { status: 400 },
            )
          : new Response("{}", { status: 200 });
      }),
    );

    await patchWbahLead("lead-1", {
      statecode: 0,
      new_currentstatus: LOGGED,
      new_propinfo_sameascontactaddress: true,
      address1_line1: "37-39 Saint John's Street",
      cos_appointment_date: "2026-10-28",
    });

    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toEqual({
      new_propinfo_sameascontactaddress: true,
      address1_line1: "37-39 Saint John's Street",
      cos_appointment_date: "2026-10-28",
    });
  });
});

describe("a refused WBAH step does not stop the run", () => {
  const allensNode = WBAH_NODE_DEFINITIONS.find((d) => d.type === "wbah.dynamics_allens")!;
  let n = 0;
  const ctx = (): NodeContext =>
    ({
      workflowId: "wf",
      executionId: `exec-${++n}`,
      nodeId: "patch-dynamics-allen",
      nodeType: "wbah.dynamics_allens",
      config: {},
      input: {
        json: {
          event: "call_analyzed",
          call: {
            call_id: "call_1",
            agent_id: "agent_0440750bb59597eef7352901bf",
            retell_llm_dynamic_variables: { lead_id: "lead-1" },
          },
        },
      },
      variables: {},
      globalVariables: {},
      nodeOutputs: {},
      env: {},
      secrets: {},
    }) as unknown as NodeContext;

  afterEach(() => vi.unstubAllEnvs());

  it("records a Dynamics refusal and lets the next steps run", async () => {
    vi.stubEnv("WBAH_POST_CALL_ENABLED", "true");
    steps.allens = async () => {
      throw new Error('Dynamics PATCH lead failed (400): {"error":{"message":"A validation error occurred."}}');
    };
    const result = await allensNode.execute(ctx());
    expect(result.status).toBe("success");
    expect((result.output?.json as Record<string, unknown>)._wbahError).toMatch(/validation error/);
  });

  it("still stops on a temporary failure so the job is retried", async () => {
    vi.stubEnv("WBAH_POST_CALL_ENABLED", "true");
    steps.allens = async () => {
      throw new Error("Dynamics PATCH lead failed (503): Service Unavailable");
    };
    await expect(allensNode.execute(ctx())).rejects.toThrow(/503/);
  });
});
