/**
 * Package / entitlement catalog — SINGLE SOURCE OF TRUTH for package rules.
 *
 * Safe for client + server import: types, constants and pure logic only.
 * The resolver/guards live in entitlements.server.ts.
 *
 * Model:
 *   • FEATURE_KEYS — every gateable WEBEE area/capability.
 *   • PACKAGE_CATALOG — the code-level catalog, seeded into package_definitions.
 *     DB rows (package_definitions) override the code catalog when present, so
 *     platform admins can adjust rules without code changes.
 *   • Package page access acts as a CAP: effective page level =
 *     min(role page level, package page level). Actions require both the role
 *     grant AND the package feature.
 *   • Fail closed: unknown package → TRIAL; resolution errors → no access.
 */

import {
  type PageKey,
  type PageLevel,
  type ActionKey,
  PAGE_KEYS,
  pageLevelRank,
} from "../permissions/permissions.shared";

// ── Feature keys ─────────────────────────────────────────────────────────────

export const FEATURE_KEYS = [
  "dashboard",
  "receptionist",
  "agent_builder",
  "agent_deploy",
  "phone_numbers",
  "calls",
  "leads",
  "qualified",
  "data",
  "people",
  "campaigns",
  "campaign_reports",
  "workflows",
  "follow_up",
  "whatsapp",
  "hexmail",
  "template_studio",
  "video_studio",
  "crm",
  "growthmind",
  "hivemind",
  "systemmind",
  "accountsmind",
  "analytics",
  "analytics_advanced",
  "analytics_campaign_reports",
  "analytics_financial",
  "analytics_scheduled_reports",
  "analytics_ai_insights",
  "analytics_reseller_child_reports",
  "automated_report_emails",
  "settings",
  "billing",
  "provider_settings",
  "team_access",
  "approval_settings",
  "api_webhooks",
  "white_labelling",
  "white_label_custom_domain",
  "white_label_hide_webee_branding",
  "reseller_client_accounts",
  "custom_email_provider",
  "custom_roles",
  "custom_views",
  "page_filters",
  "integrations",
  "knowledge_centre",
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  dashboard: "Dashboard",
  receptionist: "WEBEE Receptionist",
  agent_builder: "Agent Builder",
  agent_deploy: "Agent Deploy / Go Live",
  phone_numbers: "Phone Numbers / SIP",
  calls: "Calls",
  leads: "Leads",
  qualified: "Qualified",
  data: "Data",
  people: "People",
  campaigns: "Campaigns",
  campaign_reports: "Campaign Reports",
  workflows: "Workflows",
  follow_up: "Follow Up Centre",
  whatsapp: "WhatsApp Centre / BuzzChat",
  hexmail: "HexMail / Email Centre",
  template_studio: "Template Studio",
  video_studio: "Video & Creative Studio",
  crm: "WEBEE CRM",
  growthmind: "GrowthMind (AI CMO)",
  hivemind: "HiveMind (AI COO)",
  systemmind: "SystemMind (AI CTO)",
  accountsmind: "AccountsMind",
  analytics: "Analytics (Basic)",
  analytics_advanced: "Advanced Analytics",
  analytics_campaign_reports: "Analytics Campaign Reports",
  analytics_financial: "Financial / ROI Analytics",
  analytics_scheduled_reports: "Scheduled Reports",
  analytics_ai_insights: "AI Analytics Insights",
  analytics_reseller_child_reports: "Reseller Child Workspace Reports",
  automated_report_emails: "Automated Report Emails",
  settings: "Settings",
  billing: "Billing",
  provider_settings: "Provider Settings",
  team_access: "Team Access",
  approval_settings: "Approval Settings",
  api_webhooks: "API / Webhooks",
  white_labelling: "White Labelling",
  white_label_custom_domain: "White Label Custom Domain",
  white_label_hide_webee_branding: "Hide WEBEE Branding",
  reseller_client_accounts: "Reseller Client Accounts",
  custom_email_provider: "Custom Email Provider",
  custom_roles: "Custom Roles",
  custom_views: "Custom Views",
  page_filters: "Page Filters",
  integrations: "Integrations",
  knowledge_centre: "Knowledge Centre",
};

// ── Add-ons ──────────────────────────────────────────────────────────────────

export const ADDON_EXTRA_STAFF_USER = "extra_staff_user";
export const ADDON_EXTRA_CHILD_ACCOUNT = "extra_child_account";

