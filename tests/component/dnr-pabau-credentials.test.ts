import { describe, expect, it } from "vitest";
import { DNR_RETELL_AGENT_ID } from "@/lib/dnr/dnr-voice.config";
import {
  normalizeDnrRetellAgentId,
  parseDnrRetellAgentId,
} from "@/lib/dnr/dnr-pabau-credentials.server";

describe("normalizeDnrRetellAgentId", () => {
  it("maps Retell dashboard test_agent to the live DNR agent", () => {
    expect(normalizeDnrRetellAgentId("test_agent")).toBe(DNR_RETELL_AGENT_ID);
    expect(normalizeDnrRetellAgentId("")).toBe(DNR_RETELL_AGENT_ID);
    expect(normalizeDnrRetellAgentId(undefined)).toBe(DNR_RETELL_AGENT_ID);
  });

  it("strips the agents/ prefix", () => {
    expect(normalizeDnrRetellAgentId(`agents/${DNR_RETELL_AGENT_ID}`)).toBe(
      DNR_RETELL_AGENT_ID,
    );
  });
});

describe("parseDnrRetellAgentId", () => {
  it("prefers call.agent_id over a hallucinated args.agent_id", () => {
    const body = JSON.stringify({
      args: { agent_id: "agent_wrong" },
      call: { agent_id: DNR_RETELL_AGENT_ID },
    });
    expect(parseDnrRetellAgentId(body)).toBe(DNR_RETELL_AGENT_ID);
  });

  it("falls back to the DNR agent when Retell sends test_agent", () => {
    const body = JSON.stringify({
      args: {},
      call: { agent_id: "test_agent" },
    });
    expect(parseDnrRetellAgentId(body)).toBe(DNR_RETELL_AGENT_ID);
  });
});
