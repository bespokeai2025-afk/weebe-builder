import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// ── Types ──────────────────────────────────────────────────────────────────────
export interface WebhookEntry {
  id: string;
  label: string;
  provider: string;
  route: string;
  fullUrl: string;
  method: string;
  healthRoute: string | null;
  requiredEnvVars: string[];
  canAutoUpdate: boolean;
  autoUpdateNote: string;
  manualNote: string | null;
  perWorkspace: boolean;
}

export interface EnvStatus {
  key: string;
  present: boolean;
  required: boolean;
}

export interface ProductionReadinessData {
  productionUrl: string;
  isProduction: boolean;
  envStatus: EnvStatus[];
  webhooks: WebhookEntry[];
}

export interface WebhookUpdateResult {
  provider: string;
  workspaceId: string | null;
  status: "success" | "failed" | "skipped";
  oldUrl: string | null;
  newUrl: string;
  error?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function getBase(): string {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, "");
  if (process.env.REPLIT_DEV_DOMAIN) return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  return "http://localhost:5000";
}

async function logUpdate(
  entry: Omit<WebhookUpdateResult, "status"> & { status: "success" | "failed" | "skipped" },
) {
  await supabaseAdmin.from("production_webhook_updates").insert({
    workspace_id: entry.workspaceId ?? null,
    provider: entry.provider,
    old_url: entry.oldUrl,
    new_url: entry.newUrl,
    status: entry.status,
    error: entry.error ?? null,
    triggered_by: "production-readiness-ui",
  });
}

// ── Server Functions ───────────────────────────────────────────────────────────