export interface AddonDef {
  addonKey: string;
  addonName: string;
  description: string;
  monthlyPricePence: number; // per unit
  quantityBased: boolean;
}

export const ADDON_CATALOG: AddonDef[] = [
  {
    addonKey: ADDON_EXTRA_STAFF_USER,
    addonName: "Extra Staff User",
    description: "Adds one additional staff login seat to your workspace.",
    monthlyPricePence: 3900,
    quantityBased: true,
  },
  {
    addonKey: ADDON_EXTRA_CHILD_ACCOUNT,
    addonName: "Extra Client Account",
    description: "Adds one additional reseller child client account slot.",
    monthlyPricePence: 4900,
    quantityBased: true,
  },
];

export function addonByKey(key: string): AddonDef | undefined {
  return ADDON_CATALOG.find((a) => a.addonKey === key);
}

// ── Package model ────────────────────────────────────────────────────────────

export interface PackageLimits {
  includedVoiceMinutes: number;
  includedStaffUsers: number;
  maxAgents: number | null; // null = unlimited
  maxWorkflows: number | null;
  maxCampaigns: number | null;
  maxCustomViews: number | null;
  maxPageFilters: number | null;
  maxCampaignFilters: number | null;
  /** Reseller child client accounts included (0 = none; null = unlimited). */
  maxChildAccounts: number | null;
}

export interface PackageDef {
  packageKey: string;
  packageName: string;
  description: string;
  monthlyPricePence: number | null; // null = custom
  annualPricePence?: number | null;
  currency: "GBP";
  limits: PackageLimits;
  /** Feature keys included in this package. */
  features: FeatureKey[];
  /** Page-level CAPS (missing page ⇒ derived from features; hidden if the owning feature is absent). */
  pageAccessCaps?: Partial<Record<PageKey, PageLevel>>;
  /** Actions the package permits at all (role still required). Missing key ⇒ derived from features. */
  actionCaps?: Partial<Record<ActionKey, boolean>>;
  aiDepartments: ("growthmind" | "hivemind" | "systemmind" | "accountsmind")[];
  isActive: boolean;
}

const CORE_FEATURES: FeatureKey[] = [
  "dashboard",
  "settings",
  "billing",
  "team_access",
  "knowledge_centre",
];

// ── Catalog (aligned with plans.ts pricing tiers) ────────────────────────────

