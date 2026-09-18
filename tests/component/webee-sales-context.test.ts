/**
 * WEBEE's own positioning, and who may generate it.
 *
 * Two things this locks down. The assistant pitches WEBEE itself, so it must be WeBespoke-only —
 * in a customer workspace it would offer to pitch conversational AI to that customer's own leads.
 * And the generated material has to match the WEBESPOKE AI / WEBEE INDUSTRY SERIES decks the
 * prospect was actually sent, rather than the model's guess at what WEBEE sells.
 */
import { describe, expect, it } from "vitest";
import {
  WEBEE_CORE_POSITIONING,
  matchWebeeIndustry,
  webeeIndustryBrief,
} from "@/lib/leads/webee-sales-context.shared";
import {
  canUseSalesAssistant,
  assertSalesAssistantAccess,
  isWebespokeInternalWorkspace,
} from "@/lib/leads/webespoke-internal.shared";
import { buildAssistantPrompt, type AssistantSubject } from "@/lib/leads/sales-assistant.shared";

const AVENUE_ELITE = "9bc09fc9-5841-40d6-94a8-d3074a15f988";
const WEBESPOKE_SALES = "8288f37e-5abf-458c-bde3-2a49c6a89691";
const WBAH = "5cb750b6-fabf-4e84-9b92-740df1cd8d53";

describe("who may use the assistant", () => {
  it("allows the WeBespoke sales workspace even though that account is not a platform admin", () => {
    // sales@webespokeai.com is user_type "user"; an admin-only gate would lock
    // out the people who actually sell.
    expect(canUseSalesAssistant({ workspaceId: WEBESPOKE_SALES, userType: "user" })).toBe(true);
  });

  it("allows a platform admin in any workspace", () => {
    expect(canUseSalesAssistant({ workspaceId: AVENUE_ELITE, userType: "admin" })).toBe(true);
  });

  it("denies a customer workspace", () => {
    expect(canUseSalesAssistant({ workspaceId: AVENUE_ELITE, userType: "user" })).toBe(false);
    expect(canUseSalesAssistant({ workspaceId: WBAH, userType: "user" })).toBe(false);
  });

  it("denies when there is no workspace or no profile", () => {
    expect(canUseSalesAssistant({ workspaceId: null, userType: null })).toBe(false);
    expect(canUseSalesAssistant({ workspaceId: undefined, userType: undefined })).toBe(false);
  });

  it("throws with an explanation, not a bare Forbidden", () => {
    expect(() =>
      assertSalesAssistantAccess({ workspaceId: AVENUE_ELITE, userType: "user" }),
    ).toThrow(/WeBespoke team/i);
    expect(() =>
      assertSalesAssistantAccess({ workspaceId: WEBESPOKE_SALES, userType: "user" }),
    ).not.toThrow();
  });

  it("recognises every WeBespoke workspace and nothing else", () => {
    expect(isWebespokeInternalWorkspace(WEBESPOKE_SALES)).toBe(true);
    expect(isWebespokeInternalWorkspace(AVENUE_ELITE)).toBe(false);
  });
});

describe("matchWebeeIndustry", () => {
  it("matches each of the six decks from a lead's own words", () => {
    expect(matchWebeeIndustry("Acme Estate Agents, lettings")?.key).toBe("real_estate");
    expect(matchWebeeIndustry("Smith Plumbing & Heating")?.key).toBe("home_services");
    expect(matchWebeeIndustry("The Grand Hotel and spa")?.key).toBe("hospitality");
    expect(matchWebeeIndustry("Northern Insurance Brokers, renewal")?.key).toBe("insurance");
    expect(matchWebeeIndustry("Baker & Co Solicitors")?.key).toBe("legal");
    expect(matchWebeeIndustry("Talent First recruitment")?.key).toBe("recruitment");
  });

  it("returns null rather than guessing when nothing matches", () => {
    expect(matchWebeeIndustry("Blue Widgets Manufacturing")).toBeNull();
  });

  it("prefers the deck with more matching signals", () => {
    // "broker" appears in both property and insurance; the extra insurance
    // words should win.
    expect(matchWebeeIndustry("broker policy claims renewal underwriting")?.key).toBe("insurance");
  });
});

describe("webeeIndustryBrief", () => {
  it("carries the deck's own headline, leaks, workflow and pilot metrics", () => {
    const brief = webeeIndustryBrief(matchWebeeIndustry("estate agent"));
    expect(brief).toContain("The enquiry should not go cold because the team is busy.");
    expect(brief).toContain("Missed demand");
    expect(brief).toContain("Route — book a valuation or viewing");
    expect(brief).toContain("Valuations or viewings booked");
  });

  it("passes on the regulated guardrails where the deck sets them", () => {
    expect(webeeIndustryBrief(matchWebeeIndustry("solicitors"))).toMatch(
      /never present WEBEE as giving legal advice/i,
    );
    expect(webeeIndustryBrief(matchWebeeIndustry("insurance underwriting"))).toMatch(
      /advice, underwriting and material decisions/i,
    );
  });

  it("says so plainly when no deck matched", () => {
    expect(webeeIndustryBrief(null)).toMatch(/no industry deck matched/i);
  });
});

describe("the prompt carries WEBEE's real positioning", () => {
  const subject: AssistantSubject = {
    id: "l1",
    kind: "lead",
    name: "Jane",
    company: "Acme Estate Agents",
    email: "jane@acme.co.uk",
    phone: "+44",
    facts: [],
    history: [],
  };

  it("includes the Retell differentiator, which is the whole pitch", () => {
    expect(WEBEE_CORE_POSITIONING).toMatch(/Retell/);
    expect(buildAssistantPrompt(subject, "pitch", null)).toMatch(/no-code operational journey/i);
  });

  it("includes the both-not-either-or frame so nothing claims to replace people", () => {
    const prompt = buildAssistantPrompt(subject, "meeting", null);
    expect(prompt).toMatch(/both — not either\/or/i);
    expect(prompt).toMatch(/never claim webee replaces human expertise/i);
  });

  it("selects the matching deck from the lead's company name", () => {
    expect(buildAssistantPrompt(subject, "demo", null)).toContain("Real Estate & Property");
  });

  it("asks for a 30-second pitch with a word budget, not an essay", () => {
    const pitch = buildAssistantPrompt(subject, "pitch", null);
    expect(pitch).toMatch(/30-SECOND PITCH/);
    expect(pitch).toMatch(/75-85 words/);
    expect(pitch).toContain("## Say this");
  });

  it("asks for in-depth meeting and demo plans", () => {
    expect(buildAssistantPrompt(subject, "meeting", null)).toMatch(/IN-DEPTH MEETING PLAN/);
    expect(buildAssistantPrompt(subject, "meeting", null)).toContain("## Agenda");
    expect(buildAssistantPrompt(subject, "demo", null)).toMatch(/IN-DEPTH DEMO PLAN/);
    expect(buildAssistantPrompt(subject, "demo", null)).toContain("## Run of show");
  });
});
