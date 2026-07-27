// 1) READ-ONLY readiness checks on Google Ads (customer settings).
// 2) Save uploadConversionActionId into THIS workspace's google_ads provider
//    settings (merge, never clobber other credential keys). No Ads mutations.
import { createClient } from "@supabase/supabase-js";

const WS = "c13db1d5-22e4-44ad-b678-6f296c31a947";
const CID = "3550820264";
const ACTION_ID = "7699121648";
const ACTION_RESOURCE = `customers/${CID}/conversionActions/${ACTION_ID}`;

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const sb = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: ps, error } = await sb
  .from("provider_settings")
  .select("id, credentials")
  .eq("workspace_id", WS)
  .eq("provider_category", "advertising")
  .eq("provider_name", "google_ads")
  .maybeSingle();
if (error || !ps) throw error ?? new Error("no provider_settings row");
const c = ps.credentials ?? {};

const tokRes = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: c.refreshToken,
    client_id: c.clientId,
    client_secret: c.clientSecret,
  }),
});
const tok = await tokRes.json();
if (!tokRes.ok) throw new Error("oauth: " + tok.error);

const ver = process.env.GOOGLE_ADS_API_VERSION?.trim() || "v21";
const headers = {
  Authorization: `Bearer ${tok.access_token}`,
  "developer-token": c.developerToken,
  "Content-Type": "application/json",
};
const login = (c.managerId ?? "").replace(/\D/g, "");
if (login) headers["login-customer-id"] = login;

async function gaql(query) {
  const res = await fetch(`https://googleads.googleapis.com/${ver}/customers/${CID}/googleAds:search`, {
    method: "POST", headers, body: JSON.stringify({ query }),
  });
  const json = await res.json();
  if (!res.ok) return { error: json.error?.message ?? res.status };
  return { results: json.results ?? [] };
}

const cust = await gaql(`
  SELECT customer.auto_tagging_enabled,
         customer.conversion_tracking_setting.conversion_tracking_status,
         customer.conversion_tracking_setting.accepted_customer_data_terms,
         customer.conversion_tracking_setting.enhanced_conversions_for_leads_enabled,
         customer.conversion_tracking_setting.conversion_tracking_id
  FROM customer`);

// Merge-save the config (workspace-scoped provider_settings row).
const merged = {
  ...c,
  uploadConversionActionId: ACTION_ID,
  uploadConversionActionResourceName: ACTION_RESOURCE,
};
const { error: upErr } = await sb
  .from("provider_settings")
  .update({ credentials: merged, updated_at: new Date().toISOString() })
  .eq("id", ps.id);
if (upErr) throw upErr;

// Verify save + workspace isolation (no other workspace rows carry this value).
const { data: verify } = await sb
  .from("provider_settings")
  .select("workspace_id, credentials")
  .eq("provider_name", "google_ads")
  .eq("provider_category", "advertising");
const rowsWithAction = (verify ?? []).filter(
  (r) => r.credentials?.uploadConversionActionId === ACTION_ID,
);

console.log(JSON.stringify({
  customerSettings: cust.results?.[0]?.customer ?? cust.error,
  saved: {
    uploadConversionActionId: ACTION_ID,
    resourceName: ACTION_RESOURCE,
    workspacesWithThisAction: rowsWithAction.map((r) => r.workspace_id),
    totalGoogleAdsSettingsRows: (verify ?? []).length,
  },
}, null, 2));
