/**
 * Provider Display Name Mapping
 *
 * Maps internal provider identifiers to WEBEE customer-facing brand names.
 * Internal/admin views use the raw name; customer-facing views use displayName.
 *
 * NEVER expose Retell branding to normal workspace users.
 */

export interface ProviderDisplay {
  displayName:  string;
  adminName:    string;
  category:     string;
  icon?:        string;
}

const PROVIDER_MAP: Record<string, ProviderDisplay> = {
  // Voice
  retell: {
    displayName: "WEBEE Voice",
    adminName:   "Retell",
    category:    "voice",
    icon:        "mic",
  },
  omnivox: {
    displayName: "WEBEE Voice",
    adminName:   "OmniVoice",
    category:    "voice",
    icon:        "mic",
  },
  elevenlabs: {
    displayName: "VoxStream",
    adminName:   "ElevenLabs",
    category:    "voice",
    icon:        "mic",
  },
  openai_realtime: {
    displayName: "HyperStream",
    adminName:   "OpenAI Realtime",
    category:    "voice",
    icon:        "zap",
  },
  // Telephony
  twilio: {
    displayName: "WEBEE Telephony",
    adminName:   "Twilio",
    category:    "telephony",
    icon:        "phone",
  },
  frejun: {
    displayName: "WEBEE Regional Telephony",
    adminName:   "FreJun",
    category:    "telephony",
    icon:        "phone",
  },
  // LLM
  openai: {
    displayName: "WEBEE AI (OpenAI)",
    adminName:   "OpenAI",
    category:    "llm",
    icon:        "cpu",
  },
  gemini: {
    displayName: "WEBEE AI (Gemini)",
    adminName:   "Google Gemini",
    category:    "llm",
    icon:        "cpu",
  },
  claude: {
    displayName: "WEBEE AI (Claude)",
    adminName:   "Anthropic Claude",
    category:    "llm",
    icon:        "cpu",
  },
  // WhatsApp
  twilio_wa: {
    displayName: "WEBEE WhatsApp",
    adminName:   "Twilio WhatsApp",
    category:    "whatsapp",
    icon:        "message-circle",
  },
  meta: {
    displayName: "WhatsApp Business",
    adminName:   "Meta WhatsApp",
    category:    "whatsapp",
    icon:        "message-circle",
  },
  wati: {
    displayName: "WhatsApp (WATI)",
    adminName:   "WATI",
    category:    "whatsapp",
    icon:        "message-circle",
  },
  // Email
  resend: {
    displayName: "WEBEE Mail (Resend)",
    adminName:   "Resend",
    category:    "email",
    icon:        "mail",
  },
  sendgrid: {
    displayName: "WEBEE Mail (SendGrid)",
    adminName:   "SendGrid",
    category:    "email",
    icon:        "mail",
  },
  // Video / Image
  google_veo: {
    displayName: "WEBEE Video AI",
    adminName:   "Google Veo",
    category:    "video",
    icon:        "video",
  },
  runway: {
    displayName: "Runway AI",
    adminName:   "Runway",
    category:    "video",
    icon:        "video",
  },
  gpt_image: {
    displayName: "WEBEE Image AI",
    adminName:   "GPT-Image (OpenAI)",
    category:    "image",
    icon:        "image",
  },
};

/**
 * Returns the customer-facing display name for a provider.
 * Falls back to title-casing the raw key if not in map.
 */
export function getProviderDisplayName(providerId: string): string {
  const key = (providerId ?? "").toLowerCase().replace(/[-\s]/g, "_");
  return PROVIDER_MAP[key]?.displayName ?? toTitleCase(providerId);
}

/**
 * Returns the admin-only provider name (the real brand name).
 */
export function getProviderAdminName(providerId: string): string {
  const key = (providerId ?? "").toLowerCase().replace(/[-\s]/g, "_");
  return PROVIDER_MAP[key]?.adminName ?? toTitleCase(providerId);
}

/**
 * Returns display name appropriate for the viewer role.
 * isAdmin=true → real brand name; isAdmin=false → WEBEE brand name.
 */
export function getProviderLabel(providerId: string, isAdmin = false): string {
  return isAdmin ? getProviderAdminName(providerId) : getProviderDisplayName(providerId);
}

/**
 * All provider display entries for use in dropdowns / selects.
 */
export function getProviderDisplayList(isAdmin = false): Array<{ id: string; label: string; category: string }> {
  return Object.entries(PROVIDER_MAP).map(([id, entry]) => ({
    id,
    label:    isAdmin ? entry.adminName    : entry.displayName,
    category: entry.category,
  }));
}

function toTitleCase(s: string) {
  return (s ?? "")
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase());
}