export const PACKAGE_CATALOG: PackageDef[] = [
  {
    packageKey: "trial",
    packageName: "Trial / Builder PAYG",
    description: "Default package for new signups — build and test only.",
    monthlyPricePence: 0,
    currency: "GBP",
    limits: {
      includedVoiceMinutes: 0,
      includedStaffUsers: 1,
      maxAgents: 1,
      maxWorkflows: 1,
      maxCampaigns: 0,
      maxCustomViews: 2,
      maxPageFilters: 2,
      maxCampaignFilters: 0,
      maxChildAccounts: 0,
    },
    features: [
      ...CORE_FEATURES,
      "agent_builder",
      "calls",
      "leads",
      "crm",
      "analytics",
    ],
    aiDepartments: [],
    isActive: true,
  },
  {
    packageKey: "receptionist_lite",
    packageName: "Receptionist Lite",
    description: "1 AI receptionist, 60 included minutes.",
    monthlyPricePence: 29700,
    currency: "GBP",
    limits: {
      includedVoiceMinutes: 60,
      includedStaffUsers: 1,
      maxAgents: 1,
      maxWorkflows: 2,
      maxCampaigns: 0,
      maxCustomViews: 3,
      maxPageFilters: 3,
      maxCampaignFilters: 0,
      maxChildAccounts: 0,
    },
    features: [
      ...CORE_FEATURES,
      "receptionist",
      "agent_builder",
      "agent_deploy",
      "phone_numbers",
      "calls",
      "leads",
      "crm",
      "analytics",
      "template_studio",
    ],
    aiDepartments: [],
    isActive: true,
  },
  {
    packageKey: "receptionist_pro",
    packageName: "Receptionist Pro",
    description: "Up to 5 agents, 200 minutes, campaigns and workflows.",
    monthlyPricePence: 69700,
    currency: "GBP",
    limits: {
      includedVoiceMinutes: 200,
      includedStaffUsers: 3,
      maxAgents: 5,
      maxWorkflows: 10,
      maxCampaigns: 10,
      maxCustomViews: 10,
      maxPageFilters: 10,
      maxCampaignFilters: 10,
      maxChildAccounts: 0,
    },
    features: [
      ...CORE_FEATURES,
      "receptionist",
      "agent_builder",
      "agent_deploy",
      "phone_numbers",
      "calls",
      "leads",
      "qualified",
      "data",
      "people",
      "campaigns",
      "campaign_reports",
      "workflows",
      "follow_up",
      "crm",
      "analytics",
      "analytics_advanced",
      "analytics_campaign_reports",
      "automated_report_emails",
      "template_studio",
      "hexmail",
      "custom_views",
      "page_filters",
      "integrations",
    ],
    aiDepartments: [],
    isActive: true,
  },
  {
    packageKey: "executive_suite",
    packageName: "Executive Suite",
    description: "AI OS for founders & leadership — 5 seats included.",
    monthlyPricePence: 197000,
    currency: "GBP",
    limits: {
      includedVoiceMinutes: 0,
      includedStaffUsers: 5,
      maxAgents: null,
      maxWorkflows: null,
      maxCampaigns: null,
      maxCustomViews: null,
      maxPageFilters: null,
      maxCampaignFilters: null,
      maxChildAccounts: 0,
    },
    features: [
      ...CORE_FEATURES,
      "receptionist",
      "agent_builder",
      "agent_deploy",
      "phone_numbers",
      "calls",
      "leads",
      "qualified",
      "data",
      "people",
      "campaigns",
      "campaign_reports",
      "workflows",
      "follow_up",
      "whatsapp",
      "hexmail",
      "template_studio",
      "video_studio",
      "crm",
      "growthmind",
      "hivemind",
      "analytics",
      "analytics_advanced",
      "analytics_campaign_reports",
      "analytics_financial",
      "analytics_scheduled_reports",
      "analytics_ai_insights",
      "analytics_reseller_child_reports",
      "automated_report_emails",
      "approval_settings",
      "custom_views",
      "page_filters",
      "integrations",
      "custom_roles",
    ],
    aiDepartments: ["growthmind", "hivemind"],
    isActive: true,
  },
  {
    packageKey: "business_command",
    packageName: "Business Command",
    description: "Department-wide AI — 15 seats included.",
    monthlyPricePence: 397000,
    currency: "GBP",
    limits: {
      includedVoiceMinutes: 0,
      includedStaffUsers: 15,
      maxAgents: null,
      maxWorkflows: null,
      maxCampaigns: null,
      maxCustomViews: null,
      maxPageFilters: null,
      maxCampaignFilters: null,
      maxChildAccounts: 0,
    },
    features: [
      ...CORE_FEATURES,
      "receptionist",
      "agent_builder",
      "agent_deploy",
      "phone_numbers",
      "calls",
      "leads",
      "qualified",
      "data",
      "people",
      "campaigns",
      "campaign_reports",
      "workflows",
      "follow_up",
      "whatsapp",
      "hexmail",
      "template_studio",
      "video_studio",
      "crm",
      "growthmind",
      "hivemind",
      "systemmind",
      "accountsmind",
      "analytics",
      "analytics_advanced",
      "analytics_campaign_reports",
      "analytics_financial",
      "analytics_scheduled_reports",
      "analytics_ai_insights",
      "analytics_reseller_child_reports",
      "automated_report_emails",
      "provider_settings",
      "approval_settings",
      "api_webhooks",
      "custom_views",
      "page_filters",
      "integrations",
      "custom_roles",
      "custom_email_provider",
    ],
    aiDepartments: ["growthmind", "hivemind", "systemmind", "accountsmind"],
    isActive: true,
  },
  {
    packageKey: "enterprise",
    packageName: "Enterprise",
    description: "Large organisations — everything, custom pricing.",
    monthlyPricePence: null,
    currency: "GBP",
    limits: {
      includedVoiceMinutes: 999999,
      includedStaffUsers: 999,
      maxAgents: null,
      maxWorkflows: null,
      maxCampaigns: null,
      maxCustomViews: null,
      maxPageFilters: null,
      maxCampaignFilters: null,
      maxChildAccounts: 25,
    },
    features: [...FEATURE_KEYS],
    aiDepartments: ["growthmind", "hivemind", "systemmind", "accountsmind"],
    isActive: true,
  },
  {
    // Migration-safety package: assigned to existing workspaces so no one
    // loses access during rollout. Full feature set, generous seats.
    packageKey: "legacy_full",
    packageName: "Legacy (Full Access)",
    description:
      "Assigned to workspaces that existed before package gating. Preserves full access.",
    monthlyPricePence: null,
    currency: "GBP",
    limits: {
      includedVoiceMinutes: 999999,
      includedStaffUsers: 999,
      maxAgents: null,
      maxWorkflows: null,
      maxCampaigns: null,
      maxCustomViews: null,
      maxPageFilters: null,
      maxCampaignFilters: null,
      maxChildAccounts: 0,
    },
    features: FEATURE_KEYS.filter(
      (k) =>
        !["white_label_custom_domain", "white_label_hide_webee_branding", "reseller_client_accounts", "custom_email_provider"].includes(k),
    ) as FeatureKey[],
    aiDepartments: ["growthmind", "hivemind", "systemmind", "accountsmind"],
    isActive: true,
  },
];

