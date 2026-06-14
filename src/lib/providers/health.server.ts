import { supabaseAdmin } from "@/integrations/supabase/client.server";

// ── Adapter imports ────────────────────────────────────────────────────────────
import { OpenAILLMAdapter } from "./llm/adapters/openai.adapter";
import { GeminiLLMAdapter } from "./llm/adapters/gemini.adapter";
import { ClaudeLLMAdapter } from "./llm/adapters/claude.adapter";
import { RetellVoiceAdapter } from "./voice/adapters/retell.adapter";
import { OpenAIVoiceAdapter } from "./voice/adapters/openai.adapter";
import { ElevenLabsVoiceAdapter } from "./voice/adapters/elevenlabs.adapter";
import { ResendEmailAdapter } from "./email/adapters/resend.adapter";
import { GPTImageAdapter } from "./image/adapters/gpt-image.adapter";
import { ImagenAdapter } from "./image/adapters/imagen.adapter";
import { RunwayAdapter } from "./video/adapters/runway.adapter";
import { GoogleVeoAdapter } from "./video/adapters/google-veo.adapter";
import { PineconeAdapter } from "./knowledge/adapters/pinecone.adapter";
import { RetellKBAdapter } from "./knowledge/adapters/retell-kb.adapter";
import { CalComAdapter } from "./calendar/adapters/calcom.adapter";
import { GoogleCalendarAdapter } from "./calendar/adapters/google.adapter";
import { GoogleAnalyticsAdapter } from "./analytics/adapters/google-analytics.adapter";
import { GoogleAdsAdapter } from "./advertising/adapters/google-ads.adapter";
import { MetaAdsAdapter } from "./advertising/adapters/meta-ads.adapter";
import { upsertProviderSetting } from "./usage.server";

export interface HealthCheckResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

/**
 * Load stored credentials for a provider from provider_settings.credentials
 * merged with any relevant workspace_settings columns.
 */
async function loadCredentials(
  workspaceId: string,
  category: string,
  providerName: string,
): Promise<{ stored: Record<string, string>; ws: Record<string, string> }> {
  const sb = supabaseAdmin as any;

  const [settingsRow, wsRow] = await Promise.all([
    sb.from("provider_settings")
      .select("credentials")
      .eq("workspace_id", workspaceId)
      .eq("provider_category", category)
      .eq("provider_name", providerName)
      .maybeSingle()
      .then((r: any) => r.data),
    sb.from("workspace_settings")
      .select("retell_workspace_id, elevenlabs_api_key, openai_api_key, calcom_api_key, twilio_account_sid, twilio_auth_token, hubspot_api_key, ghl_api_key, resend_api_key")
      .eq("workspace_id", workspaceId)
      .maybeSingle()
      .then((r: any) => r.data ?? {}),
  ]);

  return {
    stored: (settingsRow?.credentials as Record<string, string>) ?? {},
    ws: wsRow ?? {},
  };
}

/**
 * Instantiate the adapter for a given category/provider and call its healthCheck().
 * Persists the result status to provider_settings.
 */
