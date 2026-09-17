/**
 * Regression: BuzzChat attachments could not be opened or downloaded.
 *
 * WATI sends an inbound attachment's location on `data` as a plain string holding its own storage
 * path (`data/documents/<uuid>.pdf`) — there is no public URL. The parser read `data` as an object,
 * and because it is a string `data?.link` did not evaluate to undefined: it resolved to the legacy
 * `String.prototype.link` method, so `String()` wrote the literal text
 * `function link() { [native code] }` as the media_url of every attachment received.
 */
import { describe, expect, it } from "vitest";
import {
  isWatiMediaPath,
  parseWatiInboundMessage,
  watiMediaMimeFromPath,
} from "@/lib/whatsapp/wati-campaign.server";

/** A real document event, as captured from WATI's own getMessages response. */
const documentEvent = {
  eventType: "message",
  type: "document",
  text: "JUNIOR 1 BEDROOM PLAN.pdf",
  data: "data/documents/cf2c68dc-e3d1-4380-8fe3-0ad3191ae473.pdf",
  waId: "971506069422",
  timestamp: "1789610342",
  conversationId: "6aa7c8a4eb43116ccd6ae3e0",
  ticketId: "6aab496c5c3529415d2a3797",
  owner: false,
  statusString: "SENT",
};

describe("parseWatiInboundMessage — attachments", () => {
  it("keeps WATI's storage path as the media reference for a document", () => {
    const parsed = parseWatiInboundMessage(documentEvent);
    expect(parsed?.media_url).toBe("data/documents/cf2c68dc-e3d1-4380-8fe3-0ad3191ae473.pdf");
    expect(parsed?.media_filename).toBe("JUNIOR 1 BEDROOM PLAN.pdf");
    expect(parsed?.media_mime_type).toBe("application/pdf");
  });

  it("never stringifies a String prototype method into media_url", () => {
    for (const event of [
      documentEvent,
      { ...documentEvent, type: "image", data: "data/images/a.jpg", text: "nice view" },
      { ...documentEvent, type: "voice", data: "data/audios/a.opus", text: null },
      { ...documentEvent, type: "text", data: "just a string", text: "hello" },
    ]) {
      const parsed = parseWatiInboundMessage(event);
      expect(parsed?.media_url ?? "").not.toContain("native code");
      expect(parsed?.media_url ?? "").not.toContain("function link");
    }
  });

  it("treats a text message's `data` as unrelated to media", () => {
    const parsed = parseWatiInboundMessage({
      ...documentEvent,
      type: "text",
      text: "hello",
      data: "some/other/thing.txt",
    });
    expect(parsed?.media_url).toBeNull();
  });

  it("borrows `text` as the filename only for documents, never as an image caption", () => {
    const image = parseWatiInboundMessage({
      ...documentEvent,
      type: "image",
      data: "data/images/a.jpg",
      text: "Look at the balcony",
    });
    expect(image?.media_url).toBe("data/images/a.jpg");
    expect(image?.media_filename).toBeNull();
    expect(image?.media_mime_type).toBe("image/jpeg");
  });

  it("prefers a real sourceUrl when WATI provides one", () => {
    const parsed = parseWatiInboundMessage({
      ...documentEvent,
      sourceUrl: "https://eu-api.wati.io/x/y.pdf",
    });
    expect(parsed?.media_url).toBe("https://eu-api.wati.io/x/y.pdf");
  });

  it("falls back to audio/ogg for a voice note WATI describes with no mime type", () => {
    const parsed = parseWatiInboundMessage({
      ...documentEvent,
      type: "voice",
      text: null,
      data: "data/audios/94a2b512.opus",
    });
    expect(parsed?.media_mime_type).toBe("audio/ogg");
  });

  it("ignores a transcription that WATI stored in place of the media path", () => {
    // WATI overwrites `data` once it transcribes a voice note. Storing that JSON
    // as the attachment reference offers a download that can never resolve.
    const transcription = JSON.stringify([{ Text: "call me later", Start: 0.1, End: 9.6 }]);
    const parsed = parseWatiInboundMessage({
      ...documentEvent,
      type: "audio",
      text: null,
      data: transcription,
    });
    expect(parsed?.media_url).toBeNull();
  });
});

describe("isWatiMediaPath", () => {
  it("accepts WATI's storage paths", () => {
    expect(isWatiMediaPath("data/documents/cf2c68dc.pdf")).toBe(true);
    expect(isWatiMediaPath("data/audios/94a2b512-d1dd.opus")).toBe(true);
  });

  it("rejects everything that is not one", () => {
    expect(isWatiMediaPath('[{"Text":"hi"}]')).toBe(false);
    expect(isWatiMediaPath("a caption with spaces")).toBe(false);
    expect(isWatiMediaPath("no-slash.pdf")).toBe(false);
    expect(isWatiMediaPath("data/documents/noextension")).toBe(false);
    expect(isWatiMediaPath("function link() { [native code] }")).toBe(false);
    expect(isWatiMediaPath("")).toBe(false);
    expect(isWatiMediaPath(null)).toBe(false);
  });
});

describe("watiMediaMimeFromPath", () => {
  it("types the formats WhatsApp actually delivers", () => {
    expect(watiMediaMimeFromPath("x/y.pdf")).toBe("application/pdf");
    expect(watiMediaMimeFromPath("x/y.opus")).toBe("audio/ogg");
    expect(watiMediaMimeFromPath("Site plan.XLSX")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(watiMediaMimeFromPath("x/y.unknownext")).toBeNull();
    expect(watiMediaMimeFromPath(null)).toBeNull();
  });
});
