import { describe, expect, it, vi } from "vitest";
import { cleanWbahRawData } from "@/lib/wbah/post-call/wbah-format-data.shared";
import {
  buildWbahCallbackRequestBody,
  formatCallbackDatetimeForBackend,
} from "@/lib/wbah/post-call/wbah-callback-post.shared";
import { formatWbahRetellCallData } from "@/lib/wbah/post-call/wbah-format-data.shared";
import { postWbahCallbackRequest } from "@/lib/wbah/post-call/wbah-webespoke-writer.server";

describe("cleanWbahRawData dynamic variables passthrough", () => {
  it("preserves retell_llm_dynamic_variables including call_source", () => {
    const payload = {
      event: "call_analyzed",
      call: {
        call_id: "call_abc",
        retell_llm_dynamic_variables: {
          lead_id: "lead-1",
          call_source: "callback",
          campaign_id: "camp-9",
          available_slots: [{ date: "2026-08-20", time: "10:00" }],
        },
      },
      available_slots: [{ date: "2026-08-20", time: "10:00" }],
    };

    const cleaned = cleanWbahRawData(payload);
    const dyn = (cleaned.call as Record<string, unknown>).retell_llm_dynamic_variables as Record<
      string,
      unknown
    >;

    expect(dyn.lead_id).toBe("lead-1");
    expect(dyn.call_source).toBe("callback");
    expect(dyn.campaign_id).toBe("camp-9");
    expect(dyn.available_slots).toBeUndefined();
    expect(cleaned.available_slots).toBeUndefined();
  });
});

describe("formatCallbackDatetimeForBackend", () => {
  it("keeps bare London wall-clock time unchanged during BST", () => {
    expect(formatCallbackDatetimeForBackend("2026-08-20 09:30:00")).toBe("2026-08-20 09:30:00");
  });

  it("normalizes date+T time without timezone to London bare format", () => {
    expect(formatCallbackDatetimeForBackend("2026-08-20T09:30:00")).toBe("2026-08-20 09:30:00");
  });

  it("converts UTC ISO to London wall-clock rather than sending UTC bare", () => {
    // 08:30 UTC = 09:30 BST on 2026-08-20
    expect(formatCallbackDatetimeForBackend("2026-08-20T08:30:00.000Z")).toBe(
      "2026-08-20 09:30:00",
    );
  });
});

describe("buildWbahCallbackRequestBody", () => {
  it("builds callback-only payload with stable call_id", () => {
    const formatted = formatWbahRetellCallData({
      dynVars: { lead_id: "lead-99" },
      custom: {
        callback_datetime: "2026-08-20 09:30:00",
        callback_type: "callback_request",
      },
    });

    const body = buildWbahCallbackRequestBody({
      leadId: "lead-99",
      call: {
        call_id: "call_stable_123",
        agent_id: "agent_xyz",
        call_status: "ended",
        call_analysis: { call_summary: "Please call back tomorrow morning" },
      },
      formatted,
    });

    expect(body).toMatchObject({
      is_callback_request: true,
      lead_id: "lead-99",
      call_id: "call_stable_123",
      callback_datetime: "2026-08-20 09:30:00",
      callback_type: "callback_request",
      agent_id: "agent_xyz",
      call_status: "ended",
      crm_status: 1,
    });
    expect(body).not.toHaveProperty("raw_data");
  });
});

describe("postWbahCallbackRequest retry", () => {
  it("retries with the same call_id until success", async () => {
    const attempts: string[] = [];
    const responses = [
      { ok: false, status: 503, data: { success: false } },
      { ok: false, status: 503, data: { success: false } },
      { ok: true, status: 200, data: { success: true, action: "inserted" } },
    ];
    let responseIndex = 0;

    await postWbahCallbackRequest(
      {
        is_callback_request: true,
        lead_id: "lead-1",
        callback_datetime: "2026-08-20 09:30:00",
        callback_type: "callback_request",
        call_id: "call_retry_same",
        agent_id: "agent_1",
        call_status: "ended",
        call_summary: "Callback please",
        crm_status: 1,
      },
      {
        maxAttempts: 5,
        retryDelayMs: () => 0,
        postJson: async (_path, body) => {
          attempts.push(body.call_id);
          return responses[responseIndex++]!;
        },
      },
    );

    expect(attempts).toEqual(["call_retry_same", "call_retry_same", "call_retry_same"]);
    expect(responseIndex).toBe(3);
  });

  it("treats duplicate action as success without further retries", async () => {
    const postJson = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      data: { success: true, action: "duplicate" },
    });

    await postWbahCallbackRequest(
      {
        is_callback_request: true,
        lead_id: "lead-1",
        callback_datetime: "2026-08-20 09:30:00",
        callback_type: "callback_request",
        call_id: "call_dup",
        agent_id: "agent_1",
        call_status: "ended",
        call_summary: "",
        crm_status: 1,
      },
      { postJson },
    );

    expect(postJson).toHaveBeenCalledTimes(1);
  });
});
