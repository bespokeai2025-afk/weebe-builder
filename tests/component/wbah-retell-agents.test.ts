/**
 * WBAH's externally-hosted Retell agents keep moving to new Retell workspaces as the account
 * changes, and each move only ever adds new ids here — nothing here should ever be able to
 * silently stop resolving a role, since that's what routes a call to the rebooking pipeline vs
 * the generic new-leads one, or drops it from the live-calls feed and webhook signature checks
 * entirely.
 */
import { describe, expect, it } from "vitest";
import {
  isWbahRetellAgent,
  resolveWbahRetellAgent,
  stripRetellAgentPrefix,
  WBAH_RETELL_AGENT_MAP,
} from "@/lib/wbah/post-call/wbah-retell-agents.shared";
import { WBAH_WORKSPACE_ID } from "@/lib/wbah-exclusion.shared";

describe("the latest Retell workspace move", () => {
  it("resolves the new leads agent to the new_leads_dialer role", () => {
    const m = resolveWbahRetellAgent("agent_1757a7dd54cbce6d8febf0eb59");
    expect(m?.role).toBe("new_leads_dialer");
    expect(m?.workspaceId).toBe(WBAH_WORKSPACE_ID);
  });

  it("resolves the rebooking agent to the rebooking role", () => {
    const m = resolveWbahRetellAgent("agent_d1bad38378b4b4e78784fb6ef0");
    expect(m?.role).toBe("rebooking");
    expect(m?.workspaceId).toBe(WBAH_WORKSPACE_ID);
  });

  it("still resolves via the agents/ prefix Retell sends on some payloads", () => {
    expect(resolveWbahRetellAgent("agents/agent_d1bad38378b4b4e78784fb6ef0")?.role).toBe("rebooking");
  });

  it("keeps every earlier agent id from previous moves — old calls and history still resolve", () => {
    const previous = [
      "agent_0440750bb59597eef7352901bf", // qualification
      "agent_ca1d79998c01bb510e60a4dd39", // tried_to_contact
      "agent_14e6b8d2940774ca5206d3a20f", // new_leads_dialer, prior workspace
      "agent_3528ffd3497cdfaf538e819aed", // rebooking, prior workspace
    ];
    for (const id of previous) {
      expect(isWbahRetellAgent(id), id).toBe(true);
    }
  });
});

describe("WBAH_RETELL_AGENT_MAP", () => {
  it("every entry points at the WBAH workspace with a real name and role", () => {
    for (const [id, m] of Object.entries(WBAH_RETELL_AGENT_MAP)) {
      expect(m.workspaceId, id).toBe(WBAH_WORKSPACE_ID);
      expect(m.agentName?.length, id).toBeGreaterThan(0);
      expect(m.role, id).toBeTruthy();
    }
  });

  it("has no duplicate ids after stripping the agents/ prefix", () => {
    const stripped = Object.keys(WBAH_RETELL_AGENT_MAP).map(stripRetellAgentPrefix);
    expect(new Set(stripped).size).toBe(stripped.length);
  });
});

describe("resolveWbahRetellAgent — the negative case", () => {
  it("returns null for an id that has never been registered", () => {
    expect(resolveWbahRetellAgent("agent_totally_unknown_id")).toBeNull();
    expect(isWbahRetellAgent("agent_totally_unknown_id")).toBe(false);
  });

  it("returns null rather than throwing on empty input", () => {
    expect(resolveWbahRetellAgent(null)).toBeNull();
    expect(resolveWbahRetellAgent(undefined)).toBeNull();
    expect(resolveWbahRetellAgent("")).toBeNull();
  });
});
