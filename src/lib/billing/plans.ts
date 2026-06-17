// Plan catalog — single source of truth for pricing UI + feature gating.
// Price IDs match the Stripe products created via batch_create_product.

export type PlanTier = "free" | "lite" | "pro" | "enterprise";

export interface PlanLimits {
  maxAgents: number; // Infinity = unlimited
  includedMinutes: number;
  includedUsers?: number; // seat billing: users included in base price
  additionalUserPricePence?: number | null; // extra per-seat monthly cost
  seatWarningThreshold?: number; // 0–1, e.g. 0.8 = warn at 80% capacity
}

export interface Plan {
  tier: PlanTier;
  name: string;
  tagline: string;
  priceLabel: string;
  amountPerMonth: number | null; // pence; null = contact sales
  currency: "GBP";
  priceId: string | null;
  limits: PlanLimits;
  features: string[];
  highlighted?: boolean;
  cta: string;
}

export const PLANS: Plan[] = [
  {
    tier: "free",
    name: "Builder PAYG",
    tagline: "Pay-as-you-go testing",
    priceLabel: "£0",
    amountPerMonth: 0,
    currency: "GBP",
    priceId: "builder_payg_monthly",
    limits: { maxAgents: 1, includedMinutes: 0 },
    features: [
      "Build & test flows in the canvas",
      "Per-minute call cost (LLM at-cost)",
      "No monthly commitment",
      "1 deployed agent",
    ],
    cta: "Start PAYG",
  },

  {
    tier: "lite",
    name: "Receptionist Lite",
    tagline: "1 agent · 60 mins included",
    priceLabel: "£297",
    amountPerMonth: 29700,
    currency: "GBP",
    priceId: "receptionist_lite_monthly",
    limits: { maxAgents: 1, includedMinutes: 60 },
    features: [
      "1 AI receptionist",
      "60 minutes included / month",
      "Dashboard access",
      "Calendar integration",
      "Basic templates",
      "Missed call capture",
    ],
    cta: "Choose Lite",
  },
  {
    tier: "pro",
    name: "Receptionist Pro",
    tagline: "Multi-agent · 200 mins",
    priceLabel: "£697",
    amountPerMonth: 69700,
    currency: "GBP",
    priceId: "receptionist_pro_monthly",
    limits: { maxAgents: 5, includedMinutes: 200 },
    features: [
      "Up to 5 AI receptionists",
      "200 minutes included / month",
      "Advanced workflows",
      "Analytics dashboard",
      "Lead qualification",
      "CRM integrations",
      "SMS follow-up",
    ],
    highlighted: true,
    cta: "Choose Pro",
  },
  {
    tier: "enterprise",
    name: "Business AI Ops",
    tagline: "Custom · talk to us",
    priceLabel: "Custom",
    amountPerMonth: null,
    currency: "GBP",
    priceId: null,
    limits: { maxAgents: Number.POSITIVE_INFINITY, includedMinutes: Number.POSITIVE_INFINITY },
    features: [
      "Unlimited AI receptionists",
      "Outbound campaigns",
      "Qualification pipelines",
      "CRM orchestration",
      "Multi-location",
      "Enterprise integrations",
      "Priority support",
    ],
    cta: "Contact sales",
  },
];

// ── Enterprise / seat-based tiers ────────────────────────────────────────────
// Kept separate from PLANS so the existing Stripe billing system is unaffected.
// These tiers are seat-billed; Stripe price IDs will be added when products are created.

export type EnterpriseTier = "executive_suite" | "business_command" | "enterprise";

export interface EnterprisePlan {
  tier: EnterpriseTier;
  name: string;
  tagline: string;
  priceLabel: string;
  amountPerMonth: number | null; // pence; null = custom
  currency: "GBP";
  priceId: string | null;
  limits: PlanLimits;
  features: string[];
  highlighted?: boolean;
  cta: string;
}

export const ENTERPRISE_PLANS: EnterprisePlan[] = [
  {
    tier: "executive_suite",
    name: "Executive Suite",
    tagline: "AI OS for founders & leadership — 5 seats included",
    priceLabel: "£1,970",
    amountPerMonth: 197000,
    currency: "GBP",
    priceId: null, // add Stripe price ID when product is created
    limits: {
      maxAgents: Number.POSITIVE_INFINITY,
      includedMinutes: 0,
      includedUsers: 5,
      additionalUserPricePence: 3900,
      seatWarningThreshold: 0.8,
    },
    features: [
      "HiveMind AI COO",
      "GrowthMind AI CMO",
      "Strategy Centre",
      "Campaign Factory & Content Studio",
      "SEO Centre & Content Calendar",
      "Business DNA & Opportunity Engine",
      "Analytics Intelligence",
      "Executive Briefings",
      "Action Approval Centre",
      "Marketing Recommendations & Growth Reports",
    ],
    highlighted: true,
    cta: "Get Executive Suite",
  },
  {
    tier: "business_command",
    name: "Business Command",
    tagline: "Department-wide AI — 15 seats included",
    priceLabel: "£3,970",
    amountPerMonth: 397000,
    currency: "GBP",
    priceId: null,
    limits: {
      maxAgents: Number.POSITIVE_INFINITY,
      includedMinutes: 0,
      includedUsers: 15,
      additionalUserPricePence: 2900,
      seatWarningThreshold: 0.8,
    },
    features: [
      "Everything in Executive Suite",
      "SystemMind AI CTO",
      "AccountsMind",
      "Department Dashboards",
      "Approval Workflows",
      "Advanced & Board Reporting",
      "Custom Roles & Department Permissions",
    ],
    cta: "Get Business Command",
  },
  {
    tier: "enterprise",
    name: "Enterprise",
    tagline: "Large organisations — custom seat pricing",
    priceLabel: "From £7,500",
    amountPerMonth: null,
    currency: "GBP",
    priceId: null,
    limits: {
      maxAgents: Number.POSITIVE_INFINITY,
      includedMinutes: Number.POSITIVE_INFINITY,
      includedUsers: Number.POSITIVE_INFINITY,
      additionalUserPricePence: null,
    },
    features: [
      "Everything in Business Command",
      "Unlimited Modules",
      "SSO & Advanced Security Controls",
      "White Labelling",
      "Custom Integrations",
      "Dedicated Success Manager & SLA",
    ],
    cta: "Contact sales",
  },
];

export function enterprisePlanByTier(tier: EnterpriseTier): EnterprisePlan | undefined {
  return ENTERPRISE_PLANS.find(p => p.tier === tier);
}

export function formatGBPFromPence(pence: number): string {
  return formatGBP(pence);
}

// Seat overage calculation helper
export function calculateSeatOverage(plan: EnterprisePlan, activeUsers: number): number {
  const included = plan.limits.includedUsers ?? 0;
  const extra = Math.max(activeUsers - included, 0);
  const pricePerSeat = plan.limits.additionalUserPricePence ?? 0;
  return extra * pricePerSeat; // pence
}

export function planByPriceId(priceId: string | null | undefined): Plan {
  if (!priceId) return PLANS[0];
  return PLANS.find((p) => p.priceId === priceId) ?? PLANS[0];
}

export function planByTier(tier: PlanTier): Plan {
  return PLANS.find((p) => p.tier === tier) ?? PLANS[0];
}

export function formatGBP(pence: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(pence / 100);
}
