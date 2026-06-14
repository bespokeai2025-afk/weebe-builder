// ── Executive Council — shared, client-safe foundation ─────────────────────────
// Constants + TypeScript contract types describing the AI executive team.
// NO server imports here — this module is imported by both UI and server code.
//
// HiveMind is the only executive the user talks to (acting COO). GrowthMind is an
// advisory CMO that reports up to HiveMind. Future executives are declared as
// "planned" placeholders so the bridge + UI can grow without a redesign.

export type ExecSource = "hivemind" | "growthmind" | "systemmind";

export type ExecutiveStatus = "active" | "planned";

export type ExecutiveRole =
  | "COO"   // Operations — HiveMind
  | "CMO"   // Marketing — GrowthMind
  | "CTO"   // Systems — SystemMind (planned)
  | "CSO"   // Sales — SalesMind (planned)
  | "CFO";  // Finance — FinanceMind (planned)

export type ExecutiveMember = {
  id:        string;          // stable key, e.g. "hivemind"
  name:      string;          // display name, e.g. "HiveMind"
  role:      ExecutiveRole;   // COO / CMO / ...
  title:     string;          // human title, e.g. "Chief Operating Officer"
  status:    ExecutiveStatus; // active | planned
  domain:    string;          // one-word domain label, e.g. "Operations"
  blurb:     string;          // short description of remit
  reportsTo: string | null;   // member id this executive reports up to
  accent:    string;          // tailwind color token used in UI, e.g. "amber"
};

// The Executive Council. HiveMind (COO) is the single user-facing executive;
// GrowthMind (CMO) reports up to it. The rest are declared placeholders.
export const EXECUTIVE_COUNCIL: ExecutiveMember[] = [
  {
    id: "hivemind",
    name: "HiveMind",
    role: "COO",
    title: "Chief Operating Officer",
    status: "active",
    domain: "Operations",
    blurb: "Runs day-to-day operations — agents, calls, leads, bookings, campaigns, cost and system health. The only executive you talk to.",
    reportsTo: null,
    accent: "amber",
  },
  {
    id: "growthmind",
    name: "GrowthMind",
    role: "CMO",
    title: "Chief Marketing Officer",
    status: "active",
    domain: "Marketing",
    blurb: "Advises on marketing readiness, demand generation, funnel conversion, content/SEO and channel growth. Recommends — never executes.",
    reportsTo: "hivemind",
    accent: "violet",
  },
  {
    id: "systemmind",
    name: "SystemMind",
    role: "CTO",
    title: "Chief Technology Officer",
    status: "active",
    domain: "Systems",
    blurb: "Monitors platform infrastructure, integrations health, reliability, security and runtime cost. Advises HiveMind on technical risk — never executes.",
    reportsTo: "hivemind",
    accent: "sky",
  },
  {
    id: "salesmind",
    name: "SalesMind",
    role: "CSO",
    title: "Chief Sales Officer",
    status: "planned",
    domain: "Sales",
    blurb: "Will own pipeline velocity, deal coaching and close-rate optimisation.",
    reportsTo: "hivemind",
    accent: "emerald",
  },
  {
    id: "financemind",
    name: "FinanceMind",
    role: "CFO",
    title: "Chief Financial Officer",
    status: "planned",
    domain: "Finance",
    blurb: "Will track unit economics, spend efficiency and revenue forecasting.",
    reportsTo: "hivemind",
    accent: "rose",
  },
];

export const ACTIVE_EXECUTIVES = EXECUTIVE_COUNCIL.filter((e) => e.status === "active");

export function getExecutive(id: string): ExecutiveMember | undefined {
  return EXECUTIVE_COUNCIL.find((e) => e.id === id);
}

// ── Executive task types ───────────────────────────────────────────────────────
// The defined set of marketing tasks GrowthMind may escalate up to HiveMind.
// HiveMind decides per finding whether to create a task / action / ignore / escalate.
export const EXECUTIVE_TASK_TYPES = {
  SEO_CAMPAIGN:        "create_seo_campaign",
  FOLLOW_UP_CAMPAIGN:  "create_follow_up_campaign",
  REFERRAL_CAMPAIGN:   "create_referral_campaign",
  CONTENT_PLAN:        "create_content_plan",
  COMPETITOR_REVIEW:   "create_competitor_review",
  LEAD_NURTURE:        "create_lead_nurture_sequence",
} as const;

export type ExecutiveTaskType =
  (typeof EXECUTIVE_TASK_TYPES)[keyof typeof EXECUTIVE_TASK_TYPES];

