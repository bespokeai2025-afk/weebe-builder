import { supabaseAdmin } from "@/integrations/supabase/client.server";
import * as api from "@/lib/integrations/webespokeEnterprise/client.server";
import { getWebespokeAdminCreds } from "@/lib/integrations/webespokeEnterprise/webespoke-env.server";

const INTEGRATION_KEY = "webespoke_enterprise";
const CLIENT_NAME = "Webuyanyhouse";

export type WbahEnterpriseTokenCallbacks = {
  getTokens: () => Promise<{ accessToken: string; refreshToken: string }>;
  saveNewAccessToken: (token: string) => Promise<void>;
  reloginFn: () => Promise<{ accessToken: string } | null>;
};

/** Server-side WeeBespoke UAT token callbacks for WBAH post-call writes. */
export async function getWbahEnterpriseTokenCallbacks(): Promise<WbahEnterpriseTokenCallbacks> {
  const { data: integration } = await (supabaseAdmin as any)
    .from("enterprise_integrations")
    .select("access_token, refresh_token, status, user_payload")
    .eq("integration_key", INTEGRATION_KEY)
    .eq("client_name", CLIENT_NAME)
    .maybeSingle();

  if (!integration?.access_token || integration.status !== "connected") {
    throw new Error("WeeBespoke API not connected — connect Webuyanyhouse enterprise integration first");
  }

  let currentAccessToken = integration.access_token as string;
  let currentRefreshToken = (integration.refresh_token ?? "") as string;

  const fileCreds = getWebespokeAdminCreds();
  const email = fileCreds?.email ?? (integration.user_payload as { email?: string })?.email;
  const password = fileCreds?.password;

  const reloginFn = async (): Promise<{ accessToken: string } | null> => {
    if (!email || !password) return null;
    const loginRes = await api.loginWithPassword(email, password);
    const parsed = api.parseWeeBespokeAuthEnvelope(loginRes.data);
    if (!loginRes.ok || !parsed?.accessToken) return null;
    await (supabaseAdmin as any)
      .from("enterprise_integrations")
      .update({
        access_token: parsed.accessToken,
        refresh_token: parsed.refreshToken || currentRefreshToken,
        status: "connected",
        user_payload: { email },
      })
      .eq("integration_key", INTEGRATION_KEY)
      .eq("client_name", CLIENT_NAME);
    currentAccessToken = parsed.accessToken;
    currentRefreshToken = parsed.refreshToken || currentRefreshToken;
    return { accessToken: parsed.accessToken };
  };

  if (password && email) {
    const fresh = await reloginFn();
    if (fresh?.accessToken) currentAccessToken = fresh.accessToken;
  }

  const getTokens = async () => ({
    accessToken: currentAccessToken,
    refreshToken: currentRefreshToken,
  });

  const saveNewAccessToken = async (token: string) => {
    await (supabaseAdmin as any)
      .from("enterprise_integrations")
      .update({ access_token: token, status: "connected" })
      .eq("integration_key", INTEGRATION_KEY)
      .eq("client_name", CLIENT_NAME);
    currentAccessToken = token;
  };

  return { getTokens, saveNewAccessToken, reloginFn };
}

export type WbahCallOutputCreateBody = {
  leadId: string;
  event: string;
  raw_data: Record<string, unknown>;
  customer_name?: string | null;
  email?: string | null;
  appointment_date?: string | null;
  appointment_time?: string | null;
  booking_status?: string | null;
  calendly_booking_url?: string | null;
  call_summary?: string | null;
  sentiment_analysis?: string | null;
  call_successful?: boolean | null;
  callback_datetime?: string | null;
  callback_datetime_raw?: string | null;
  callback_type?: string | null;
  is_callback_request?: boolean | null;
  retell_call_id?: string | null;
};

export async function postWbahCallOutputCreate(body: WbahCallOutputCreateBody): Promise<void> {
  const { getTokens, saveNewAccessToken, reloginFn } = await getWbahEnterpriseTokenCallbacks();
  const res = await api.authenticatedFetch<unknown>(
    "/call-output-data/create",
    { method: "POST", body: JSON.stringify(body) },
    getTokens,
    saveNewAccessToken,
    reloginFn,
  );
  if (!res.ok) {
    throw new Error(
      `WeeBespoke call-output-data/create failed (${res.status}): ${res.error ?? JSON.stringify(res.data).slice(0, 300)}`,
    );
  }
  console.log("[WBAH POST-CALL] call-output-data/create ok", {
    leadId: body.leadId,
    retell_call_id: body.retell_call_id,
    status: res.status,
    result: typeof res.data === "object" ? (res.data as Record<string, unknown>)?.result : res.data,
  });
}
