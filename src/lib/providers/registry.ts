import type { ProviderCategory, ProviderStatus } from "./types";

export interface RegistryEntry {
  name: string;
  category: ProviderCategory;
  label: string;
  description: string;
  status: ProviderStatus;
  isDefault?: boolean;
  isFallback?: boolean;
  priority?: number;
}

type CategoryRegistry = Map<string, RegistryEntry>;
const REGISTRY = new Map<ProviderCategory, CategoryRegistry>();

export function registerProvider(entry: RegistryEntry): void {
  if (!REGISTRY.has(entry.category)) {
    REGISTRY.set(entry.category, new Map());
  }
  REGISTRY.get(entry.category)!.set(entry.name, { ...entry });
}

export function getProvider(category: ProviderCategory, name: string): RegistryEntry | undefined {
  const e = REGISTRY.get(category)?.get(name);
  return e ? { ...e } : undefined;
}

export function listProviders(category: ProviderCategory): RegistryEntry[] {
  return Array.from(REGISTRY.get(category)?.values() ?? []).map(e => ({ ...e }));
}

export function listAllProviders(): Record<ProviderCategory, RegistryEntry[]> {
  const result = {} as Record<ProviderCategory, RegistryEntry[]>;
  for (const [cat, entries] of REGISTRY.entries()) {
    result[cat] = Array.from(entries.values())
      .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
      .map(e => ({ ...e }));
  }
  return result;
}

export function getDefaultProvider(category: ProviderCategory): RegistryEntry | undefined {
  return listProviders(category).find(p => p.isDefault);
}

export function getFallbackProvider(category: ProviderCategory): RegistryEntry | undefined {
  return listProviders(category).find(p => p.isFallback);
}

/**
 * Build a per-request scoped view of all providers by overlaying DB row overrides
 * and derived-connected status on top of cloned registry entries.
 * NEVER mutates the global REGISTRY — returns a fresh object every call.
 */
export function buildScopedView(
  dbRows: Array<{ provider_name: string; provider_category: string; status: string; is_default: boolean; is_fallback: boolean; priority: number }>,
  derivedConnected: Record<string, boolean>,
): Record<ProviderCategory, RegistryEntry[]> {
  const result = {} as Record<ProviderCategory, RegistryEntry[]>;

  for (const [cat, catMap] of REGISTRY.entries()) {
    result[cat] = Array.from(catMap.values())
      .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
      .map(e => {
        const entry: RegistryEntry = { ...e };

        const dbRow = dbRows.find(
          r => r.provider_category === cat && r.provider_name === e.name,
        );

        // Track whether the admin has explicitly set a status override in the DB.
        // An explicit DB status always wins — derivedConnected must never silently
        // re-enable a provider that an admin deliberately disabled.
        let hasExplicitDbStatus = false;
        if (dbRow) {
          entry.status     = dbRow.status as ProviderStatus;
          entry.isDefault  = dbRow.is_default;
          entry.isFallback = dbRow.is_fallback;
          entry.priority   = dbRow.priority;
          // Only treat the DB status as "explicit" when it is a deliberate
          // disconnected/error override (not just the initial default write).
          hasExplicitDbStatus =
            dbRow.status === "disconnected" || dbRow.status === "error";
        }

        // Apply credential-derived status only when no explicit DB override exists.
        if (!hasExplicitDbStatus) {
          const key = `${cat}:${e.name}`;
          if (derivedConnected[key] === true && entry.status !== "coming_soon") {
            entry.status = "connected";
          } else if (derivedConnected[key] === false && entry.status === "connected") {
            entry.status = "disconnected";
          }
        }

        return entry;
      });
  }

  return result;
}

// ── Static registry seed (all known providers) ────────────────────────────────

