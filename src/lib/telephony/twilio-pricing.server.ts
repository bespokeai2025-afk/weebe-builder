/**
 * Twilio reseller model: number pricing + markup.
 *
 * fetchTwilioNumberPrice() gets Twilio's own real cost for a number type in a
 * country (cached 24h — the cost is the same for every workspace, so one
 * cache row per (country, number type) serves everyone). computePhoneNumberPrice()
 * is the pure markup calculation applied on top of that cost. Neither
 * function purchases a number or charges anything — this module is pricing
 * only; the purchase flow (plan step 5) is what actually spends money.
 */
import { resolveMasterTwilioCredentials } from "./twilio-env";

export type TwilioNumberType = "local" | "mobile" | "national" | "toll free";

export interface TwilioNumberPrice {
  isoCountry: string;
  numberType: TwilioNumberType;
  currentPriceUsd: number;
  basePriceUsd: number;
  priceUnit: string;
}

export interface MarkupRule {
  markupType: "fixed" | "percentage";
  /** fixed: a flat GBP-pence addition on top of the converted cost. percentage: e.g. 30 means +30%. */
  markupValue: number;
  fxRateUsdToGbp: number;
}

export interface ComputedPhoneNumberPrice {
  costUsdCents: number;
  costGbpPence: number;
  priceGbpPence: number;
}

/**
 * Resolve the markup rule that applies to a workspace: an active
 * workspace-scoped override if one exists, else the active global default.
 * Throws if neither is configured — purchasing requires a real markup rule
 * to exist, not a silent zero-markup fallback.
 */
export async function resolveMarkupRule(sb: DbClient, workspaceId: string): Promise<MarkupRule> {
  const { data: workspaceRule } = await sb
    .from("phone_number_markup_rules")
    .select("markup_type, markup_value, fx_rate_usd_to_gbp")
    .eq("scope", "workspace")
    .eq("workspace_id", workspaceId)
    .eq("is_active", true)
    .maybeSingle();

  const row =
    workspaceRule ??
    (
      await sb
        .from("phone_number_markup_rules")
        .select("markup_type, markup_value, fx_rate_usd_to_gbp")
        .eq("scope", "global")
        .eq("is_active", true)
        .maybeSingle()
    ).data;

  if (!row) {
    throw new Error(
      "No active phone number markup rule is configured (neither workspace-specific nor global). An admin must set one before numbers can be purchased.",
    );
  }

  return {
    markupType: row.markup_type as "fixed" | "percentage",
    markupValue: Number(row.markup_value),
    fxRateUsdToGbp: Number(row.fx_rate_usd_to_gbp),
  };
}

type DbClient = { from: (table: string) => any };

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

async function readCachedPrice(
  sb: DbClient,
  isoCountry: string,
  numberType: TwilioNumberType,
): Promise<TwilioNumberPrice | null> {
  const { data } = await sb
    .from("twilio_number_price_cache")
    .select("current_price_usd, base_price_usd, price_unit, fetched_at")
    .eq("iso_country", isoCountry)
    .eq("number_type", numberType)
    .maybeSingle();

  if (!data) return null;

  const fetchedAt = new Date(data.fetched_at as string).getTime();
  if (!Number.isFinite(fetchedAt) || Date.now() - fetchedAt > CACHE_TTL_MS) return null;

  return {
    isoCountry,
    numberType,
    currentPriceUsd: Number(data.current_price_usd),
    basePriceUsd: Number(data.base_price_usd),
    priceUnit: String(data.price_unit),
  };
}

async function writeCachedPrice(sb: DbClient, price: TwilioNumberPrice): Promise<void> {
  await sb.from("twilio_number_price_cache").upsert(
    {
      iso_country: price.isoCountry,
      number_type: price.numberType,
      current_price_usd: price.currentPriceUsd,
      base_price_usd: price.basePriceUsd,
      price_unit: price.priceUnit,
      fetched_at: new Date().toISOString(),
    },
    { onConflict: "iso_country,number_type" },
  );
}

/**
 * Twilio's real cost for a number type in a country, cached 24h. Only ever
 * uses WEBEE's master account credentials (this is an account-holder-level
 * lookup, not scoped to any workspace).
 */
export async function fetchTwilioNumberPrice(
  sb: DbClient,
  params: { isoCountry: string; numberType: TwilioNumberType },
  fetchImpl: typeof fetch = fetch,
): Promise<TwilioNumberPrice> {
  const cached = await readCachedPrice(sb, params.isoCountry, params.numberType);
  if (cached) return cached;

  const { accountSid, authToken } = resolveMasterTwilioCredentials();
  const basicAuth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const url = `https://pricing.twilio.com/v1/PhoneNumbers/Countries/${encodeURIComponent(params.isoCountry)}`;

  const res = await fetchImpl(url, { headers: { Authorization: `Basic ${basicAuth}` } });
  if (!res.ok) {
    throw new Error(`Twilio Pricing API returned ${res.status} for country ${params.isoCountry}`);
  }

  const body = (await res.json()) as {
    price_unit: string;
    phone_number_prices?: Array<{ number_type: string; base_price: string; current_price: string }>;
  };
  const entry = body.phone_number_prices?.find((p) => p.number_type === params.numberType);
  if (!entry) {
    throw new Error(`No Twilio pricing entry for "${params.numberType}" numbers in ${params.isoCountry}`);
  }

  const price: TwilioNumberPrice = {
    isoCountry: params.isoCountry,
    numberType: params.numberType,
    currentPriceUsd: Number(entry.current_price),
    basePriceUsd: Number(entry.base_price),
    priceUnit: body.price_unit,
  };

  await writeCachedPrice(sb, price);
  return price;
}

/**
 * Apply WEBEE's markup on top of Twilio's real USD cost, converting to the
 * GBP pence a workspace is actually charged. Pure — no I/O, no side effects.
 */
export function computePhoneNumberPrice(costUsd: number, rule: MarkupRule): ComputedPhoneNumberPrice {
  if (!Number.isFinite(costUsd) || costUsd < 0) {
    throw new Error(`Invalid costUsd: ${costUsd}`);
  }
  if (!Number.isFinite(rule.fxRateUsdToGbp) || rule.fxRateUsdToGbp <= 0) {
    throw new Error(`Invalid fxRateUsdToGbp: ${rule.fxRateUsdToGbp}`);
  }
  if (rule.markupType === "percentage" && rule.markupValue < 0) {
    throw new Error(`Invalid percentage markupValue: ${rule.markupValue}`);
  }

  const costUsdCents = Math.round(costUsd * 100);
  const costGbpPence = Math.round(costUsd * rule.fxRateUsdToGbp * 100);
  const priceGbpPence =
    rule.markupType === "fixed"
      ? costGbpPence + Math.round(rule.markupValue)
      : Math.round(costGbpPence * (1 + rule.markupValue / 100));

  return { costUsdCents, costGbpPence, priceGbpPence };
}
