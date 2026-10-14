import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));

describe("international WhatsApp numbers", async () => {
  const { inferDefaultCallingCode, toInternationalWhatsAppPhone } = await import("@/lib/whatsapp/wati-campaign.server");
  const { callingCodeOf } = await import("@/lib/telephony/number-routing.shared");

  it("reads the calling code", () => {
    expect(callingCodeOf("971556665255")).toBe("971");
    expect(callingCodeOf("+447700900123")).toBe("44");
    expect(callingCodeOf("12025550123")).toBe("1");
    expect(callingCodeOf("")).toBeNull();
  });

  it("infers a workspace's country only when one clearly dominates", () => {
    const uae = [...Array(12)].map((_, i) => `9715${String(10000000 + i)}`);
    expect(inferDefaultCallingCode([...uae, "447700900123", "0556665255"])).toBe("971");
    const mixed = [...uae.slice(0, 5), ...[...Array(6)].map((_, i) => `4477009001${10 + i}`)];
    expect(inferDefaultCallingCode(mixed)).toBeNull();
    expect(inferDefaultCallingCode(uae.slice(0, 5))).toBeNull(); // too few to judge
  });

  it.each([
    ["0556665255", "971556665255"],
    ["556665255", "971556665255"],
    ["971556665255", "971556665255"],
    ["+971 55 666 5255", "971556665255"],
    ["00447700900123", "447700900123"],
    ["447700900123", "447700900123"],
  ])("%s → %s", (input, expected) => {
    expect(toInternationalWhatsAppPhone(input, "971")).toBe(expected);
  });

  it("leaves local numbers alone when the country is unknown", () => {
    expect(toInternationalWhatsAppPhone("0556665255", null)).toBe("0556665255");
  });
});

describe("message stats", async () => {
  const { aggregateWaMessageStatsByPhone } = await import("@/lib/whatsapp/wa-contact-message-stats.server");
  const row = (status: string, at: string) => ({ contact_phone: "971556665255", direction: "outbound", sent_at: at, status });

  it("does not count a contact as messaged when every send failed", () => {
    const stats = aggregateWaMessageStatsByPhone([row("failed", "2026-10-13T10:00:00Z"), row("failed", "2026-10-14T10:00:00Z")], new Map());
    expect(stats.get("971556665255")?.messaged).toBe(false);
    expect(stats.get("971556665255")?.failed_count).toBe(2);
  });

  it("counts them once any send got through", () => {
    const stats = aggregateWaMessageStatsByPhone([row("failed", "2026-10-13T10:00:00Z"), row("delivered", "2026-09-23T10:00:00Z")], new Map());
    expect(stats.get("971556665255")?.messaged).toBe(true);
  });
});

describe("fresh start after a number change", async () => {
  const { countsAsAlreadyMessaged } = await import("@/lib/whatsapp/wa-contact-message-stats.server");
  const { dailyCapForWarmupDay, parseWatiWarmupConfig } = await import("@/lib/whatsapp/wati-warmup.shared");

  it("ignores the old CRM 'contacted' status once a history cut-off is set", () => {
    expect(countsAsAlreadyMessaged({ messaged: false }, "contacted", null)).toBe(true);
    expect(countsAsAlreadyMessaged({ messaged: false }, "contacted", "2026-09-30T08:42:54Z")).toBe(false);
    expect(countsAsAlreadyMessaged({ messaged: true }, "new", "2026-09-30T08:42:54Z")).toBe(true);
  });

  it("never lets the warm-up schedule exceed the daily maximum", () => {
    const capped = parseWatiWarmupConfig({ enabled: true, targetDaily: 250 });
    expect([1, 3, 5, 7, 9, 30].map((d) => dailyCapForWarmupDay(capped, d))).toEqual([50, 100, 200, 250, 250, 250]);
    const open = parseWatiWarmupConfig({ enabled: true });
    expect(dailyCapForWarmupDay(open, 9)).toBe(1000);
  });
});
