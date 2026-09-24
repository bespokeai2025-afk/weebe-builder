/**
 * Placeholder-looking text that WhatsApp will not fill in.
 *
 * Avenue Elite's "follow_up" template reads "Hi [Name] 👋" but declares no variables, so it went
 * to a customer exactly like that. WhatsApp only substitutes declared variables ({{1}}, {{name}});
 * square brackets are ordinary characters. Nothing flagged it, because from the send path's view
 * the template simply had no parameters to fill.
 */
import { describe, expect, it } from "vitest";
import {
  literalPlaceholdersInTemplateBody,
  templateSendsLiteralPlaceholders,
} from "@/lib/whatsapp/wati-template-params.shared";

describe("literalPlaceholdersInTemplateBody", () => {
  it("catches the exact body that was sent", () => {
    expect(
      literalPlaceholdersInTemplateBody("Hi [Name] 👋 Following up on our earlier conversation."),
    ).toEqual(["[Name]"]);
  });

  it("catches the other shapes people type", () => {
    expect(literalPlaceholdersInTemplateBody("Hello <first name>, ...")).toEqual(["<first name>"]);
    expect(literalPlaceholdersInTemplateBody("Hi [first_name] and [City]")).toEqual([
      "[first_name]",
      "[City]",
    ]);
  });

  it("reports each distinct placeholder once", () => {
    expect(literalPlaceholdersInTemplateBody("Hi [Name], thanks [Name]")).toEqual(["[Name]"]);
  });

  it("leaves real WhatsApp variables alone", () => {
    expect(literalPlaceholdersInTemplateBody("Hi {{1}}, about {{property_name}}")).toEqual([]);
  });

  it("does not flag ordinary prose or links in brackets", () => {
    expect(literalPlaceholdersInTemplateBody("Reply STOP to opt out (no charge)")).toEqual([]);
    expect(literalPlaceholdersInTemplateBody("See [https://example.com/x]")).toEqual([]);
    expect(
      literalPlaceholdersInTemplateBody("[a very long sentence that is clearly not a field name]"),
    ).toEqual([]);
  });

  it("is safe on empty input", () => {
    expect(literalPlaceholdersInTemplateBody("")).toEqual([]);
    expect(literalPlaceholdersInTemplateBody(null)).toEqual([]);
  });
});

describe("templateSendsLiteralPlaceholders", () => {
  it("warns for the follow_up template as stored", () => {
    const tpl = {
      name: "follow_up",
      components: { body: "Hi [Name] 👋 Following up.", customParams: [] },
    };
    expect(templateSendsLiteralPlaceholders(tpl)).toEqual(["[Name]"]);
  });

  it("stays quiet for the corrected template", () => {
    const tpl = {
      name: "send_follow_up",
      components: {
        body: "Hi {{1}},👋 Following up.",
        bodyOriginal: "Hi {{name}},👋 Following up.",
        customParams: [{ paramName: "name", paramValue: "Customer" }],
      },
    };
    expect(templateSendsLiteralPlaceholders(tpl)).toEqual([]);
  });

  it("stays quiet when the author uses brackets alongside real variables", () => {
    // Variables present means the author is filling what matters; not our call.
    const tpl = {
      components: {
        body: "Hi {{1}}, see [terms]",
        customParams: [{ paramName: "name", paramValue: "x" }],
      },
    };
    expect(templateSendsLiteralPlaceholders(tpl)).toEqual([]);
  });

  it("handles a missing template without throwing", () => {
    expect(templateSendsLiteralPlaceholders(null)).toEqual([]);
    expect(templateSendsLiteralPlaceholders({})).toEqual([]);
  });
});
