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

export interface DashboardSyncAgent {
  name: string;
  agent_type?: string;
  retell_agent_id?: string | null;
  retell_conversation_flow_id?: string | null;
  inbound_phone_number?: string | null;
  flow_data?: unknown;
  variables?: unknown;
  settings?: unknown;
}

export interface DashboardSyncResult {
  ok: boolean;
  skipped?: "disabled" | "no-token" | "no-settings";
  status?: number;
  error?: string;
}

/**
 * Best-effort POST of an agent to the user's configured Spark Orchestrate
 * dashboard. Never throws — failures are recorded on dashboard_sync_settings
 * and returned in the result so callers can surface a non-blocking toast.
 */
export async function pushAgentToDashboard(
  userId: string,
  agent: DashboardSyncAgent,
): Promise<DashboardSyncResult> {
  const { data: settings, error } = await supabaseAdmin
    .from("dashboard_sync_settings")
    .select("endpoint_url, api_token, sync_enabled")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    return { ok: false, error: error.message };
  }
  if (!settings) return { ok: false, skipped: "no-settings" };
  if (!settings.sync_enabled) return { ok: false, skipped: "disabled" };
  const token = settings.api_token
    ? normalizeApiToken(settings.api_token as string)
    : null;
  if (!token) return { ok: false, skipped: "no-token" };

  const endpoint = normalizeEndpoint(settings.endpoint_url as string | null);

  // Enrich with workspace calendar config + profile email for integrations block.
  const [{ data: cal }, { data: profile }] = await Promise.all([
    supabaseAdmin
      .from("workspace_calendar_settings")
      .select("calcom_api_key, default_event_type_id, timezone")
      .eq("user_id", userId)
      .maybeSingle(),
    supabaseAdmin
      .from("profiles")
      .select("email")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  const agentSettings =
    (agent.settings && typeof agent.settings === "object"
      ? (agent.settings as Record<string, unknown>)
      : {}) || {};
  const twilio =
    (agentSettings.twilio && typeof agentSettings.twilio === "object"
      ? (agentSettings.twilio as Record<string, unknown>)
      : {}) || {};
  const calOverride =
    (agentSettings.calcom && typeof agentSettings.calcom === "object"
      ? (agentSettings.calcom as Record<string, unknown>)
      : {}) || {};

  const calApiToken =
    (calOverride.apiToken as string | undefined) ??
    (cal?.calcom_api_key as string | undefined) ??
    null;
  const calEventTypeId =
    (calOverride.eventTypeId as string | number | undefined) ??
    (cal?.default_event_type_id as number | undefined) ??
    null;

  const body = {
    retellAgentId: agent.retell_agent_id ?? null,
    name: agent.name,
    agentType:
      agent.agent_type === "lead_generation" ? "lead_gen" : agent.agent_type ?? "lead_gen",
    inboundPhoneNumber: agent.inbound_phone_number ?? null,
    retellConversationFlowId: agent.retell_conversation_flow_id ?? null,
    integrations: {
      calcom: calApiToken
        ? {
            apiToken: calApiToken,
            eventTypeId: calEventTypeId ? String(calEventTypeId) : null,
          }
        : null,
      twilio:
        twilio.authToken || twilio.phoneId
          ? {
              authToken: (twilio.authToken as string) ?? null,
              phoneId: (twilio.phoneId as string) ?? null,
            }
          : null,
      timezone:
        (agentSettings.timezone as string | undefined) ??
        (cal?.timezone as string | undefined) ??
        "UTC",
      businessName:
        (agentSettings.businessName as string | undefined) ?? agent.name,
      notificationEmail:
        (agentSettings.notificationEmail as string | undefined) ??
        (profile?.email as string | undefined) ??
        null,
    },
    flowData: agent.flow_data ?? null,
    variables: agent.variables ?? [],
  };

  let status = 0;
  let ok = false;
  let errorMessage: string | null = null;
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    status = res.status;
    ok = res.ok;
    if (!ok) {
      const text = await res.text();
      errorMessage = text.slice(0, 1000);
      console.error("[dashboard-sync] non-2xx", { status, body: errorMessage });
    }
  } catch (e) {
    errorMessage = (e as Error).message;
    console.error("[dashboard-sync] fetch failed", errorMessage);
  }

  await supabaseAdmin
    .from("dashboard_sync_settings")
    .update({
      last_synced_at: new Date().toISOString(),
      last_sync_status: ok ? `ok:${status}` : `err:${status || "0"}`,
      last_sync_error: ok ? null : errorMessage,
    })
    .eq("user_id", userId);

  return { ok, status, error: errorMessage ?? undefined };
}

/**
 * Infer an `agent_type` from builder settings/flow. Falls back to "lead_gen".
 */
export function inferAgentType(settings: unknown, flowData: unknown): string {
  const s =
    settings && typeof settings === "object" && !Array.isArray(settings)
      ? (settings as Record<string, unknown>)
      : {};
  const explicit = typeof s.agentType === "string" ? s.agentType : null;
  if (explicit) return explicit;

  const calendarConnected =
    Boolean(s.calcom) ||
    (flowData &&
      typeof flowData === "object" &&
      JSON.stringify(flowData).includes("book_appointment"));
  if (calendarConnected) return "receptionist";
  return "lead_gen";
}
