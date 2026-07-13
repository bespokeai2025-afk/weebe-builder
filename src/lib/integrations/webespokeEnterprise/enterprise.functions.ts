import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  loginWithPassword,
  parseWeeBespokeAuthEnvelope,
  requestOtp,
  verifyOtp,
  getAllCars,
  getAllBuyers,
  getAllDealers,
} from "./client.server";

const INTEGRATION_KEY = "webespoke_enterprise";
const CLIENT_NAME = "Webuyanyhouse";

// ── Token helpers (server-only — never returned to browser) ───────────────────

async function getStoredTokens(): Promise<{ accessToken: string; refreshToken: string } | null> {
  const sb = supabaseAdmin as any;
  const { data } = await sb
    .from("enterprise_integrations")
    .select("access_token, refresh_token, status")
    .eq("integration_key", INTEGRATION_KEY)
    .eq("client_name", CLIENT_NAME)
    .maybeSingle();

  if (!data || data.status !== "connected" || !data.access_token) return null;
  return { accessToken: data.access_token, refreshToken: data.refresh_token ?? "" };
}

async function saveTokens(accessToken: string, refreshToken: string, user?: unknown): Promise<void> {
  const sb = supabaseAdmin as any;
  await sb.from("enterprise_integrations").upsert(
    {
      integration_key: INTEGRATION_KEY,
      client_name: CLIENT_NAME,
      access_token: accessToken,
      refresh_token: refreshToken,
      user_payload: user ?? null,
      status: "connected",
    },
    { onConflict: "integration_key,client_name" },
  );
}

async function saveNewAccessToken(token: string): Promise<void> {
  const sb = supabaseAdmin as any;
  await sb
    .from("enterprise_integrations")
    .update({ access_token: token, status: "connected" })
    .eq("integration_key", INTEGRATION_KEY)
    .eq("client_name", CLIENT_NAME);
}

async function markDisconnected(): Promise<void> {
  const sb = supabaseAdmin as any;
  await sb
    .from("enterprise_integrations")
    .update({ access_token: null, refresh_token: null, user_payload: null, status: "disconnected" })
    .eq("integration_key", INTEGRATION_KEY)
    .eq("client_name", CLIENT_NAME);
}

function makeTokenCallbacks() {
  return {
    getTokens: async () => {
      const tokens = await getStoredTokens();
      if (!tokens) throw new Error("Not connected — please reconnect WeeBespoke AI Enterprise");
      return tokens;
    },
    saveNewAccessToken: async (token: string) => {
      await saveNewAccessToken(token);
    },
  };
}

// ── Upsert cache helper ───────────────────────────────────────────────────────

async function upsertCache(dataType: string, records: unknown[]): Promise<void> {
  const sb = supabaseAdmin as any;

  // Clear existing cached records for this type
  await sb
    .from("webespoke_enterprise_cache")
    .delete()
    .eq("client_name", CLIENT_NAME)
    .eq("data_type", dataType);

  if (!records.length) return;

  const rows = records.map((r: any) => ({
    client_name: CLIENT_NAME,
    data_type:   dataType,
    external_id: r?.id ? String(r.id) : r?._id ? String(r._id) : null,
    payload:     r,
  }));

  await sb.from("webespoke_enterprise_cache").insert(rows);
}

async function readCache(dataType: string): Promise<unknown[]> {
  const sb = supabaseAdmin as any;
  const { data } = await sb
    .from("webespoke_enterprise_cache")
    .select("payload, external_id, synced_at")
    .eq("client_name", CLIENT_NAME)
    .eq("data_type", dataType)
    .order("synced_at", { ascending: false });
  return (data ?? []).map((r: any) => r.payload);
}

// ── Server functions ──────────────────────────────────────────────────────────