export const getProductionReadinessData = createServerFn().handler(
  async (): Promise<ProductionReadinessData> => {
    const base = getBase();
    const isProduction = base.includes("webeebuilder.com");

    const env: EnvStatus[] = [
      { key: "PUBLIC_BASE_URL",       present: !!process.env.PUBLIC_BASE_URL,       required: true  },
      { key: "RETELL_API_KEY",         present: !!process.env.RETELL_API_KEY,         required: true  },
      { key: "RETELL_WEBHOOK_SECRET",  present: !!process.env.RETELL_WEBHOOK_SECRET,  required: true  },
      { key: "TWILIO_ACCOUNT_SID",     present: !!process.env.TWILIO_ACCOUNT_SID,     required: false },
      { key: "TWILIO_AUTH_TOKEN",      present: !!process.env.TWILIO_AUTH_TOKEN,      required: false },
      { key: "ELEVENLABS_API_KEY",     present: !!process.env.ELEVENLABS_API_KEY,     required: false },
      { key: "STRIPE_SECRET_KEY",      present: !!process.env.STRIPE_SECRET_KEY,      required: false },
      { key: "STRIPE_WEBHOOK_SECRET",  present: !!process.env.STRIPE_WEBHOOK_SECRET,  required: false },
      { key: "OPENAI_API_KEY",         present: !!process.env.OPENAI_API_KEY,         required: false },
    ];

    const webhooks: WebhookEntry[] = [
      {
        id: "omnivvoice-main",
        label: "OmniVoice — Voice Webhook",
        provider: "OmniVoice",
        route: "/api/public/voice-webhook",
        fullUrl: `${base}/api/public/voice-webhook`,
        method: "POST",
        healthRoute: "/api/public/voice-webhook/health",
        requiredEnvVars: ["RETELL_API_KEY", "RETELL_WEBHOOK_SECRET"],
        canAutoUpdate: true,
        autoUpdateNote: "Updates webhook_url on all deployed OmniVoice agents via the OmniVoice API",
        manualNote: null,
        perWorkspace: false,
      },
      {
        id: "omnivvoice-legacy",
        label: "OmniVoice — Legacy Webhook",
        provider: "OmniVoice",
        route: "/api/public/retell-webhook",
        fullUrl: `${base}/api/public/retell-webhook`,
        method: "POST",
        healthRoute: "/api/public/retell-webhook/health",
        requiredEnvVars: ["RETELL_WEBHOOK_SECRET"],
        canAutoUpdate: false,
        autoUpdateNote: "",
        manualNote: "Used by older agent builds. Most traffic flows through /voice-webhook.",
        perWorkspace: false,
      },
      {
        id: "twilio-inbound",
        label: "Twilio — Voice Inbound",
        provider: "Twilio",
        route: "/api/public/telephony/inbound",
        fullUrl: `${base}/api/public/telephony/inbound`,
        method: "POST",
        healthRoute: "/api/public/telephony/inbound/health",
        requiredEnvVars: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"],
        canAutoUpdate: true,
        autoUpdateNote: "Updates Voice URL on all active Twilio numbers via Twilio REST API",
        manualNote: null,
        perWorkspace: true,
      },
      {
        id: "twilio-status",
        label: "Twilio — Status Callback",
        provider: "Twilio",
        route: "/api/public/telephony/status",
        fullUrl: `${base}/api/public/telephony/status`,
        method: "POST",
        healthRoute: "/api/public/telephony/status/health",
        requiredEnvVars: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"],
        canAutoUpdate: true,
        autoUpdateNote: "Updated together with Voice URL on Twilio numbers",
        manualNote: null,
        perWorkspace: true,
      },
      {
        id: "whatsapp",
        label: "WhatsApp — Unified Webhook",
        provider: "WhatsApp (Twilio/WATI/Meta)",
        route: "/api/public/whatsapp-webhook/:workspaceId",
        fullUrl: `${base}/api/public/whatsapp-webhook/{workspaceId}`,
        method: "POST",
        healthRoute: "/api/public/whatsapp-webhook/health",
        requiredEnvVars: [],
        canAutoUpdate: true,
        autoUpdateNote: "Updates WATI inbound webhook URL via WATI API for each connected workspace",
        manualNote: "Twilio WA: configure in Twilio Console → Messaging → Senders. Meta WA: see manual checklist below.",
        perWorkspace: true,
      },
      {
        id: "frejun-status",
        label: "FreJun — Status Callback",
        provider: "FreJun",
        route: "/api/public/frejun/status",
        fullUrl: `${base}/api/public/frejun/status`,
        method: "POST",
        healthRoute: "/api/public/frejun/health",
        requiredEnvVars: [],
        canAutoUpdate: false,
        autoUpdateNote: "",
        manualNote: "Set in FreJun account settings → Webhooks. Paste URL manually.",
        perWorkspace: false,
      },
      {
        id: "frejun-flow",
        label: "FreJun — Flow Events",
        provider: "FreJun",
        route: "/api/public/frejun/flow",
        fullUrl: `${base}/api/public/frejun/flow`,
        method: "POST",
        healthRoute: "/api/public/frejun/health",
        requiredEnvVars: [],
        canAutoUpdate: false,
        autoUpdateNote: "",
        manualNote: "Set in FreJun account settings → Webhooks. Paste URL manually.",
        perWorkspace: false,
      },
      {
        id: "calcom",
        label: "Cal.com — Booking Events",
        provider: "Cal.com",
        route: "/api/public/calcom-webhook/:workspaceId",
        fullUrl: `${base}/api/public/calcom-webhook/{workspaceId}`,
        method: "POST",
        healthRoute: "/api/public/calcom-webhook/health",
        requiredEnvVars: [],
        canAutoUpdate: true,
        autoUpdateNote: "Re-registers booking webhook for all workspaces with a Cal.com API key",
        manualNote: null,
        perWorkspace: true,
      },
      {
        id: "elevenlabs",
        label: "ElevenLabs — Post-Call Transcript",
        provider: "ElevenLabs",
        route: "/api/public/elevenlabs-webhook",
        fullUrl: `${base}/api/public/elevenlabs-webhook`,
        method: "POST",
        healthRoute: "/api/public/elevenlabs-webhook/health",
        requiredEnvVars: ["ELEVENLABS_API_KEY"],
        canAutoUpdate: false,
        autoUpdateNote: "",
        manualNote: "Set in ElevenLabs dashboard → Conversational AI → Webhooks. Include ?secret=YOUR_SECRET in the URL.",
        perWorkspace: false,
      },
      {
        id: "stripe",
        label: "Stripe — Payment Events",
        provider: "Stripe",
        route: "/api/public/payments/webhook",
        fullUrl: `${base}/api/public/payments/webhook`,
        method: "POST",
        healthRoute: "/api/public/payments/webhook/health",
        requiredEnvVars: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
        canAutoUpdate: false,
        autoUpdateNote: "",
        manualNote: "Update in Stripe Dashboard → Developers → Webhooks. DO NOT auto-update live Stripe webhooks.",
        perWorkspace: false,
      },
    ];

    return { productionUrl: base, isProduction, envStatus: env, webhooks };
  },
);

