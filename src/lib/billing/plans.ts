// Plan catalog — single source of truth for pricing UI + feature gating.
// Price IDs match the Stripe products created via batch_create_product.

export type PlanTier = "free" | "lite" | "pro" | "enterprise";

export interface PlanLimits {
  maxAgents: number; // Infinity = unlimited
  includedMinutes: number;
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
