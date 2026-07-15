// ── AccountsMind industry presets — SHARED (client-safe) ─────────────────────
// Deterministic, code-owned dashboard presets per industry. Each preset may
// ONLY reference NON-SENSITIVE metric keys from the server METRIC_REGISTRY
// whitelist (enforced again server-side at apply time). Everything in a
// preset is client_visible by design — no billing/cost metrics ever appear
// here. Applying a preset is strictly workspace-scoped and uses the same
// versioned insert chain as approved SystemMind drafts.

export type PresetFormat = "number" | "currency" | "percentage" | "duration" | "count";
export type PresetWidgetType = "stat_card" | "breakdown_list" | "progress" | "trend";

export interface IndustryPresetStat {
  stat_key:    string;
  label:       string;
  metric_key:  string;
  format:      PresetFormat;
  description: string;
}

export interface IndustryPresetWidget {
  widget_key:  string;
  title:       string;
  widget_type: PresetWidgetType;
  metric_key:  string;
  format:      PresetFormat;
  description: string;
}

export interface IndustryPreset {
  key:         string;
  label:       string;
  description: string;
  /** Short line used to seed the SystemMind setup assistant. */
  assistantSeed: string;
  stats:   IndustryPresetStat[];
  widgets: IndustryPresetWidget[];
}

/** Non-sensitive metric keys presets are allowed to use (client-safe subset). */
export const PRESET_SAFE_METRIC_KEYS = [
  "leads_total",
  "leads_new_this_month",
  "leads_qualified",
  "leads_callback_requested",
  "meetings_requested",
  "calls_total",
  "calls_this_month",
  "call_minutes_this_month",
  "successful_calls_this_month",
  "positive_sentiment_calls_this_month",
  "agents_total",
  "campaigns_active",
  "provider_requests_this_month",
  "provider_error_rate_this_month",
] as const;

const s = (
  stat_key: string, label: string, metric_key: string,
  format: PresetFormat, description: string,
): IndustryPresetStat => ({ stat_key, label, metric_key, format, description });

const w = (
  widget_key: string, title: string, widget_type: PresetWidgetType,
  metric_key: string, format: PresetFormat, description: string,
): IndustryPresetWidget => ({ widget_key, title, widget_type, metric_key, format, description });