export const DEFAULT_PACKAGE_KEY = "trial";
export const LEGACY_PACKAGE_KEY = "legacy_full";

export function packageByKey(key: string | null | undefined): PackageDef {
  const found = PACKAGE_CATALOG.find((p) => p.packageKey === key);
  // Unknown / missing → lowest safe package (fail closed to trial, per spec §10).
  return found ?? PACKAGE_CATALOG.find((p) => p.packageKey === DEFAULT_PACKAGE_KEY)!;
}

/** Map a Stripe/plans.ts price or tier onto a package key. */
export function packageKeyForPlanTier(tier: string | null | undefined): string {
  switch (tier) {
    case "lite": return "receptionist_lite";
    case "pro": return "receptionist_pro";
    case "executive_suite": return "executive_suite";
    case "business_command": return "business_command";
    case "enterprise": return "enterprise";
    case "free":
    default:
      return DEFAULT_PACKAGE_KEY;
  }
}

// ── Feature → page / action mapping ─────────────────────────────────────────

/** Which feature gates each RBAC page section. */
export const PAGE_FEATURE_MAP: Record<PageKey, FeatureKey> = {
  dashboard: "dashboard",
  agents: "agent_builder",
  campaigns: "campaigns",
  leads: "leads",
  calls: "calls",
  data: "data",
  pipeline: "crm",
  reports: "analytics",
  crm: "crm",
  knowledge: "knowledge_centre",
  workflows: "workflows",
  systemmind: "systemmind",
  growthmind: "growthmind",
  hivemind: "hivemind",
  phone_numbers: "phone_numbers",
  settings: "settings",
  team_access: "team_access",
  billing: "billing",
};

/** Which feature gates each high-risk action. */
export const ACTION_FEATURE_MAP: Record<ActionKey, FeatureKey> = {
  go_live: "agent_deploy",
  phone_purchase: "phone_numbers",
  provider_keys: "settings",
  campaign_activation: "campaigns",
  systemmind_approval: "systemmind",
  crm_mappings: "crm",
  user_management: "team_access",
  billing: "billing",
  notification_settings: "team_access",
};

/** Sidebar route → feature gate (routes not listed are ungated by package). */
export const ROUTE_FEATURE_MAP: Record<string, FeatureKey> = {
  "/dashboard": "dashboard",
  "/hivemind": "hivemind",
  "/growthmind": "growthmind",
  "/systemmind": "systemmind",
  "/knowledge-centre": "knowledge_centre",
  "/analytics": "analytics",
  "/my-agents": "agent_builder",
  "/builder": "agent_builder",
  "/templates": "agent_builder",
  "/data": "data",
  "/contacts": "crm",
  "/leads": "leads",
  "/leads/webforms": "leads",
  "/pipeline": "crm",
  "/qualified": "qualified",
  "/calls": "calls",
  "/calendar": "receptionist",
  "/template-studio": "template_studio",
  "/hexmail": "hexmail",
  "/hexmail/deliverability": "hexmail",
  "/hexmail/domain-warming": "hexmail",
  "/workflow-engine": "workflows",
  "/follow-up": "follow_up",
  "/whatsapp": "whatsapp",
  "/billing": "billing",
  "/reseller": "reseller_client_accounts",
  "/settings/white-label": "white_labelling",
};

