import { describe, expect, it } from "vitest";
import { newWatiLocalMessageId } from "@/lib/whatsapp/wati-campaign.server";

describe("newWatiLocalMessageId", () => {
  it("is unique per send, even for the same lead", () => {
    const a = newWatiLocalMessageId("0360b7a1-ea3a-4ec3-82da-c77766843663");
    const b = newWatiLocalMessageId("0360b7a1-ea3a-4ec3-82da-c77766843663");
    expect(a).not.toBe(b);
    expect(a).toMatch(/^lead_0360b7a1-ea3a-4ec3-82da-c77766843663_[0-9a-f]{8}$/);
  });

  it("falls back to a random id without a lead", () => {
    expect(newWatiLocalMessageId()).toMatch(/^[0-9a-f-]{36}$/);
  });
});