export const requestWebespokeEnterpriseOtp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((i: { email: string }) =>
    z.object({ email: z.string().email() }).parse(i),
  )
  .handler(async ({ data }) => {
    const res = await requestOtp(data.email);
    if (!res.ok) {
      throw new Error(
        res.error ?? `OTP request failed (HTTP ${res.status}). Check the email address.`,
      );
    }
    // Mark as OTP-sent in DB
    const sb = supabaseAdmin as any;
    await sb.from("enterprise_integrations").upsert(
      {
        integration_key: INTEGRATION_KEY,
        client_name:     CLIENT_NAME,
        status:          "otp_sent",
      },
      { onConflict: "integration_key,client_name" },
    );
    return { ok: true, message: (res.data as any)?.message ?? "OTP sent" };
  });

export const verifyWebespokeEnterpriseOtp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((i: { email: string; otp: string }) =>
    z.object({ email: z.string().email(), otp: z.string().min(4) }).parse(i),
  )
  .handler(async ({ data }) => {
    const res = await verifyOtp(data.email, data.otp);
    if (!res.ok || !res.data) {
      throw new Error(
        res.error ?? "OTP verification failed. Check the code and try again.",
      );
    }
    const d = res.data;
    const accessToken  = d.accessToken ?? d.token;
    const refreshToken = d.refreshToken ?? "";
    const user         = d.user ?? null;

    if (!accessToken) {
      throw new Error("Verification succeeded but no access token was returned.");
    }

    // Store server-side only — never returned to browser
    await saveTokens(accessToken, refreshToken, user);
    return { ok: true };
  });

export const getWebespokeEnterpriseStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .handler(async () => {
    const sb = supabaseAdmin as any;
    const { data } = await sb
      .from("enterprise_integrations")
      .select("status, updated_at, user_payload")
      .eq("integration_key", INTEGRATION_KEY)
      .eq("client_name", CLIENT_NAME)
      .maybeSingle();

    const cacheQ = await sb
      .from("webespoke_enterprise_cache")
      .select("data_type")
      .eq("client_name", CLIENT_NAME);

    const typeCounts: Record<string, number> = {};
    for (const row of (cacheQ.data ?? []) as any[]) {
      typeCounts[row.data_type] = (typeCounts[row.data_type] ?? 0) + 1;
    }

    return {
      status:      (data?.status ?? "disconnected") as string,
      updatedAt:   data?.updated_at ?? null,
      userEmail:   (data?.user_payload as any)?.email ?? null,
      carsCount:   typeCounts["cars"]    ?? 0,
      buyersCount: typeCounts["buyers"]  ?? 0,
      dealersCount:typeCounts["dealers"] ?? 0,
    };
  });

export const disconnectWebespokeEnterprise = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .handler(async () => {
    await markDisconnected();
    const sb = supabaseAdmin as any;
    await sb
      .from("webespoke_enterprise_cache")
      .delete()
      .eq("client_name", CLIENT_NAME);
    return { ok: true };
  });

export const syncWebespokeEnterpriseCars = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .handler(async () => {
    const { getTokens, saveNewAccessToken: save } = makeTokenCallbacks();
    const res = await getAllCars(getTokens, save);
    if (!res.ok) {
      if (res.status === 401) await markDisconnected();
      throw new Error(res.error ?? "Failed to fetch cars from WeeBespoke AI");
    }
    const records = Array.isArray(res.data) ? res.data : (res.data ? [res.data] : []);
    await upsertCache("cars", records);
    return { ok: true, count: records.length };
  });

export const syncWebespokeEnterpriseBuyers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .handler(async () => {
    const { getTokens, saveNewAccessToken: save } = makeTokenCallbacks();
    const res = await getAllBuyers(getTokens, save);
    if (!res.ok) {
      if (res.status === 401) await markDisconnected();
      throw new Error(res.error ?? "Failed to fetch buyers from WeeBespoke AI");
    }
    const records = Array.isArray(res.data) ? res.data : (res.data ? [res.data] : []);
    await upsertCache("buyers", records);
    return { ok: true, count: records.length };
  });

