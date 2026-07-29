// READ-ONLY: locate the "WEBEE Qualified Lead" offline conversion action in
// the connected Google Ads account. No mutations to Google Ads.
import { createClient } from "@supabase/supabase-js";

const WS = "c13db1d5-22e4-44ad-b678-6f296c31a947";
const CID = "3550820264";
const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const sb = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: ps, error } = await sb
  .from("provider_settings")
  .select("credentials")
  .eq("workspace_id", WS)
  .eq("provider_category", "advertising")
  .eq("provider_name", "google_ads")
  .maybeSingle();
if (error) throw error;
const c = ps?.credentials ?? {};
if (!c.refreshToken || !c.clientId || !c.clientSecret || !c.developerToken) {
  console.log(JSON.stringify({ fatal: "missing creds", have: Object.keys(c) }));
  process.exit(1);
}

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
if (!tokRes.ok) { console.log(JSON.stringify({ fatal: "oauth", err: tok.error })); process.exit(1); }

const { data: acc } = await sb
  .from("growthmind_ads_accounts")
  .select("customer_id, login_customer_id")
  .eq("workspace_id", WS)
  .eq("platform", "google")
  .not("customer_id", "is", null)
  .limit(1)
  .maybeSingle();

const ver = process.env.GOOGLE_ADS_API_VERSION?.trim() || "v21";
const headers = {
  Authorization: `Bearer ${tok.access_token}`,
  "developer-token": c.developerToken,
  "Content-Type": "application/json",
};
const login = (acc?.login_customer_id ?? c.managerId ?? "").replace(/\D/g, "");
if (login) headers["login-customer-id"] = login;

const gaql = `
  SELECT conversion_action.id, conversion_action.name, conversion_action.resource_name,
         conversion_action.type, conversion_action.category, conversion_action.status,
         conversion_action.primary_for_goal, conversion_action.owner_customer,
         conversion_action.include_in_conversions_metric
  FROM conversion_action`;
const res = await fetch(`https://googleads.googleapis.com/${ver}/customers/${CID}/googleAds:search`, {
  method: "POST",
  headers,
  body: JSON.stringify({ query: gaql }),
});
const json = await res.json();
if (!res.ok) { console.log(JSON.stringify({ fatal: "gaql", status: res.status, err: json.error?.message ?? json }, null, 2)); process.exit(1); }
console.log(JSON.stringify({
  dbCustomerId: acc?.customer_id ?? null,
  loginUsed: login || null,
  actions: (json.results ?? []).map((r) => r.conversionAction),
}, null, 2));
