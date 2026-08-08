import { describe, expect, it } from "vitest";
import {
  parseTemplateFallbackBody,
  rehydrateTemplateFallbackBody,
  renderWatiTemplateBodyPositional,
  renderWatiTemplateBodyPreview,
} from "@/lib/whatsapp/wati-template-params.shared";

const SPORT_CITY_BODY =
  "Hello {{1}},\n\nThis is {{4}} from Avenue 7. I hope you're doing well.\n\nI'm reaching out regarding your property in {{2}}{{3}}.";

const SPORT_CITY_TEMPLATE = {
  body_preview: SPORT_CITY_BODY,
  components: {
    customParams: [
      { paramName: "1" },
      { paramName: "4" },
      { paramName: "3" },
      { paramName: "2" },
    ],
  },
};

describe("renderWatiTemplateBodyPreview", () => {
  it("renders non-sequential WATI placeholders by param slot name", () => {
    const rendered = renderWatiTemplateBodyPreview(SPORT_CITY_BODY, "sport_city", [
      { name: "1", value: "Arjav" },
      { name: "4", value: "Khisha" },
      { name: "3", value: "Diamond Views 1 Block A" },
      { name: "2", value: "Jumeirah Village Circle (JVC)" },
    ]);
    expect(rendered).toContain("Hello Arjav");
    expect(rendered).toContain("This is Khisha from Avenue 7");
    expect(rendered).toContain("Jumeirah Village Circle (JVC)");
    expect(rendered).toContain("Diamond Views 1 Block A");
    expect(rendered.startsWith("[Template:")).toBe(false);
  });

  it("still supports named placeholders", () => {
    const rendered = renderWatiTemplateBodyPreview(
      "Hi {{name}}, welcome to {{city}}.",
      "welcome",
      [
        { name: "name", value: "Sam" },
        { name: "city", value: "Dubai" },
      ],
    );
    expect(rendered).toBe("Hi Sam, welcome to Dubai.");
  });
});

describe("rehydrateTemplateFallbackBody", () => {
  it("expands sport_city inbox shorthand using customParams slot order", () => {
    const fallback =
      "[Template: sport_city] Arjav · Khisha · Diamond Views 1 Block A · Jumeirah Village Circle (JVC)";
    const resolved = rehydrateTemplateFallbackBody(fallback, SPORT_CITY_TEMPLATE);
    expect(resolved).toContain("Hello Arjav");
    expect(resolved).toContain("This is Khisha from Avenue 7");
    expect(resolved).toContain("Jumeirah Village Circle (JVC)");
    expect(resolved).toContain("Diamond Views 1 Block A");
  });

  it("expands legacy numeric-order campaign shorthand (1 · 2 · 3 · 4)", () => {
    const fallback =
      "[Template: sport_city] ALYAA · Jumeirah Village Circle (JVC) · Reef Residence · Khisha";
    const resolved = rehydrateTemplateFallbackBody(fallback, SPORT_CITY_TEMPLATE);
    expect(resolved).toContain("Hello ALYAA");
    expect(resolved).toContain("This is Khisha from Avenue 7");
    expect(resolved).toContain("Jumeirah Village Circle (JVC)");
    expect(resolved).toContain("Reef Residence");
  });
});

describe("parseTemplateFallbackBody", () => {
  it("parses middle-dot parameter shorthand", () => {
    expect(
      parseTemplateFallbackBody(
        "[Template: sport_city] Arjav · Kisha · Diamond Views 1 Block A · JVC",
      ),
    ).toEqual({
      templateName: "sport_city",
      values: ["Arjav", "Kisha", "Diamond Views 1 Block A", "JVC"],
    });
  });
});

describe("renderWatiTemplateBodyPositional", () => {
  it("returns null when body has no numeric placeholders", () => {
    expect(renderWatiTemplateBodyPositional("Hi {{name}}", ["Arjav"])).toBeNull();
  });
});
