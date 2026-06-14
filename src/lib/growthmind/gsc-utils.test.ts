import { describe, it, expect } from "vitest";
import { buildGscEncodedSiteUrl } from "./gsc-utils";

describe("buildGscEncodedSiteUrl", () => {
  it("encodes sc-domain: prefix correctly — colon becomes %3A", () => {
    const result = buildGscEncodedSiteUrl("sc-domain:example.com");
    expect(result).toBe("sc-domain%3Aexample.com");
  });

  it("produces a URL path that would hit the correct GSC endpoint for a domain property", () => {
    const encoded = buildGscEncodedSiteUrl("sc-domain:example.com");
    const apiUrl = `https://www.googleapis.com/webmasters/v3/sites/${encoded}/searchAnalytics/query`;
    expect(apiUrl).toBe(
      "https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Aexample.com/searchAnalytics/query"
    );
  });

  it("encodes https:// property URLs correctly", () => {
    const result = buildGscEncodedSiteUrl("https://example.com/");
    expect(result).toBe("https%3A%2F%2Fexample.com%2F");
  });

  it("produces a URL path that would hit the correct GSC endpoint for an https property", () => {
    const encoded = buildGscEncodedSiteUrl("https://example.com/");
    const apiUrl = `https://www.googleapis.com/webmasters/v3/sites/${encoded}/searchAnalytics/query`;
    expect(apiUrl).toBe(
      "https://www.googleapis.com/webmasters/v3/sites/https%3A%2F%2Fexample.com%2F/searchAnalytics/query"
    );
  });

  it("trims leading and trailing whitespace before encoding", () => {
    expect(buildGscEncodedSiteUrl("  sc-domain:example.com  ")).toBe(
      "sc-domain%3Aexample.com"
    );
  });

  it("handles sc-domain: with subdomain in property URL", () => {
    const result = buildGscEncodedSiteUrl("sc-domain:sub.example.com");
    expect(result).toBe("sc-domain%3Asub.example.com");
  });
});
