/**
 * Inbound attachments must survive the WATI inbox sync.
 *
 * A photo or voice note sent without a caption has no text anywhere in the payload, and the parser
 * bailed out on an empty body — so messages plainly visible in WATI never appeared in BuzzChat at
 * all. The payload below is a real one from the Avenue Elite tenant.
 */
import { describe, expect, it } from "vitest";
import { parseWatiV1InboxMessage } from "@/lib/whatsapp/wati-inbox-sync.server";

/** Verbatim shape of an uncaptioned inbound image from WATI's getMessages. */
const imageMessage = {
  id: "6ab25564e32316f3ef788e78",
  type: "image",
  eventType: "message",
  owner: false,
  text: null,
  data: "data/images/fc8fa3ad-38de-4418-abe6-53d59ad9c663.jpg",
  created: "2026-09-22T10:16:03.788Z",
};

describe("parseWatiV1InboxMessage", () => {
  it("keeps an uncaptioned image instead of dropping it", () => {
    const parsed = parseWatiV1InboxMessage(imageMessage as never, "971506250463");
    expect(parsed).not.toBeNull();
    expect(parsed!.direction).toBe("inbound");
    expect(parsed!.body).toBe("[image]");
    expect(parsed!.media_url).toBe(imageMessage.data);
    expect(parsed!.media_mime_type).toBe("image/jpeg");
  });

  it("keeps a caption as the body when there is one", () => {
    const parsed = parseWatiV1InboxMessage(
      { ...imageMessage, text: "Here is the villa" } as never,
      "971506250463",
    );
    expect(parsed!.body).toBe("Here is the villa");
    expect(parsed!.media_url).toBe(imageMessage.data);
  });

  it("still drops a message with neither text nor media", () => {
    expect(
      parseWatiV1InboxMessage(
        { id: "x", type: "text", eventType: "message", owner: false, text: "  " } as never,
        "971506250463",
      ),
    ).toBeNull();
  });

  it("does not treat a text message's data field as an attachment", () => {
    // `data` is only a storage path on a media message; on a text message it is unrelated.
    const parsed = parseWatiV1InboxMessage(
      { id: "y", type: "text", eventType: "message", owner: false, text: "hello", data: "hello" } as never,
      "971506250463",
    );
    expect(parsed!.body).toBe("hello");
    expect(parsed!.media_url).toBeNull();
  });
});
