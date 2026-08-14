/**
 * Canonical Lead Origin — shared between web, mobile API, and server logic.
 *
 * ORIGIN means how the lead FIRST entered WEBEE.
 * It is NOT the same as:
 *   - campaign (which campaign contacted them)
 *   - status   (their current qualification state)
 *   - sentiment (how the conversation went)
 *
 * A WBAH voice-origin lead that later receives a WhatsApp message keeps
 * lead_origin = 'voice_call'; only has_buzzchat_reply changes.
 */

export const LEAD_ORIGINS = [
  "whatsapp",
  "voice_call",
  "web_form",
  "manual",
  "csv_import",
  "crm",
  "email",
  "sms",
  "campaign",
  "api",
  "unknown",
] as const;

export type LeadOrigin = (typeof LEAD_ORIGINS)[number];

// ── Per-origin display metadata ──────────────────────────────────────────────

export interface OriginMeta {
  /** Short human-readable label */
  label: string;
  /** Longer description for tooltips */
  description: string;
  /** Lucide icon name */
  icon: string;
  /** Tailwind colour classes — text + bg */
  tone: string;
}

export const ORIGIN_META: Record<LeadOrigin, OriginMeta> = {
  whatsapp: {
    label: "WhatsApp",
    description: "Lead came via WhatsApp",
    icon: "MessageCircle",
    tone: "text-emerald-400 bg-emerald-500/10",
  },
  voice_call: {
    label: "Voice",
    description: "Lead came via a voice call",
    icon: "Phone",
    tone: "text-blue-400 bg-blue-500/10",
  },
  web_form: {
    label: "Web",
    description: "Lead submitted a web form",
    icon: "Globe",
    tone: "text-sky-400 bg-sky-500/10",
  },
  manual: {
    label: "Manual",
    description: "Lead was manually added",
    icon: "UserCog",
    tone: "text-slate-400 bg-slate-500/10",
  },
  csv_import: {
    label: "Import",
    description: "Lead was imported from a CSV or data upload",
    icon: "Upload",
    tone: "text-amber-400 bg-amber-500/10",
  },
  crm: {
    label: "CRM",
    description: "Lead came from a CRM integration",
    icon: "Building2",
    tone: "text-violet-400 bg-violet-500/10",
  },
  email: {
    label: "Email",
    description: "Lead came via email",
    icon: "Mail",
    tone: "text-orange-400 bg-orange-500/10",
  },
  sms: {
    label: "SMS",
    description: "Lead came via SMS",
    icon: "MessageSquareText",
    tone: "text-fuchsia-400 bg-fuchsia-500/10",
  },
  campaign: {
    label: "Campaign",
    description: "Lead was created by a campaign",
    icon: "Megaphone",
    tone: "text-pink-400 bg-pink-500/10",
  },
  api: {
    label: "API",
    description: "Lead was ingested via the API",
    icon: "Plug",
    tone: "text-emerald-400 bg-emerald-500/10",
  },
  unknown: {
    label: "Unknown",
    description: "Lead origin could not be determined",
    icon: "HelpCircle",
    tone: "text-muted-foreground bg-muted/40",
  },
};

// ── Filter options for UI dropdowns ─────────────────────────────────────────

export const ORIGIN_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "",           label: "All Sources"  },
  { value: "whatsapp",   label: "WhatsApp"     },
  { value: "voice_call", label: "Voice Calls"  },
  { value: "web_form",   label: "Web Forms"    },
  { value: "crm",        label: "CRM"          },
  { value: "csv_import", label: "CSV / Import" },
  { value: "email",      label: "Email"        },
  { value: "api",        label: "API"          },
  { value: "manual",     label: "Manual"       },
  { value: "unknown",    label: "Unknown"      },
];

// ── Derivation from existing source field (fallback when column is NULL) ─────

/** Evidence hierarchy — same logic as the migration SQL backfill. */
export function deriveLeadOrigin(lead: {
  lead_origin?: string | null;
  origin_provider?: string | null;
  source?: string | null;
  source_type?: string | null;
  buzzchat_conversation_id?: string | null;
  has_buzzchat_reply?: boolean | null;
  meta?: Record<string, unknown> | null;
}): LeadOrigin {
  // 1. Prefer DB column when already set
  if (lead.lead_origin && LEAD_ORIGINS.includes(lead.lead_origin as LeadOrigin)) {
    return lead.lead_origin as LeadOrigin;
  }

  const src = String(lead.source ?? lead.source_type ?? "").toLowerCase().trim();
  const wbahSrc = String((lead.meta as any)?.wbah_source ?? "").toLowerCase().trim();

  // 2. BuzzChat conversation linkage → WhatsApp
  if (lead.buzzchat_conversation_id || lead.has_buzzchat_reply) return "whatsapp";
  if (src === "whatsapp") return "whatsapp";

  // 3. Retell / voice signals
  if (src === "retell") return "voice_call";
  if (wbahSrc === "wbah_calls") return "voice_call";

  // 4. CRM indicators
  if (wbahSrc === "crm") return "crm";
  if (["inbound", "outbound", "referral"].includes(src)) return "crm";

  // 5. Web forms
  const WEB_FORM_SOURCES = new Set([
    "website_form", "landing_page", "facebook_lead_form", "google_ads_lead_form",
    "tiktok_lead_form", "linkedin_lead_form", "custom_form", "webee_website_form",
    "zapier", "make", "website", "webform",
  ]);
  if (WEB_FORM_SOURCES.has(src)) return "web_form";

  // 6. CSV / data upload
  if (src === "import") return "csv_import";

  // 7. API ingestion
  if (src === "api") return "api";

  // 8. Manual
  if (src === "manual") return "manual";

  return "unknown";
}

/** Returns the canonical display object for a lead — always non-null. */
export function resolveLeadOriginDisplay(lead: Parameters<typeof deriveLeadOrigin>[0]): {
  origin: LeadOrigin;
  label: string;
  description: string;
  icon: string;
  tone: string;
  provider: string | null;
  tooltipText: string;
} {
  const origin = deriveLeadOrigin(lead);
  const meta   = ORIGIN_META[origin];
  const provider = lead.origin_provider ?? (lead as any)?.meta?.wbah_source ?? null;

  const tooltipText = provider
    ? `${meta.label}\nvia ${provider}`
    : meta.label;

  return {
    origin,
    label: meta.label,
    description: meta.description,
    icon: meta.icon,
    tone: meta.tone,
    provider: provider as string | null,
    tooltipText,
  };
}
