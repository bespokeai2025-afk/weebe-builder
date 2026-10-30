/** Templates keep their engine, and carry an industry. */
import { describe, expect, it } from "vitest";
import { templateDeploymentMode, templateIndustryLabel } from "@/lib/builder/template-industries.shared";

describe("templateDeploymentMode", () => {
  it("keeps a WEBEE Native template on WEBEE Native (it used to open as Retell)", () => {
    expect(templateDeploymentMode({ deploymentMode: "WEBEE_NATIVE", voiceProvider: "RETELL" })).toBe("WEBEE_NATIVE");
  });

  it("older templates: realtime voice → OpenAI Native, otherwise Retell", () => {
    expect(templateDeploymentMode({ voiceProvider: "OPENAI_REALTIME" })).toBe("OPENAI_NATIVE");
    expect(templateDeploymentMode({})).toBe("RETELL");
    expect(templateDeploymentMode({ deploymentMode: "NOT_A_MODE" })).toBe("RETELL");
    expect(templateDeploymentMode(null)).toBe("RETELL");
  });
});

describe("templateIndustryLabel", () => {
  it("labels known industries and defaults to General", () => {
    expect(templateIndustryLabel("real_estate")).toBe("Real estate");
    expect(templateIndustryLabel(undefined)).toBe("General");
  });
});
