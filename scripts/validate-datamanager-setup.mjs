// VALIDATE-ONLY: dry-run a Data Manager ingest for the admin workspace.
// validateOnly:true — nothing is recorded on Google's side. Also reports the
// token's granted scopes honestly (expected to lack datamanager until reconnect).
import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";

const WS = process.env.WS_ID ?? "c13db1d5-22e4-44ad-b678-6f296c31a947";
const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const sb = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: ps, error } = await sb
  .from("provider_settings").select("credentials")
  .eq("workspace_id", WS).eq("provider_category", "advertising")
  .eq("provider_name", "google_ads").maybeSingle();
if (error) throw error;
const c = ps?.credentials ?? {};
if (!c.refreshToken || !c.clientId || !c.clientSecret) {
  console.log(JSON.stringify({ fatal: "missing creds" })); process.exit(1);
}
console.log(JSON.stringify({ storedGrantedScopes: c.grantedScopes ?? null, uploadConversionActionId: c.uploadConversionActionId ?? null }));

const tokRes = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "refresh_token", refresh_token: c.refreshToken,
    client_id: c.clientId, client_secret: c.clientSecret,
  }),
});
const tok = await tokRes.json();
if (!tokRes.ok) { console.log(JSON.stringify({ fatal: "oauth", err: tok })); process.exit(1); }
console.log(JSON.stringify({ tokenScopes: tok.scope ?? null }));

const { data: acc } = await sb
  .from("growthmind_ads_accounts").select("customer_id, login_customer_id")
  .eq("workspace_id", WS).eq("platform", "google")
  .not("customer_id", "is", null).limit(1).maybeSingle();
const operating = (acc?.customer_id ?? "").replace(/\D/g, "");
const login = (acc?.login_customer_id ?? c.managerId ?? "").replace(/\D/g, "");

const destination = {
  operatingAccount: { accountType: "GOOGLE_ADS", accountId: operating },
  productDestinationId: String(c.uploadConversionActionId ?? ""),
};
if (login && login !== operating) destination.loginAccount = { accountType: "GOOGLE_ADS", accountId: login };

const body = {
  destinations: [destination],
  encoding: "HEX",
  events: [{
    transactionId: `validate-${Date.now()}`,
    eventTimestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    eventSource: "WEB",
    eventName: "webee_qualified_lead",
    consent: { adUserData: "CONSENT_GRANTED", adPersonalization: "CONSENT_GRANTED" },
    userData: { userIdentifiers: [{ emailAddress: createHash("sha256").update("validation@webee.invalid").digest("hex") }] },
  }],
  validateOnly: true,
};

const res = await fetch("https://datamanager.googleapis.com/v1/events:ingest", {
  method: "POST",
  headers: { Authorization: `Bearer ${tok.access_token}`, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const json = await res.json().catch(() => ({}));
console.log(JSON.stringify({ httpStatus: res.status, ok: res.ok, response: json }, null, 2));