// ── Run Auto-Updates ───────────────────────────────────────────────────────────
export const runWebhookAutoUpdate = createServerFn()
  .inputValidator(z.object({ providers: z.array(z.string()) }))
  .handler(async ({ data }): Promise<WebhookUpdateResult[]> => {
    const base = getBase();
    const results: WebhookUpdateResult[] = [];

    for (const provider of data.providers) {
      // ── OmniVoice agents ────────────────────────────────────────────────────
      if (provider === "omnivvoice-main") {
        const newUrl = `${base}/api/public/voice-webhook`;
        try {
          const { retellFetch } = await import("@/lib/providers/retell/client.server");
          const { data: agents } = await supabaseAdmin
            .from("agents")
            .select("id, retell_agent_id, workspace_id, settings")
            .not("retell_agent_id", "is", null);

          const deployed = (agents ?? []).filter(
            (a: any) => a.retell_agent_id && (a.settings as any)?.status === "deployed",
          );

          for (const agent of deployed) {
            const agentId: string = agent.retell_agent_id as string;
            const existingWebhook: string | null = (agent.settings as any)?.webhook_url ?? null;
            if (existingWebhook === newUrl) {
              results.push({ provider: "omnivvoice-main", workspaceId: agent.workspace_id, status: "skipped", oldUrl: existingWebhook, newUrl });
              continue;
            }
            try {
              await retellFetch(`/update-agent/${encodeURIComponent(agentId)}`, { webhook_url: newUrl }, "PATCH");
              await logUpdate({ provider: "omnivvoice-main", workspaceId: agent.workspace_id, oldUrl: existingWebhook, newUrl, status: "success" });
              results.push({ provider: "omnivvoice-main", workspaceId: agent.workspace_id, status: "success", oldUrl: existingWebhook, newUrl });
            } catch (err: any) {
              await logUpdate({ provider: "omnivvoice-main", workspaceId: agent.workspace_id, oldUrl: existingWebhook, newUrl, status: "failed", error: err.message });
              results.push({ provider: "omnivvoice-main", workspaceId: agent.workspace_id, status: "failed", oldUrl: existingWebhook, newUrl, error: err.message });
            }
          }
        } catch (err: any) {
          results.push({ provider: "omnivvoice-main", workspaceId: null, status: "failed", oldUrl: null, newUrl, error: err.message });
        }
      }

      // ── Twilio phone numbers ────────────────────────────────────────────────
      if (provider === "twilio-inbound") {
        const inboundUrl = `${base}/api/public/telephony/inbound`;
        const statusUrl  = `${base}/api/public/telephony/status`;
        const sid   = process.env.TWILIO_ACCOUNT_SID;
        const token = process.env.TWILIO_AUTH_TOKEN;
        if (!sid || !token) {
          results.push({ provider: "twilio-inbound", workspaceId: null, status: "failed", oldUrl: null, newUrl: inboundUrl, error: "TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN not configured" });
        } else {
          try {
            const twilio = (await import("twilio")).default;
            const client = twilio(sid, token);
            const numbers = await client.incomingPhoneNumbers.list();
            for (const num of numbers) {
              const old = num.voiceUrl ?? null;
              try {
                await client.incomingPhoneNumbers(num.sid).update({
                  voiceUrl: inboundUrl, voiceMethod: "POST",
                  statusCallback: statusUrl, statusCallbackMethod: "POST",
                } as any);
                await logUpdate({ provider: "twilio-inbound", workspaceId: null, oldUrl: old, newUrl: inboundUrl, status: "success" });
                results.push({ provider: "twilio-inbound", workspaceId: null, status: "success", oldUrl: old, newUrl: inboundUrl });
              } catch (err: any) {
                await logUpdate({ provider: "twilio-inbound", workspaceId: null, oldUrl: old, newUrl: inboundUrl, status: "failed", error: err.message });
                results.push({ provider: "twilio-inbound", workspaceId: null, status: "failed", oldUrl: old, newUrl: inboundUrl, error: err.message });
              }
            }
          } catch (err: any) {
            results.push({ provider: "twilio-inbound", workspaceId: null, status: "failed", oldUrl: null, newUrl: inboundUrl, error: err.message });
          }
        }
      }

      // ── WATI workspaces ─────────────────────────────────────────────────────
      if (provider === "whatsapp") {
        const { data: watiConns } = await supabaseAdmin
          .from("wati_connections")
          .select("workspace_id, tenant_id")
          .eq("is_active", true);

        for (const conn of (watiConns ?? [])) {
          const newUrl = `${base}/api/public/whatsapp-webhook/${conn.workspace_id}`;
          try {
            const { updateWatiWebhook } = await import("@/lib/whatsapp/wati.functions");
            const res = await updateWatiWebhook(conn.workspace_id, conn.tenant_id, newUrl);
            const status = res.ok ? "success" : "failed";
            await logUpdate({ provider: "whatsapp-wati", workspaceId: conn.workspace_id, oldUrl: null, newUrl, status, error: res.ok ? undefined : res.message });
            results.push({ provider: "whatsapp-wati", workspaceId: conn.workspace_id, status, oldUrl: null, newUrl, error: res.ok ? undefined : res.message });
          } catch (err: any) {
            await logUpdate({ provider: "whatsapp-wati", workspaceId: conn.workspace_id, oldUrl: null, newUrl, status: "failed", error: err.message });
            results.push({ provider: "whatsapp-wati", workspaceId: conn.workspace_id, status: "failed", oldUrl: null, newUrl, error: err.message });
          }
        }
      }

      // ── Cal.com workspaces ──────────────────────────────────────────────────
      if (provider === "calcom") {
        const { data: ws } = await supabaseAdmin
          .from("workspace_settings")
          .select("workspace_id, calcom_api_key")
          .not("calcom_api_key", "is", null);

        for (const w of (ws ?? []).filter((x: any) => x.calcom_api_key)) {
          const subscriberUrl = `${base}/api/public/calcom-webhook/${w.workspace_id}`;
          try {
            const { registerCalcomWebhook } = await import("@/lib/providers/calcom/webhook-register.server");
            const r = await registerCalcomWebhook({ workspaceId: w.workspace_id, subscriberUrl });
            const status = r.ok ? "success" : "failed";
            await logUpdate({ provider: "calcom", workspaceId: w.workspace_id, oldUrl: null, newUrl: subscriberUrl, status, error: r.ok ? undefined : r.message });
            results.push({ provider: "calcom", workspaceId: w.workspace_id, status, oldUrl: null, newUrl: subscriberUrl, error: r.ok ? undefined : r.message });
          } catch (err: any) {
            await logUpdate({ provider: "calcom", workspaceId: w.workspace_id, oldUrl: null, newUrl: subscriberUrl, status: "failed", error: err.message });
            results.push({ provider: "calcom", workspaceId: w.workspace_id, status: "failed", oldUrl: null, newUrl: subscriberUrl, error: err.message });
          }
        }
      }
    }

    return results;
  });

// ── Recent update log ──────────────────────────────────────────────────────────
export const getWebhookUpdateLog = createServerFn().handler(async () => {
  const { data } = await supabaseAdmin
    .from("production_webhook_updates")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);
  return data ?? [];
});