const STATIC_PROVIDERS: RegistryEntry[] = [
  // LLM
  { category: "llm", name: "openai",     label: "OpenAI",       description: "GPT-4o, GPT-4.1 language models",          status: "connected",    isDefault: true,  priority: 1 },
  { category: "llm", name: "gemini",     label: "Gemini",       description: "Google Gemini 2.5 Pro & Flash",            status: "connected",    isFallback: true, priority: 2 },
  { category: "llm", name: "claude",     label: "Claude",       description: "Anthropic Claude Sonnet — sales copy",     status: "connected",    priority: 3 },
  { category: "llm", name: "openrouter", label: "OpenRouter",   description: "Multi-model LLM gateway",                  status: "coming_soon",  priority: 4 },
  { category: "llm", name: "grok",       label: "Grok",         description: "xAI Grok models",                          status: "coming_soon",  priority: 5 },
  { category: "llm", name: "mistral",    label: "Mistral",      description: "Mistral AI models",                        status: "coming_soon",  priority: 6 },
  { category: "llm", name: "llama",      label: "Llama",        description: "Meta Llama (self-hosted)",                 status: "coming_soon",  priority: 7 },

  // Voice
  { category: "voice", name: "retell",      label: "OmniVoice",                description: "Managed voice layer",                    status: "connected", isDefault: true, priority: 1 },
  { category: "voice", name: "openai",      label: "HyperStream (OpenAI)",     description: "OpenAI Realtime — GPT-4o voice",          status: "connected", priority: 2 },
  { category: "voice", name: "elevenlabs",  label: "VoxStream (ElevenLabs)",   description: "ElevenLabs ConvAI — ultra-realistic TTS", status: "connected", priority: 3 },
  { category: "voice", name: "claude",      label: "Claude Native",            description: "Anthropic Claude Realtime (coming soon)",  status: "coming_soon", priority: 4 },
  { category: "voice", name: "gemini",      label: "Gemini Native",            description: "Google Gemini Realtime (coming soon)",    status: "coming_soon", priority: 5 },

  // Telephony
  { category: "telephony", name: "twilio",  label: "Twilio",   description: "Programmable voice & SMS — global PSTN",    status: "disconnected", isDefault: true, priority: 1 },
  { category: "telephony", name: "frejun",  label: "FreJun",   description: "FreJun Teler — India & APAC telephony",     status: "disconnected", priority: 2 },
  { category: "telephony", name: "telnyx",  label: "Telnyx",   description: "Telnyx cloud communications",               status: "coming_soon",  priority: 3 },
  { category: "telephony", name: "plivo",   label: "Plivo",    description: "Plivo CPaaS voice & SMS",                   status: "coming_soon",  priority: 4 },
  { category: "telephony", name: "vonage",  label: "Vonage",   description: "Vonage (Ericsson) CPaaS",                   status: "coming_soon",  priority: 5 },

  // WhatsApp
  { category: "whatsapp", name: "wati",    label: "WATI",              description: "WATI WhatsApp Business API",                status: "disconnected", isDefault: true, priority: 1 },
  { category: "whatsapp", name: "twilio",  label: "Twilio WhatsApp",  description: "Twilio WhatsApp sandbox & production",      status: "disconnected", priority: 2 },
  { category: "whatsapp", name: "meta",    label: "Meta Cloud API",   description: "Official Meta WhatsApp Business Cloud API", status: "disconnected", priority: 3 },

  // Email
  { category: "email", name: "resend",    label: "Resend",     description: "Transactional email via Resend",       status: "connected",   isDefault: true, priority: 1 },
  { category: "email", name: "sendgrid",  label: "SendGrid",   description: "Twilio SendGrid email platform",       status: "coming_soon", priority: 2 },
  { category: "email", name: "mailgun",   label: "Mailgun",    description: "Mailgun transactional email",          status: "coming_soon", priority: 3 },
  { category: "email", name: "ses",       label: "AWS SES",    description: "Amazon Simple Email Service",          status: "coming_soon", priority: 4 },

  // CRM
  { category: "crm", name: "hubspot",     label: "HubSpot",            description: "HubSpot CRM — contacts & deals",            status: "disconnected", isDefault: true, priority: 1 },
  { category: "crm", name: "gohighlevel", label: "GoHighLevel",        description: "GoHighLevel CRM & automation",              status: "disconnected", priority: 2 },
  { category: "crm", name: "salesforce",  label: "Salesforce",         description: "Salesforce CRM",                            status: "coming_soon",  priority: 3 },
  { category: "crm", name: "pipedrive",   label: "Pipedrive",          description: "Pipedrive sales CRM",                       status: "coming_soon",  priority: 4 },
  { category: "crm", name: "dynamics",    label: "Microsoft Dynamics", description: "Microsoft Dynamics 365 CRM",                status: "coming_soon",  priority: 5 },

  // Calendar
  { category: "calendar", name: "calcom",  label: "Cal.com",         description: "Cal.com open-source scheduling",    status: "disconnected", isDefault: true, priority: 1 },
  { category: "calendar", name: "google",  label: "Google Calendar", description: "Google Calendar & Meet",            status: "coming_soon",  priority: 2 },
  { category: "calendar", name: "outlook", label: "Outlook Calendar", description: "Microsoft Outlook / Exchange",    status: "coming_soon",  priority: 3 },

  // Knowledge
  { category: "knowledge", name: "retell_kb", label: "OmniVoice KB",       description: "OmniVoice built-in knowledge base",      status: "connected",   isDefault: true, priority: 1 },
  { category: "knowledge", name: "weebee_kb", label: "WeeBee KB",          description: "WeeBee PDF-based knowledge base",        status: "connected",   priority: 2 },
  { category: "knowledge", name: "pinecone",  label: "Pinecone",           description: "Pinecone vector database",               status: "coming_soon", priority: 3 },
  { category: "knowledge", name: "openai_vs", label: "OpenAI Vector Store", description: "OpenAI Vector Store for RAG",          status: "coming_soon", priority: 4 },

  // Video
  { category: "video", name: "google_veo", label: "Google Veo 3", description: "Google Veo 3 — use a Gemini API Key (easiest) or GCP Project + OAuth token", status: "disconnected", isDefault: true, priority: 1 },
  { category: "video", name: "runway",     label: "Runway Gen-4", description: "Runway Gen-4 Turbo video generation",                    status: "disconnected", priority: 2 },
  { category: "video", name: "pika",       label: "Pika",         description: "Pika video generation",                                  status: "coming_soon",  priority: 3 },
  { category: "video", name: "sora",       label: "Sora",         description: "OpenAI Sora video generation",                           status: "coming_soon",  priority: 4 },

  // Image
  { category: "image", name: "gpt_image",  label: "GPT Image",   description: "OpenAI GPT-Image-1 generation",    status: "connected",   isDefault: true, priority: 1 },
  { category: "image", name: "imagen",     label: "Imagen",      description: "Google Imagen AI image generation", status: "coming_soon", priority: 2 },
  { category: "image", name: "stable_diff", label: "Stable Diffusion", description: "Stability AI image generation", status: "coming_soon", priority: 3 },
  { category: "image", name: "midjourney", label: "Midjourney",  description: "Midjourney image generation",       status: "coming_soon", priority: 4 },

  // Analytics
  { category: "analytics", name: "google_analytics", label: "Google Analytics", description: "Google Analytics 4 — web traffic & conversions", status: "coming_soon", isDefault: true, priority: 1 },
  { category: "analytics", name: "posthog",           label: "PostHog",          description: "Product analytics & feature flags",              status: "coming_soon", priority: 2 },
  { category: "analytics", name: "mixpanel",          label: "Mixpanel",         description: "Event-driven product analytics",                 status: "coming_soon", priority: 3 },

  // Advertising
  { category: "advertising", name: "google_ads",  label: "Google Ads",  description: "Google Ads campaign management",   status: "disconnected", isDefault: true, priority: 1 },
  { category: "advertising", name: "meta_ads",    label: "Meta Ads",    description: "Meta Ads (Facebook & Instagram)",   status: "disconnected", priority: 2 },
  { category: "advertising", name: "tiktok_ads",  label: "TikTok Ads",  description: "TikTok Ads platform",              status: "coming_soon", priority: 3 },
  { category: "advertising", name: "linkedin_ads", label: "LinkedIn Ads", description: "LinkedIn Campaign Manager",      status: "coming_soon", priority: 4 },
];

for (const p of STATIC_PROVIDERS) {
  registerProvider(p);
}
