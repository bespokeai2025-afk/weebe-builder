import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  computePhoneNumberPrice,
  fetchTwilioNumberPrice,
  type TwilioNumberPrice,
} from "@/lib/telephony/twilio-pricing.server";

// Fake Twilio Account SID/token below are not real credentials — used only to
// prove the Basic Auth header is built correctly. No real network calls are
// made; fetch is always replaced with a mock.

type CacheRow = {
  current_price_usd: number;
  base_price_usd: number;
  price_unit: string;
  fetched_at: string;
};

function createFakePriceCacheClient(store: Map<string, CacheRow>) {
  const key = (iso: string, type: string) => `${iso}::${type}`;
  return {
    from(table: string) {
      if (table !== "twilio_number_price_cache") {
        throw new Error(`unexpected table in test double: ${table}`);
      }
      let isoCountry = "";
      let numberType = "";
      return {
        select(_cols: string) {
          return {
            eq(col: string, value: string) {
              if (col === "iso_country") isoCountry = value;
              if (col === "number_type") numberType = value;
              return this;
            },
            async maybeSingle() {
              return { data: store.get(key(isoCountry, numberType)) ?? null };
            },
          };
        },
        async upsert(row: any, _opts: { onConflict: string }) {
          store.set(key(row.iso_country, row.number_type), {
            current_price_usd: row.current_price_usd,
            base_price_usd: row.base_price_usd,
            price_unit: row.price_unit,
            fetched_at: row.fetched_at,
          });
          return { data: null, error: null };
        },
      };
    },
  };
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.TWILIO_MASTER_ACCOUNT_SID = "ACmasterfaketest0000000000000000";
  process.env.TWILIO_MASTER_AUTH_TOKEN = "master_fake_token_for_tests_only";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("fetchTwilioNumberPrice", () => {
  it("returns a fresh cached price without calling the Pricing API", async () => {
    const store = new Map<string, CacheRow>([
      ["US::local", { current_price_usd: 1.15, base_price_usd: 1.0, price_unit: "USD", fetched_at: new Date().toISOString() }],
    ]);
    const sb = createFakePriceCacheClient(store);
    const fetchMock = vi.fn();

    const result = await fetchTwilioNumberPrice(sb as any, { isoCountry: "US", numberType: "local" }, fetchMock);

    expect(result).toEqual({ isoCountry: "US", numberType: "local", currentPriceUsd: 1.15, basePriceUsd: 1.0, priceUnit: "USD" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches from the Pricing API and caches the result on a cache miss", async () => {
    const store = new Map<string, CacheRow>();
    const sb = createFakePriceCacheClient(store);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        price_unit: "USD",
        phone_number_prices: [
          { number_type: "local", base_price: "1.00", current_price: "1.15" },
          { number_type: "toll free", base_price: "2.00", current_price: "2.30" },
        ],
      }),
    });

    const result = await fetchTwilioNumberPrice(sb as any, { isoCountry: "GB", numberType: "local" }, fetchMock);

    expect(result).toEqual({ isoCountry: "GB", numberType: "local", currentPriceUsd: 1.15, basePriceUsd: 1.0, priceUnit: "USD" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://pricing.twilio.com/v1/PhoneNumbers/Countries/GB");
    const expectedAuth = `Basic ${Buffer.from("ACmasterfaketest0000000000000000:master_fake_token_for_tests_only").toString("base64")}`;
    expect(opts.headers.Authorization).toBe(expectedAuth);
    // Cached for next time.
    expect(store.get("GB::local")?.current_price_usd).toBe(1.15);
  });

  it("refetches when the cached row is older than the 24h TTL", async () => {
    const stale = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const store = new Map<string, CacheRow>([
      ["US::local", { current_price_usd: 1.15, base_price_usd: 1.0, price_unit: "USD", fetched_at: stale }],
    ]);
    const sb = createFakePriceCacheClient(store);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        price_unit: "USD",
        phone_number_prices: [{ number_type: "local", base_price: "1.00", current_price: "1.25" }],
      }),
    });

    const result = await fetchTwilioNumberPrice(sb as any, { isoCountry: "US", numberType: "local" }, fetchMock);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.currentPriceUsd).toBe(1.25);
  });

  it("throws when the Pricing API returns a non-ok response", async () => {
    const sb = createFakePriceCacheClient(new Map());
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });

    await expect(
      fetchTwilioNumberPrice(sb as any, { isoCountry: "US", numberType: "local" }, fetchMock),
    ).rejects.toThrow(/401/);
  });

  it("throws when the response has no matching number_type entry", async () => {
    const sb = createFakePriceCacheClient(new Map());
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ price_unit: "USD", phone_number_prices: [{ number_type: "mobile", base_price: "1", current_price: "1" }] }),
    });

    await expect(
      fetchTwilioNumberPrice(sb as any, { isoCountry: "US", numberType: "toll free" }, fetchMock),
    ).rejects.toThrow(/no twilio pricing entry/i);
  });

  it("throws when WEBEE's master Twilio credentials aren't configured", async () => {
    delete process.env.TWILIO_MASTER_ACCOUNT_SID;
    const sb = createFakePriceCacheClient(new Map());
    const fetchMock = vi.fn();

    await expect(
      fetchTwilioNumberPrice(sb as any, { isoCountry: "US", numberType: "local" }, fetchMock),
    ).rejects.toThrow(/master Twilio account is not configured/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("computePhoneNumberPrice", () => {
  it("applies a fixed GBP-pence markup on top of the converted cost", () => {
    // $1.15 cost, fx 0.80 -> 92p cost, +150p fixed markup -> 242p charged.
    const result = computePhoneNumberPrice(1.15, { markupType: "fixed", markupValue: 150, fxRateUsdToGbp: 0.8 });
    expect(result).toEqual({ costUsdCents: 115, costGbpPence: 92, priceGbpPence: 242 });
  });

  it("applies a percentage markup on top of the converted cost", () => {
    // $1.00 cost, fx 0.80 -> 80p cost, +50% -> 120p charged.
    const result = computePhoneNumberPrice(1.0, { markupType: "percentage", markupValue: 50, fxRateUsdToGbp: 0.8 });
    expect(result).toEqual({ costUsdCents: 100, costGbpPence: 80, priceGbpPence: 120 });
  });

  it("handles zero markup (percentage 0) as pass-through cost", () => {
    const result = computePhoneNumberPrice(2.0, { markupType: "percentage", markupValue: 0, fxRateUsdToGbp: 1 });
    expect(result).toEqual({ costUsdCents: 200, costGbpPence: 200, priceGbpPence: 200 });
  });

  it("rejects a negative cost", () => {
    expect(() => computePhoneNumberPrice(-1, { markupType: "fixed", markupValue: 0, fxRateUsdToGbp: 0.8 })).toThrow(
      /invalid costusd/i,
    );
  });

  it("rejects a non-positive fx rate", () => {
    expect(() => computePhoneNumberPrice(1, { markupType: "fixed", markupValue: 0, fxRateUsdToGbp: 0 })).toThrow(
      /invalid fxratetogbp|invalid fxrateusdtogbp/i,
    );
  });

  it("rejects a negative percentage markup", () => {
    expect(() =>
      computePhoneNumberPrice(1, { markupType: "percentage", markupValue: -10, fxRateUsdToGbp: 0.8 }),
    ).toThrow(/invalid percentage/i);
  });
});