export const EXECUTIVE_TASK_LABELS: Record<ExecutiveTaskType, string> = {
  [EXECUTIVE_TASK_TYPES.SEO_CAMPAIGN]:       "Create SEO Campaign",
  [EXECUTIVE_TASK_TYPES.FOLLOW_UP_CAMPAIGN]: "Create Follow-Up Campaign",
  [EXECUTIVE_TASK_TYPES.REFERRAL_CAMPAIGN]:  "Create Referral Campaign",
  [EXECUTIVE_TASK_TYPES.CONTENT_PLAN]:       "Create Content Plan",
  [EXECUTIVE_TASK_TYPES.COMPETITOR_REVIEW]:  "Create Competitor Review",
  [EXECUTIVE_TASK_TYPES.LEAD_NURTURE]:       "Create Lead Nurture Sequence",
};

// ── Summary contract types ─────────────────────────────────────────────────────
// The shape every executive summary plugs into. New executives implement the same
// contract so HiveMind can merge them without a redesign.

export type ExecReadiness = {
  key:   string;  // campaigns | leads | funnel | content | channels
  label: string;
  score: number;
  max:   number;
  pct:   number;
  note:  string;
  color: "emerald" | "amber" | "red" | "slate";
};

export type ExecOpportunity = {
  id:      string;
  label:   string;
  detail:  string;
  urgency: "critical" | "high" | "medium" | "low";
};

export type ExecRisk = {
  id:       string;
  title:    string;
  detail:   string;
  severity: "critical" | "high" | "medium" | "low";
};

export type ExecRecommendedAction = {
  id:            string;
  label:         string;        // human label, e.g. "Create Referral Campaign"
  taskType:      ExecutiveTaskType | null;
  priority:      "critical" | "high" | "medium" | "low";
  problem:       string;
  fix:           string;
  actionHref?:   string | null;
};

export type ExecMarketingReport = {
  id:    string;
  type:  string;   // "Revenue Forecast" | "Funnel Snapshot" | "Growth Plan"
  title: string;
  date:  string;   // ISO timestamp
};

export type RevenueOpportunity = {
  recoverableLeads: number;   // stale + never-contacted + stalled + no-show
  hotLeads:         number;   // active intent, not yet booked
  estimatedValue:   number | null; // monetary estimate, null when no deal value configured
  note:             string;   // always labelled as an estimate
};

export type GrowthMindExecutiveSummary = {
  source:                 "growthmind";
  role:                   "CMO";
  generatedAt:            string;
  marketingReadinessScore: number;   // 0-100 (== growth score total)
  grade:                  string;
  label:                  string;
  readiness:              ExecReadiness[];     // campaign / lead / funnel / content / channel readiness
  topOpportunities:       ExecOpportunity[];
  topRisks:               ExecRisk[];
  revenueOpportunity:     RevenueOpportunity;
  missingMarketingAssets: string[];
  recommendedActions:     ExecRecommendedAction[];
  recentMarketingReports: ExecMarketingReport[];
  headline:               string;   // one-line spoken/printed summary
};

export type SystemMindExecutiveSummary = {
  source:           "systemmind";
  role:             "CTO";
  generatedAt:      string;
  reliabilityScore: number;   // 0-100
  grade:            string;
  label:            string;
  integrations:     { connected: number; total: number };
  systemHealth:     Record<string, boolean>;
  cost:             { totalDollars: number; requests: number; errors: number };
  topRisks:         ExecRisk[];
  recommendedActions: ExecRecommendedAction[];
  headline:         string;
};

export type HiveMindExecutiveSummary = {
  source:        "hivemind";
  role:          "COO";
  generatedAt:   string;
  leads:         { total: number; active: number; idle: number; newThisMonth: number; conversionRate: number };
  calls:         { total: number; successRate: number; thisMonth: number };
  bookings:      { total: number; thisMonth: number; thisWeek: number };
  campaigns:     { total: number; active: number; stalled: number };
  pipeline:      { stage: string; count: number }[];
  cost:          { totalDollars: number; costPerLead: number; totalMinutes: number };
  systemHealth:  Record<string, boolean>;
  headline:      string;
};

export type ExecutiveCouncilSummary = {
  generatedAt: string;
  council:     ExecutiveMember[];
  operations:  HiveMindExecutiveSummary;
  marketing:   GrowthMindExecutiveSummary;
  topOpportunity:      ExecOpportunity | null;
  topRisk:             ExecRisk | null;
  topRecommendedAction: ExecRecommendedAction | null;
  headline:    string;
};

export type ExecutiveEvent = {
  id:         string;
  source:     ExecSource;
  event_type: string;
  summary:    string;
  severity:   "info" | "warning" | "critical";
  created_at: string;
};