export async function runProviderHealthCheck(
  workspaceId: string,
  category: string,
  providerName: string,
): Promise<HealthCheckResult> {
  const t0 = Date.now();

  try {
    const { stored, ws } = await loadCredentials(workspaceId, category, providerName);

    const ok = await dispatchHealthCheck(category, providerName, stored, ws);
    const latencyMs = Date.now() - t0;

    // Persist status to DB
    await upsertProviderSetting({
      workspaceId,
      category,
      providerName,
      status: ok ? "connected" : "disconnected",
    }).catch(() => {});

    return { ok, latencyMs };
  } catch (err: any) {
    const latencyMs = Date.now() - t0;
    await upsertProviderSetting({
      workspaceId,
      category,
      providerName,
      status: "error",
    }).catch(() => {});
    return { ok: false, latencyMs, error: err?.message ?? "Unknown error" };
  }
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * Route to the correct adapter based on category + providerName,
 * merging stored credentials with workspace_settings fallbacks.
 */
async function dispatchHealthCheck(
  category: string,
  providerName: string,
  stored: Record<string, string>,
  ws: Record<string, string>,
): Promise<boolean> {
  switch (`${category}:${providerName}`) {

    // ── LLM ────────────────────────────────────────────────────────────────────
    case "llm:openai": {
      const key = str(stored.apiKey) || str(ws.openai_api_key) || process.env.OPENAI_API_KEY || "";
      return new OpenAILLMAdapter(key).healthCheck!();
    }
    case "llm:gemini": {
      const key = str(stored.apiKey) || process.env.GEMINI_API_KEY || "";
      return new GeminiLLMAdapter(key).healthCheck!();
    }
    case "llm:claude": {
      const key = str(stored.apiKey) || process.env.ANTHROPIC_API_KEY || "";
      return new ClaudeLLMAdapter(key).healthCheck!();
    }

    // ── Voice ──────────────────────────────────────────────────────────────────
    case "voice:retell": {
      const key = str(stored.apiKey) || str(ws.retell_workspace_id) || process.env.RETELL_API_KEY || "";
      return new RetellVoiceAdapter(key).healthCheck!();
    }
    case "voice:openai": {
      const key = str(stored.apiKey) || str(ws.openai_api_key) || process.env.OPENAI_API_KEY || "";
      return new OpenAIVoiceAdapter(key).healthCheck!();
    }
    case "voice:elevenlabs": {
      const key = str(stored.apiKey) || str(ws.elevenlabs_api_key) || process.env.ELEVENLABS_API_KEY || "";
      return new ElevenLabsVoiceAdapter(key).healthCheck!();
    }

    // ── Email ──────────────────────────────────────────────────────────────────
    case "email:resend": {
      const key = str(stored.apiKey) || str(ws.resend_api_key) || process.env.RESEND_API_KEY || "";
      return new ResendEmailAdapter(key).healthCheck!();
    }
    case "email:sendgrid": {
      const key = str(stored.apiKey) || process.env.SENDGRID_API_KEY || "";
      if (!key) return false;
      try {
        const resp = await fetch("https://api.sendgrid.com/v3/scopes", {
          headers: { Authorization: `Bearer ${key}` },
        });
        return resp.ok;
      } catch { return false; }
    }

    // ── Image ──────────────────────────────────────────────────────────────────
    case "image:gpt_image": {
      const key = str(stored.apiKey) || str(ws.openai_api_key) || process.env.OPENAI_API_KEY || "";
      return new GPTImageAdapter(key).healthCheck!();
    }
    case "image:imagen": {
      const key = str(stored.apiKey) || str(ws.openai_api_key) || "";
      return new ImagenAdapter({ gcpProject: str(stored.gcpProject), accessToken: str(stored.accessToken) || key }).healthCheck!();
    }

    // ── Video ──────────────────────────────────────────────────────────────────
    case "video:runway": {
      const key = str(stored.apiKey) || process.env.RUNWAY_API_KEY || "";
      return new RunwayAdapter(key).healthCheck!();
    }
    case "video:google_veo": {
      return new GoogleVeoAdapter({ gcpProject: str(stored.gcpProject), accessToken: str(stored.accessToken) }).healthCheck!();
    }

    // ── Knowledge ──────────────────────────────────────────────────────────────
    case "knowledge:pinecone": {
      return new PineconeAdapter({
        apiKey: str(stored.apiKey),
        indexName: str(stored.indexName),
        indexHost: str(stored.indexHost) || undefined,
      }).healthCheck!();
    }
    case "knowledge:retell_kb": {
      return new RetellKBAdapter().healthCheck!();
    }
    case "knowledge:weebee_kb": {
      return true;
    }

    // ── Calendar ───────────────────────────────────────────────────────────────
    case "calendar:calcom": {
      const key = str(stored.apiKey) || str(ws.calcom_api_key);
      if (!key) return false;
      return new CalComAdapter(key).healthCheck!();
    }
    case "calendar:google": {
      return new GoogleCalendarAdapter({
        accessToken: str(stored.accessToken),
        calendarId: str(stored.calendarId) || undefined,
      }).healthCheck!();
    }

    // ── Analytics ──────────────────────────────────────────────────────────────
    case "analytics:google_analytics": {
      return new GoogleAnalyticsAdapter({
        propertyId: str(stored.propertyId),
        accessToken: str(stored.accessToken),
      }).healthCheck!();
    }

    // ── Advertising ────────────────────────────────────────────────────────────
    case "advertising:google_ads": {
      return new GoogleAdsAdapter({
        developerToken: str(stored.developerToken),
        accessToken: str(stored.accessToken),
        customerId: str(stored.customerId),
      }).healthCheck!();
    }
    case "advertising:meta_ads": {
      return new MetaAdsAdapter({
        accessToken: str(stored.accessToken),
        adAccountId: str(stored.adAccountId),
      }).healthCheck!();
    }

    // ── CRM ────────────────────────────────────────────────────────────────────
    case "crm:hubspot": {
      const key = str(stored.apiKey) || str(ws.hubspot_api_key);
      if (!key) return false;
      try {
        const resp = await fetch("https://api.hubapi.com/crm/v3/objects/contacts?limit=1", {
          headers: { Authorization: `Bearer ${key}` },
        });
        return resp.ok;
      } catch { return false; }
    }
    case "crm:gohighlevel": {
      const key = str(stored.apiKey) || str(ws.ghl_api_key);
      if (!key) return false;
      try {
        const resp = await fetch("https://services.leadconnectorhq.com/locations/", {
          headers: { Authorization: `Bearer ${key}`, Version: "2021-07-28" },
        });
        return resp.ok;
      } catch { return false; }
    }

    // ── Telephony ──────────────────────────────────────────────────────────────
    case "telephony:twilio": {
      const sid = str(stored.accountSid) || str(ws.twilio_account_sid);
      const token = str(stored.authToken) || str(ws.twilio_auth_token);
      if (!sid || !token) return false;
      try {
        const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, {
          headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}` },
        });
        return resp.ok;
      } catch { return false; }
    }

    // ── WhatsApp ───────────────────────────────────────────────────────────────
    case "whatsapp:wati": {
      // WATI connection state is in wati_connections table — just check DB
      const sb = supabaseAdmin as any;
      const { data } = await sb
        .from("wati_connections")
        .select("status")
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      return data?.status === "active";
    }
    case "whatsapp:meta": {
      const token = str(stored.accessToken);
      if (!token) return false;
      try {
        const resp = await fetch(`https://graph.facebook.com/v19.0/me?access_token=${token}`);
        return resp.ok;
      } catch { return false; }
    }

    default:
      return false;
  }
}
