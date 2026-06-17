import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface ProviderCreditEntry {
  provider_name: string;
  provider_category: string;
  display_name: string;
  status: "connected" | "disconnected" | "error" | "coming_soon";
  billing_url: string;
  credits_warning: boolean;
  last_sync: string | null;
}

const BILLING_URLS: Record<string, string> = {
  google_veo: "https://aistudio.google.com",
  openai: "https://platform.openai.com/usage",
  elevenlabs: "https://elevenlabs.io/subscription",
  runway: "https://app.runwayml.com/billing",
  retell: "https://dashboard.retell.ai",
  meta_ads: "https://business.facebook.com/adsmanager",
  tiktok_ads: "https://ads.tiktok.com",
  linkedin_ads: "https://www.linkedin.com/campaignmanager",
  resend: "https://resend.com/overview",
  wati: "https://live.wati.io",
  google_gemini: "https://aistudio.google.com",
  anthropic: "https://console.anthropic.com/settings/billing",
  twilio: "https://console.twilio.com/billing",
  google_search: "https://console.cloud.google.com/billing",
};

const DISPLAY_NAMES: Record<string, string> = {
  google_veo: "Google Veo",
  openai: "OpenAI",
  elevenlabs: "ElevenLabs",
  runway: "Runway",
  retell: "Retell (Phone)",
  meta_ads: "Meta Ads",
  tiktok_ads: "TikTok Ads",
  linkedin_ads: "LinkedIn Ads",
  resend: "Resend (Email)",
  wati: "WATI (WhatsApp)",
  google_gemini: "Google Gemini",
  anthropic: "Anthropic",
  twilio: "Twilio",
  google_search: "Google Search",
};

export const getProviderCreditStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ProviderCreditEntry[]> => {
    const { workspaceId } = context;
    const sb = supabaseAdmin as any;

    const { data: providers } = await sb
      .from("provider_settings")
      .select("provider_name, provider_category, status, last_sync")
      .eq("workspace_id", workspaceId)
      .neq("status", "coming_soon");

    if (!providers || providers.length === 0) return [];

    const providerNames: string[] = providers.map((p: any) => p.provider_name);

    const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data: recentFailed } = await sb
      .from("growthmind_video_assets")
      .select("error_message")
      .eq("workspace_id", workspaceId)
      .eq("status", "failed")
      .gte("updated_at", thirtyMinsAgo)
      .not("error_message", "is", null);

    const creditExhaustedProviders = new Set<string>();
    if (recentFailed) {
      for (const row of recentFailed) {
        const msg: string = (row.error_message || "").toLowerCase();
        if (
          msg.includes("429") ||
          msg.includes("resource_exhausted") ||
          msg.includes("credits are depleted") ||
          msg.includes("quota")
        ) {
          creditExhaustedProviders.add("google_veo");
        }
        if (msg.includes("insufficient_quota") || msg.includes("billing_hard_limit")) {
          creditExhaustedProviders.add("openai");
        }
      }
    }

    return (providers as any[]).map((p) => ({
      provider_name: p.provider_name,
      provider_category: p.provider_category,
      display_name: DISPLAY_NAMES[p.provider_name] ?? p.provider_name.replace(/_/g, " "),
      status: p.status,
      billing_url: BILLING_URLS[p.provider_name] ?? "#",
      credits_warning: creditExhaustedProviders.has(p.provider_name),
      last_sync: p.last_sync ?? null,
    }));
  });
