import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const LEGACY_ENDPOINT =
  "https://spark-orchestrate.lovable.app/api/public/agents/register";
const DEFAULT_ENDPOINT =
  "https://project--5ac2a13e-280d-409c-99e9-989a09464b56.lovable.app/api/public/agents/register";

function normalizeEndpoint(endpoint?: string | null) {
  const value = endpoint?.trim();
  if (!value || value === LEGACY_ENDPOINT) return DEFAULT_ENDPOINT;
  return value;
}

function normalizeApiToken(token: string) {
  return token
    .trim()
    .replace(/^Bearer\s+/i, "")
    .replace(/^["']|["']$/g, "")
    .trim();
}

export interface DashboardSyncSettingsDTO {
  endpoint_url: string;
  api_token_last4: string | null;
  has_token: boolean;
  sync_enabled: boolean;
  last_synced_at: string | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
}

function last4(token: string) {
  const t = token.trim();
  return t.length <= 4 ? t : t.slice(-4);
}

export const getDashboardSyncSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DashboardSyncSettingsDTO> => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("dashboard_sync_settings")
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) {
      return {
        endpoint_url: DEFAULT_ENDPOINT,
        api_token_last4: null,
        has_token: false,
        sync_enabled: false,
        last_synced_at: null,
        last_sync_status: null,
        last_sync_error: null,
      };
    }
    return {
      endpoint_url: normalizeEndpoint(data.endpoint_url as string | null),
      api_token_last4: (data.api_token_last4 as string | null) ?? null,
      has_token: Boolean(data.api_token),
      sync_enabled: Boolean(data.sync_enabled),
      last_synced_at: (data.last_synced_at as string | null) ?? null,
      last_sync_status: (data.last_sync_status as string | null) ?? null,
      last_sync_error: (data.last_sync_error as string | null) ?? null,
    };
  });

export const saveDashboardSyncSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      endpoint_url?: string;
      api_token?: string | null; // null = clear, undefined = unchanged
      sync_enabled?: boolean;
    }) => input,
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;

    const patch: Record<string, unknown> = { user_id: userId };
    let savedToken = false;
    if (typeof data.endpoint_url === "string") {
      const url = normalizeEndpoint(data.endpoint_url);
      try {
        new URL(url);
      } catch {
        throw new Error("Endpoint URL must be a valid URL");
      }
      patch.endpoint_url = url;
    }
    if (data.api_token !== undefined) {
      const normalizedToken =
        data.api_token === null ? "" : normalizeApiToken(data.api_token);
      if (data.api_token === null || normalizedToken === "") {
        patch.api_token = null;
        patch.api_token_last4 = null;
      } else {
        patch.api_token = normalizedToken;
        patch.api_token_last4 = last4(normalizedToken);
        savedToken = true;
        // Saving a valid token means dashboard sync should become active.
        patch.sync_enabled = true;
        // Always correct legacy/blank endpoints when saving a token.
        patch.endpoint_url = normalizeEndpoint(data.endpoint_url);
      }
    }
    if (typeof data.sync_enabled === "boolean" && !savedToken) {
      patch.sync_enabled = data.sync_enabled;
    }

    const { error } = await supabase
      .from("dashboard_sync_settings")
      .upsert(patch as never, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const testDashboardSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input?: { endpoint_url?: string; api_token?: string | null }) =>
      input ?? {},
  )
  .handler(async ({ context, data: input }) => {
    const { userId } = context;
    const { data: saved, error } = await supabaseAdmin
      .from("dashboard_sync_settings")
      .select("endpoint_url, api_token")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const endpoint = normalizeEndpoint(
      input.endpoint_url ?? (saved?.endpoint_url as string | null),
    );
    const token = input.api_token
      ? normalizeApiToken(input.api_token)
      : saved?.api_token
        ? normalizeApiToken(saved.api_token as string)
        : null;
    if (!token) {
      return { ok: false, status: 0, body: "No API token saved." };
    }
    const payload = {
      retellAgentId: null,
      name: "WEBE BUILDER test",
      agentType: "lead_generation",
      inboundPhoneNumber: null,
      retellConversationFlowId: null,
      integrations: {
        calcom: null,
        twilio: null,
        timezone: "UTC",
        businessName: "WEBE BUILDER test",
        notificationEmail: null,
      },
    };
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const body = await res.text();
      const authenticated =
        res.ok ||
        (res.status === 400 &&
          /Validation failed|Invalid JSON body/i.test(body));
      return {
        ok: authenticated,
        status: authenticated ? 200 : res.status,
        body: authenticated
          ? `Token accepted by WE BE SMART DASH. The endpoint is reachable. Auth passed before the endpoint returned ${res.status}.`
          : body.slice(0, 2000),
      };
    } catch (e) {
      return { ok: false, status: 0, body: (e as Error).message };
    }
  });