export const INDUSTRY_PRESETS: Record<string, IndustryPreset> = {
  ai_automation_agency: {
    key: "ai_automation_agency",
    label: "AI / Automation Agency",
    description: "Agencies building and running AI voice & messaging automations for their own clients (this is WEBEE's own industry).",
    assistantSeed: "An AI/automation agency running AI voice and WhatsApp agents for clients. Focus on agent fleet health, call volume, connection quality and campaign activity.",
    stats: [
      s("agency_agents", "AI agents live", "agents_total", "count", "AI agents built in this workspace."),
      s("agency_calls_month", "Calls handled this month", "calls_this_month", "count", "Calls handled by your AI agents this month."),
      s("agency_minutes", "Automation minutes this month", "call_minutes_this_month", "duration", "Total AI talk-time this month."),
      s("agency_error_rate", "Provider error rate", "provider_error_rate_this_month", "percentage", "Errors across provider requests this month."),
    ],
    widgets: [
      w("agency_calls_trend", "Call volume trend", "trend", "calls_this_month", "count", "Daily call volume this month."),
      w("agency_success", "Successful calls", "stat_card", "successful_calls_this_month", "count", "Calls flagged successful this month."),
      w("agency_campaigns", "Active campaigns", "stat_card", "campaigns_active", "count", "Campaigns currently running."),
      w("agency_requests", "Provider requests", "stat_card", "provider_requests_this_month", "count", "AI provider API requests this month."),
    ],
  },
  property_real_estate: {
    key: "property_real_estate",
    label: "Property & Real Estate",
    description: "Estate agencies, property buyers, lettings and property services.",
    assistantSeed: "A property/real-estate business using AI agents to qualify sellers and buyers, book valuations and viewings. Emphasise enquiries, qualified vendors, and booked appointments.",
    stats: [
      s("prop_enquiries", "Property enquiries", "leads_total", "count", "All property enquiries captured."),
      s("prop_new_month", "New enquiries this month", "leads_new_this_month", "count", "Enquiries received this month."),
      s("prop_qualified", "Qualified vendors & buyers", "leads_qualified", "count", "Enquiries qualified as serious sellers or buyers."),
      s("prop_valuations", "Valuations & viewings booked", "meetings_requested", "count", "Appointments requested via your AI agents."),
    ],
    widgets: [
      w("prop_enquiry_trend", "Enquiry trend", "trend", "leads_new_this_month", "count", "New property enquiries per day."),
      w("prop_calls_month", "Calls this month", "stat_card", "calls_this_month", "count", "AI calls made and answered this month."),
      w("prop_positive", "Positive conversations", "stat_card", "positive_sentiment_calls_this_month", "count", "Calls with positive seller/buyer sentiment."),
      w("prop_callbacks", "Callback requests", "stat_card", "leads_callback_requested", "count", "People asking to be called back."),
    ],
  },
  legal_services: {
    key: "legal_services",
    label: "Legal Services",
    description: "Law firms, solicitors, conveyancing and legal consultancies.",
    assistantSeed: "A legal services firm using AI reception to triage enquiries and book consultations. Emphasise new matters, qualified enquiries and booked consultations.",
    stats: [
      s("legal_enquiries", "Client enquiries", "leads_total", "count", "All prospective-client enquiries."),
      s("legal_new_month", "New enquiries this month", "leads_new_this_month", "count", "Enquiries received this month."),
      s("legal_qualified", "Qualified matters", "leads_qualified", "count", "Enquiries qualified as viable matters."),
      s("legal_consults", "Consultations requested", "meetings_requested", "count", "Consultation bookings requested."),
    ],
    widgets: [
      w("legal_enquiry_trend", "Enquiry trend", "trend", "leads_new_this_month", "count", "New enquiries per day."),
      w("legal_calls", "Calls answered this month", "stat_card", "calls_this_month", "count", "Calls handled by your AI receptionist."),
      w("legal_callbacks", "Callback requests", "stat_card", "leads_callback_requested", "count", "Clients asking for a call back."),
      w("legal_positive", "Positive conversations", "stat_card", "positive_sentiment_calls_this_month", "count", "Calls with positive sentiment."),
    ],
  },
  healthcare_clinics: {
    key: "healthcare_clinics",
    label: "Healthcare & Clinics",
    description: "Clinics, dental practices, physiotherapy, aesthetics and private healthcare.",
    assistantSeed: "A healthcare clinic using AI reception for patient enquiries and appointment booking. Emphasise patient enquiries, appointments requested and answered calls.",
    stats: [
      s("hc_patients", "Patient enquiries", "leads_total", "count", "All patient enquiries captured."),
      s("hc_new_month", "New enquiries this month", "leads_new_this_month", "count", "Patient enquiries this month."),
      s("hc_appointments", "Appointments requested", "meetings_requested", "count", "Appointment bookings requested."),
      s("hc_callbacks", "Callback requests", "leads_callback_requested", "count", "Patients asking to be called back."),
    ],
    widgets: [
      w("hc_enquiry_trend", "Patient enquiry trend", "trend", "leads_new_this_month", "count", "New patient enquiries per day."),
      w("hc_calls", "Calls answered this month", "stat_card", "calls_this_month", "count", "Calls handled by your AI receptionist."),
      w("hc_minutes", "Reception minutes saved", "stat_card", "call_minutes_this_month", "duration", "Minutes of calls handled automatically."),
      w("hc_positive", "Positive patient calls", "stat_card", "positive_sentiment_calls_this_month", "count", "Calls with positive sentiment."),
    ],
  },
  home_services: {
    key: "home_services",
    label: "Home Services & Trades",
    description: "Plumbers, electricians, builders, cleaning, landscaping and other trades.",
    assistantSeed: "A home-services/trades business using AI agents to capture job enquiries and book site visits. Emphasise job enquiries, quotes requested and booked visits.",
    stats: [
      s("hs_jobs", "Job enquiries", "leads_total", "count", "All job enquiries captured."),
      s("hs_new_month", "New enquiries this month", "leads_new_this_month", "count", "Job enquiries this month."),
      s("hs_qualified", "Quotable jobs", "leads_qualified", "count", "Enquiries qualified as real jobs."),
      s("hs_visits", "Site visits requested", "meetings_requested", "count", "Site-visit bookings requested."),
    ],
    widgets: [
      w("hs_job_trend", "Job enquiry trend", "trend", "leads_new_this_month", "count", "New job enquiries per day."),
      w("hs_calls", "Calls answered this month", "stat_card", "calls_this_month", "count", "Calls answered while you were on the tools."),
      w("hs_callbacks", "Callback requests", "stat_card", "leads_callback_requested", "count", "Customers asking for a call back."),
      w("hs_success", "Successful calls", "stat_card", "successful_calls_this_month", "count", "Calls flagged successful this month."),
    ],
  },
  ecommerce_retail: {
    key: "ecommerce_retail",
    label: "E-commerce & Retail",
    description: "Online stores, retail brands and direct-to-consumer businesses.",
    assistantSeed: "An e-commerce/retail brand using AI agents for customer contact and campaigns. Emphasise customer contacts, campaign activity and conversation quality.",
    stats: [
      s("ec_customers", "Customer contacts", "leads_total", "count", "All customer contacts captured."),
      s("ec_new_month", "New contacts this month", "leads_new_this_month", "count", "Contacts added this month."),
      s("ec_campaigns", "Active campaigns", "campaigns_active", "count", "Campaigns currently running."),
      s("ec_positive", "Positive conversations", "positive_sentiment_calls_this_month", "count", "Conversations with positive sentiment."),
    ],
    widgets: [
      w("ec_contact_trend", "Contact growth trend", "trend", "leads_new_this_month", "count", "New customer contacts per day."),
      w("ec_calls", "Conversations this month", "stat_card", "calls_this_month", "count", "AI conversations this month."),
      w("ec_success", "Successful conversations", "stat_card", "successful_calls_this_month", "count", "Conversations flagged successful."),
      w("ec_callbacks", "Callback requests", "stat_card", "leads_callback_requested", "count", "Customers asking to be contacted."),
    ],
  },
  finance_insurance: {
    key: "finance_insurance",
    label: "Finance & Insurance",
    description: "Brokers, financial advisers, insurance and lending businesses.",
    assistantSeed: "A finance/insurance business using AI agents to qualify applicants and book adviser appointments. Emphasise qualified applicants and booked appointments.",
    stats: [
      s("fin_enquiries", "Applicant enquiries", "leads_total", "count", "All applicant enquiries captured."),
      s("fin_new_month", "New enquiries this month", "leads_new_this_month", "count", "Enquiries received this month."),
      s("fin_qualified", "Qualified applicants", "leads_qualified", "count", "Applicants qualified for your products."),
      s("fin_appointments", "Adviser appointments requested", "meetings_requested", "count", "Appointments requested with an adviser."),
    ],
    widgets: [
      w("fin_enquiry_trend", "Enquiry trend", "trend", "leads_new_this_month", "count", "New applicant enquiries per day."),
      w("fin_calls", "Calls this month", "stat_card", "calls_this_month", "count", "AI calls handled this month."),
      w("fin_positive", "Positive conversations", "stat_card", "positive_sentiment_calls_this_month", "count", "Calls with positive sentiment."),
      w("fin_callbacks", "Callback requests", "stat_card", "leads_callback_requested", "count", "Applicants asking to be called back."),
    ],
  },
  recruitment_staffing: {
    key: "recruitment_staffing",
    label: "Recruitment & Staffing",
    description: "Recruitment agencies, staffing firms and talent businesses.",
    assistantSeed: "A recruitment/staffing agency using AI agents to screen candidates and book interviews. Emphasise candidate pipeline, screened candidates and interviews booked.",
    stats: [
      s("rec_candidates", "Candidates in pipeline", "leads_total", "count", "All candidates captured."),
      s("rec_new_month", "New candidates this month", "leads_new_this_month", "count", "Candidates added this month."),
      s("rec_screened", "Screened & qualified", "leads_qualified", "count", "Candidates qualified by AI screening."),
      s("rec_interviews", "Interviews requested", "meetings_requested", "count", "Interview bookings requested."),
    ],
    widgets: [
      w("rec_candidate_trend", "Candidate flow trend", "trend", "leads_new_this_month", "count", "New candidates per day."),
      w("rec_calls", "Screening calls this month", "stat_card", "calls_this_month", "count", "AI screening calls this month."),
      w("rec_success", "Successful screens", "stat_card", "successful_calls_this_month", "count", "Screening calls flagged successful."),
      w("rec_callbacks", "Callback requests", "stat_card", "leads_callback_requested", "count", "Candidates asking to be called back."),
    ],
  },
  hospitality_travel: {
    key: "hospitality_travel",
    label: "Hospitality & Travel",
    description: "Hotels, restaurants, venues, travel and events businesses.",
    assistantSeed: "A hospitality/travel business using AI agents for reservations and guest enquiries. Emphasise guest enquiries, reservations requested and answered calls.",
    stats: [
      s("hosp_guests", "Guest enquiries", "leads_total", "count", "All guest enquiries captured."),
      s("hosp_new_month", "New enquiries this month", "leads_new_this_month", "count", "Guest enquiries this month."),
      s("hosp_reservations", "Reservations requested", "meetings_requested", "count", "Reservation/booking requests."),
      s("hosp_callbacks", "Callback requests", "leads_callback_requested", "count", "Guests asking to be called back."),
    ],
    widgets: [
      w("hosp_enquiry_trend", "Guest enquiry trend", "trend", "leads_new_this_month", "count", "New guest enquiries per day."),
      w("hosp_calls", "Calls answered this month", "stat_card", "calls_this_month", "count", "Calls handled by your AI host."),
      w("hosp_minutes", "Front-desk minutes saved", "stat_card", "call_minutes_this_month", "duration", "Minutes of calls handled automatically."),
      w("hosp_positive", "Positive guest calls", "stat_card", "positive_sentiment_calls_this_month", "count", "Calls with positive sentiment."),
    ],
  },
  general_business: {
    key: "general_business",
    label: "General Business",
    description: "A balanced dashboard for any business type.",
    assistantSeed: "A general business using AI agents for inbound and outbound contact. Balanced view of leads, calls and campaign activity.",
    stats: [
      s("gen_leads", "Total leads", "leads_total", "count", "All leads in your CRM."),
      s("gen_new_month", "New leads this month", "leads_new_this_month", "count", "Leads added this month."),
      s("gen_qualified", "Qualified leads", "leads_qualified", "count", "Leads qualified as interested."),
      s("gen_meetings", "Meetings requested", "meetings_requested", "count", "Meeting requests captured."),
    ],
    widgets: [
      w("gen_lead_trend", "Lead growth trend", "trend", "leads_new_this_month", "count", "New leads per day."),
      w("gen_calls", "Calls this month", "stat_card", "calls_this_month", "count", "AI calls this month."),
      w("gen_success", "Successful calls", "stat_card", "successful_calls_this_month", "count", "Calls flagged successful."),
      w("gen_campaigns", "Active campaigns", "stat_card", "campaigns_active", "count", "Campaigns currently running."),
    ],
  },
};

export const INDUSTRY_KEYS = Object.keys(INDUSTRY_PRESETS);

export interface IndustryOption { key: string; label: string; description: string }

export function listIndustryOptions(): IndustryOption[] {
  return Object.values(INDUSTRY_PRESETS).map(({ key, label, description }) => ({ key, label, description }));
}

export function industryLabel(key: string | null | undefined): string | null {
  if (!key) return null;
  return INDUSTRY_PRESETS[key]?.label ?? null;
}