/**
 * Sidebar/route → RBAC page section (for role/override page-level gating).
 * Routes not listed have no page-level RBAC gate (feature gate may still apply).
 */
export const ROUTE_PAGE_MAP: Record<string, PageKey> = {
  "/dashboard": "dashboard",
  "/hivemind": "hivemind",
  "/growthmind": "growthmind",
  "/systemmind": "systemmind",
  "/knowledge-centre": "knowledge",
  "/analytics": "reports",
  "/my-agents": "agents",
  "/builder": "agents",
  "/templates": "agents",
  "/data": "data",
  "/contacts": "crm",
  "/leads": "leads",
  "/leads/webforms": "leads",
  "/pipeline": "pipeline",
  "/calls": "calls",
  "/workflow-engine": "workflows",
  "/billing": "billing",
};

/** Longest-prefix match of a pathname against a route map (e.g. /systemmind/build). */
export function matchRouteKey<T>(
  pathname: string,
  map: Record<string, T>,
): T | undefined {
  let best: string | null = null;
  for (const route of Object.keys(map)) {
    if (pathname === route || pathname.startsWith(route + "/")) {
      if (!best || route.length > best.length) best = route;
    }
  }
  return best ? map[best] : undefined;
}

// ── Notification caps & package defaults ────────────────────────────────────
//
// Kept as standalone maps (not PackageDef fields) so this block stays the one
// source of truth and notification-engine.shared.ts can import it without any
// import cycle. Unknown package keys FAIL CLOSED (no email, no custom
// recipients).

export interface NotificationCaps {
  /** May this package send notification EMAILS at all? (in-app is always allowed) */
  emailAllowed: boolean;
  /** May admins add custom (non-member) email recipients? */
  customRecipientsAllowed: boolean;
}

const NOTIFICATION_CAPS_BY_PACKAGE: Record<string, NotificationCaps> = {
  trial: { emailAllowed: false, customRecipientsAllowed: false },
  none: { emailAllowed: false, customRecipientsAllowed: false },
  receptionist_lite: { emailAllowed: true, customRecipientsAllowed: false },
  receptionist_pro: { emailAllowed: true, customRecipientsAllowed: true },
  executive_suite: { emailAllowed: true, customRecipientsAllowed: true },
  business_command: { emailAllowed: true, customRecipientsAllowed: true },
  enterprise: { emailAllowed: true, customRecipientsAllowed: true },
  legacy_full: { emailAllowed: true, customRecipientsAllowed: true },
};

/** Fail-closed lookup: unknown packages get no email + no custom recipients. */
export function notificationCapsForPackage(packageKey: string | null | undefined): NotificationCaps {
  return NOTIFICATION_CAPS_BY_PACKAGE[packageKey ?? ""] ?? { emailAllowed: false, customRecipientsAllowed: false };
}

export interface NotificationEventDefault {
  enabled?: boolean;
  emailEnabled?: boolean;
  inAppEnabled?: boolean;
  frequency?: "immediate" | "hourly" | "daily" | "weekly";
}

/** Critical operational events every package should surface by default. */
const CRITICAL_DEFAULT_EVENTS = [
  "failed",
  "provider_error",
  "workflow_error",
  "safety_cap_hit",
  "email_provider_failing",
  "needs_admin_attention",
] as const;

/**
 * Per-package default notification settings, applied ONCE at provisioning /
 * package assignment (never overwrites rows an admin already customised).
 * Only events listed here get a seeded row; everything else uses the
 * engine's DEFAULT_EVENT_SETTINGS at read time.
 */
export function notificationDefaultsForPackage(
  packageKey: string | null | undefined,
): Record<string, NotificationEventDefault> {
  const caps = notificationCapsForPackage(packageKey);
  const out: Record<string, NotificationEventDefault> = {};
  for (const ev of CRITICAL_DEFAULT_EVENTS) {
    out[ev] = {
      enabled: true,
      inAppEnabled: true,
      emailEnabled: caps.emailAllowed,
      frequency: "immediate",
    };
  }
  // Growth-oriented digests for packages that can email.
  if (caps.emailAllowed) {
    out["qualified_leads_generated"] = { enabled: true, inAppEnabled: true, emailEnabled: true, frequency: "daily" };
    out["appointments_booked"] = { enabled: true, inAppEnabled: true, emailEnabled: true, frequency: "daily" };
  }
  return out;
}

