// @vitest-environment jsdom
/**
 * Attachment rendering, shared by the inbox and the Listing Leads panel.
 *
 * The Listing Leads panel rendered only `m.body`, so a PDF a seller sent showed as the bare text
 * "JUNIOR 1 BEDROOM PLAN.pdf" with no way to open or download it — the row already carried the
 * media. The inbox had its own copy of this logic; both now use one component so they cannot drift.
 */
import { describe, expect, it } from "vitest";
import { mediaHref, type MediaMessage } from "@/components/whatsapp/WhatsAppMessageMedia";

const PDF: MediaMessage = {
  id: "11111111-1111-1111-1111-111111111111",
  media_url: "data/documents/cf2c68dc.pdf",
  media_mime_type: "application/pdf",
  media_filename: "JUNIOR 1 BEDROOM PLAN.pdf",
};

describe("mediaHref", () => {
  it("routes through the server proxy, never WATI directly", () => {
    // WATI needs the tenant's bearer token, which must never reach the browser.
    const href = mediaHref(PDF, "tok")!;
    expect(href.startsWith("/api/whatsapp/media?")).toBe(true);
    expect(href).not.toContain("wati.io");
    expect(href).not.toContain("data/documents");
  });

  it("identifies the message rather than passing a path the client could tamper with", () => {
    expect(mediaHref(PDF, "tok")).toContain(`messageId=${PDF.id}`);
  });

  it("asks for an attachment disposition only when downloading", () => {
    expect(mediaHref(PDF, "tok", false)).not.toContain("download=1");
    expect(mediaHref(PDF, "tok", true)).toContain("download=1");
  });

  it("url-encodes the token so a session string cannot break the query", () => {
    expect(mediaHref(PDF, "a b+c/d=")).toContain(`token=${encodeURIComponent("a b+c/d=")}`);
  });

  it("returns null with no token, so nothing renders a broken link while the session resolves", () => {
    expect(mediaHref(PDF, null)).toBeNull();
    expect(mediaHref(PDF, "")).toBeNull();
  });

  it("returns null for a message with no attachment", () => {
    expect(mediaHref({ id: PDF.id, media_url: null }, "tok")).toBeNull();
    expect(mediaHref({ id: PDF.id }, "tok")).toBeNull();
  });
});

describe("the media types Avenue Elite actually receives", () => {
  // Verified against live WATI: every one of these fetches real bytes.
  const cases: Array<[string, MediaMessage]> = [
    [
      "application/pdf",
      { id: "a", media_url: "data/documents/x.pdf", media_mime_type: "application/pdf" },
    ],
    ["image/jpeg", { id: "b", media_url: "data/images/x.jpg", media_mime_type: "image/jpeg" }],
    ["audio/ogg", { id: "c", media_url: "data/audios/x.opus", media_mime_type: "audio/ogg" }],
  ];

  it("produces a usable href for each", () => {
    for (const [, msg] of cases) {
      expect(mediaHref(msg, "tok")).toContain("/api/whatsapp/media?");
      expect(mediaHref(msg, "tok", true)).toContain("download=1");
    }
  });

  it("does not depend on the mime type to build the link", () => {
    // Type drives which player renders; the href is the same either way.
    const unknown: MediaMessage = { id: "d", media_url: "data/other/x.bin", media_mime_type: null };
    expect(mediaHref(unknown, "tok")).toContain("/api/whatsapp/media?");
  });
});