export const syncWebespokeEnterpriseDealers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .handler(async () => {
    const { getTokens, saveNewAccessToken: save } = makeTokenCallbacks();
    const res = await getAllDealers(getTokens, save);
    if (!res.ok) {
      if (res.status === 401) await markDisconnected();
      throw new Error(res.error ?? "Failed to fetch dealers from WeeBespoke AI");
    }
    const records = Array.isArray(res.data) ? res.data : (res.data ? [res.data] : []);
    await upsertCache("dealers", records);
    return { ok: true, count: records.length };
  });

export const getWebespokeEnterpriseCars = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .handler(async () => readCache("cars"));

export const getWebespokeEnterpriseBuyers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .handler(async () => readCache("buyers"));

export const getWebespokeEnterpriseDealers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .handler(async () => readCache("dealers"));

// ── Admin override — connect using platform-stored credentials ────────────────
// Reads WEBESPOKE_ADMIN_EMAIL + WEBESPOKE_ADMIN_PASSWORD from server env vars.
// The password is NEVER sent to or from the browser.

export const adminOverrideConnectWebespokeEnterprise = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .handler(async () => {
    const email    = process.env.WEBESPOKE_ADMIN_EMAIL;
    const password = process.env.WEBESPOKE_ADMIN_PASSWORD;

    if (!email || !password) {
      throw new Error(
        "Admin credentials not configured. Set WEBESPOKE_ADMIN_EMAIL and WEBESPOKE_ADMIN_PASSWORD in Replit Secrets.",
      );
    }

    const res = await loginWithPassword(email, password);

    if (!res.ok || !res.data) {
      throw new Error(
        res.error
          ? `WeeBespoke AI login failed: ${res.error}`
          : `WeeBespoke AI login failed (HTTP ${res.status}). Check credentials.`,
      );
    }

    const parsed = parseWeeBespokeAuthEnvelope(res.data);
    if (!parsed) {
      throw new Error("Login succeeded but no access token was returned by WeeBespoke AI.");
    }

    // Persist server-side only — never returned to browser
    await saveTokens(parsed.accessToken, parsed.refreshToken, parsed.user ?? { email });
    return { ok: true, email };
  });

// ── Sync all data in one call ─────────────────────────────────────────────────

export const syncAllWebespokeEnterpriseData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .handler(async () => {
    const { getTokens, saveNewAccessToken: save } = makeTokenCallbacks();

    const [carsRes, buyersRes, dealersRes] = await Promise.allSettled([
      getAllCars(getTokens, save),
      getAllBuyers(getTokens, save),
      getAllDealers(getTokens, save),
    ]);

    const results: Record<string, number | string> = {};

    if (carsRes.status === "fulfilled" && carsRes.value.ok) {
      const records = Array.isArray(carsRes.value.data) ? carsRes.value.data : [];
      await upsertCache("cars", records);
      results.cars = records.length;
    } else {
      results.carsError = carsRes.status === "rejected"
        ? (carsRes.reason as any)?.message
        : carsRes.value.error ?? "Unknown error";
    }

    if (buyersRes.status === "fulfilled" && buyersRes.value.ok) {
      const records = Array.isArray(buyersRes.value.data) ? buyersRes.value.data : [];
      await upsertCache("buyers", records);
      results.buyers = records.length;
    } else {
      results.buyersError = buyersRes.status === "rejected"
        ? (buyersRes.reason as any)?.message
        : buyersRes.value.error ?? "Unknown error";
    }

    if (dealersRes.status === "fulfilled" && dealersRes.value.ok) {
      const records = Array.isArray(dealersRes.value.data) ? dealersRes.value.data : [];
      await upsertCache("dealers", records);
      results.dealers = records.length;
    } else {
      results.dealersError = dealersRes.status === "rejected"
        ? (dealersRes.reason as any)?.message
        : dealersRes.value.error ?? "Unknown error";
    }

    return results;
  });