// ── Effective entitlement shape ──────────────────────────────────────────────

export interface WorkspaceEntitlements {
  packageKey: string;
  packageName: string;
  subscriptionStatus: "trial" | "active" | "past_due" | "cancelled" | "suspended" | "none";
  features: Record<string, boolean>;
  limits: PackageLimits;
  aiDepartments: string[];
  /** included + active extra_staff_user addon quantity */
  staffSeatAllowance: number;
  pageAccessCaps: Record<PageKey, PageLevel>;
  actionCaps: Record<ActionKey, boolean>;
}

/** Pure: build entitlements from a package def + addon quantities + overrides. */
export function buildEntitlements(
  pkg: PackageDef,
  opts: {
    subscriptionStatus?: WorkspaceEntitlements["subscriptionStatus"];
    extraStaffSeats?: number;
    /** feature_key → enabled from workspace_feature_entitlements (addon/admin_override rows). */
    featureOverrides?: Record<string, boolean>;
  } = {},
): WorkspaceEntitlements {
  const features: Record<string, boolean> = {};
  for (const k of FEATURE_KEYS) features[k] = pkg.features.includes(k);
  for (const [k, v] of Object.entries(opts.featureOverrides ?? {})) {
    if ((FEATURE_KEYS as readonly string[]).includes(k)) features[k] = v === true;
  }

  const pageAccessCaps = {} as Record<PageKey, PageLevel>;
  for (const p of PAGE_KEYS) {
    const explicit = pkg.pageAccessCaps?.[p];
    if (explicit) { pageAccessCaps[p] = explicit; continue; }
    pageAccessCaps[p] = features[PAGE_FEATURE_MAP[p]] ? "manage" : "hidden";
  }

  const actionCaps = {} as Record<ActionKey, boolean>;
  for (const a of Object.keys(ACTION_FEATURE_MAP) as ActionKey[]) {
    const explicit = pkg.actionCaps?.[a];
    actionCaps[a] = explicit ?? features[ACTION_FEATURE_MAP[a]] === true;
  }

  return {
    packageKey: pkg.packageKey,
    packageName: pkg.packageName,
    subscriptionStatus: opts.subscriptionStatus ?? "none",
    features,
    limits: pkg.limits,
    aiDepartments: [...pkg.aiDepartments],
    staffSeatAllowance: pkg.limits.includedStaffUsers + Math.max(opts.extraStaffSeats ?? 0, 0),
    pageAccessCaps,
    actionCaps,
  };
}

/** Fully-locked entitlements — the fail-closed fallback for resolution ERRORS. */
export function noEntitlements(): WorkspaceEntitlements {
  const features: Record<string, boolean> = {};
  for (const k of FEATURE_KEYS) features[k] = false;
  const pageAccessCaps = {} as Record<PageKey, PageLevel>;
  for (const p of PAGE_KEYS) pageAccessCaps[p] = "hidden";
  // Safety valve (spec §18): owners/admins may still reach settings/team access
  // and billing so they can fix a broken subscription — enforced by callers via
  // role, but the caps must allow it.
  pageAccessCaps.settings = "manage";
  pageAccessCaps.team_access = "manage";
  pageAccessCaps.billing = "manage";
  pageAccessCaps.dashboard = "view";
  const actionCaps = {} as Record<ActionKey, boolean>;
  for (const a of Object.keys(ACTION_FEATURE_MAP) as ActionKey[]) actionCaps[a] = false;
  actionCaps.billing = true;
  actionCaps.user_management = true;
  return {
    packageKey: "none",
    packageName: "Unavailable",
    subscriptionStatus: "none",
    features,
    limits: {
      includedVoiceMinutes: 0,
      includedStaffUsers: 1,
      maxAgents: 0,
      maxWorkflows: 0,
      maxCampaigns: 0,
      maxCustomViews: 0,
      maxPageFilters: 0,
      maxCampaignFilters: 0,
      maxChildAccounts: 0,
    },
    aiDepartments: [],
    staffSeatAllowance: 1,
    pageAccessCaps,
    actionCaps,
  };
}

/** min(role level, package cap) */
export function capPageLevel(roleLevel: PageLevel, cap: PageLevel): PageLevel {
  return pageLevelRank(roleLevel) <= pageLevelRank(cap) ? roleLevel : cap;
}
