// Marketing Action Engine — client-safe shared types & constants.
// The engine itself (writes, guardrail enforcement, executor registry) lives
// in action-engine.server.ts and only ever runs server-side.

// ── Lifecycle ────────────────────────────────────────────────────────────────
export const MARKETING_ACTION_STATUSES = [
  "discovered", "recommended", "awaiting_approval", "approved", "executing",
  "executed", "verified", "measuring", "success", "failed", "rolled_back",
] as const;
export type MarketingActionStatus = (typeof MARKETING_ACTION_STATUSES)[number];

/** Legal state transitions. Anything not listed is rejected server-side. */
export const MARKETING_ACTION_TRANSITIONS: Record<MarketingActionStatus, MarketingActionStatus[]> = {
  discovered:        ["recommended", "failed"],
  recommended:       ["awaiting_approval", "approved", "failed"],
  awaiting_approval: ["approved", "failed"],
  approved:          ["executing", "awaiting_approval", "failed"],
  executing:         ["executed", "failed"],
  executed:          ["verified", "failed", "rolled_back"],
  verified:          ["measuring", "success", "rolled_back", "failed"],
  measuring:         ["success", "failed", "rolled_back"],
  success:           ["rolled_back"],
  failed:            [],
  rolled_back:       [],
};

export const TERMINAL_MARKETING_STATUSES: MarketingActionStatus[] = ["failed", "rolled_back"];

/** Statuses from which an Undo (compensating action) may be requested. */
// "executed" included: the external write was API-confirmed even if read-back
// verification failed, so a compensating undo must remain available.
export const UNDOABLE_MARKETING_STATUSES: MarketingActionStatus[] = ["executed", "verified", "measuring", "success"];

// ── Risk ─────────────────────────────────────────────────────────────────────
export type MarketingRiskLevel = "low" | "medium" | "high";

/**
 * Action types that are ALWAYS high-risk and therefore always require
 * explicit human approval, regardless of autonomy level or guardrails.
 */
export const HIGH_RISK_MARKETING_ACTION_TYPES = new Set<string>([
  "campaign_delete",
  "ad_group_delete",
  "keyword_group_delete",
  "targeting_change_large",
  "seo_domain_wide_change",
  "page_mass_generation",
  "tracking_removal",
  "attribution_change",
]);

// ── Autonomy levels ──────────────────────────────────────────────────────────
export const MARKETING_AUTONOMY_LEVELS = ["observe", "recommend", "approval", "autopilot"] as const;
export type MarketingAutonomyLevel = (typeof MARKETING_AUTONOMY_LEVELS)[number];

export const MARKETING_AUTONOMY_META: Record<MarketingAutonomyLevel, { label: string; desc: string }> = {
  observe:   { label: "Observe",            desc: "Analyse and report only — no actions are proposed or executed." },
  recommend: { label: "Recommend",          desc: "Recommendations are created but nothing is ever executed." },
  approval:  { label: "Execute w/ Approval", desc: "Every change is queued for your approval before it runs." },
  autopilot: { label: "Autopilot",           desc: "Low-risk changes within your guardrails run automatically. High-risk changes always wait for approval." },
};

// ── Guardrails ───────────────────────────────────────────────────────────────
export interface MarketingGuardrails {
  /**
   * PER-ACTION ceiling: no single automated change may set a daily budget
   * above this (GBP). This is NOT an aggregate daily-spend ledger — several
   * compliant changes can together exceed it. Aggregate spend enforcement
   * arrives with the ads executor. null = no cap set.
   */
  max_daily_ad_spend: number | null;
  /** Max % a budget may be automatically increased in one action. */
  max_auto_budget_increase_pct: number;
  /** Max % a budget may be automatically decreased in one action. */
  max_auto_budget_decrease_pct: number;
  /** Max automated (non-approved) actions per calendar day. */
  max_auto_actions_per_day: number;
  /** Campaign names/ids that must never be auto-changed. */
  protected_campaigns: string[];
  /** Keywords that must never be auto-changed. */
  protected_keywords: string[];
  /** Page paths/URLs that must never be auto-changed. */
  protected_pages: string[];
}

export const DEFAULT_MARKETING_GUARDRAILS: MarketingGuardrails = {
  max_daily_ad_spend: null,
  max_auto_budget_increase_pct: 20,
  max_auto_budget_decrease_pct: 50,
  max_auto_actions_per_day: 10,
  protected_campaigns: [],
  protected_keywords: [],
  protected_pages: [],
};

export function normalizeGuardrails(raw: unknown): MarketingGuardrails {
  const g = (raw && typeof raw === "object" ? raw : {}) as Partial<MarketingGuardrails>;
  const num = (v: unknown, def: number, min: number, max: number) => {
    const n = typeof v === "number" && Number.isFinite(v) ? v : def;
    return Math.min(max, Math.max(min, n));
  };
  const strList = (v: unknown) =>
    Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && s.trim().length > 0).slice(0, 200) : [];
  return {
    max_daily_ad_spend:
      typeof g.max_daily_ad_spend === "number" && Number.isFinite(g.max_daily_ad_spend) && g.max_daily_ad_spend > 0
        ? Math.min(1_000_000, g.max_daily_ad_spend) : null,
    max_auto_budget_increase_pct: num(g.max_auto_budget_increase_pct, DEFAULT_MARKETING_GUARDRAILS.max_auto_budget_increase_pct, 0, 100),
    max_auto_budget_decrease_pct: num(g.max_auto_budget_decrease_pct, DEFAULT_MARKETING_GUARDRAILS.max_auto_budget_decrease_pct, 0, 100),
    max_auto_actions_per_day:     num(g.max_auto_actions_per_day, DEFAULT_MARKETING_GUARDRAILS.max_auto_actions_per_day, 0, 500),
    protected_campaigns: strList(g.protected_campaigns),
    protected_keywords:  strList(g.protected_keywords),
    protected_pages:     strList(g.protected_pages),
  };
}

// ── Record shape (client view) ───────────────────────────────────────────────
export interface MarketingActionRecord {
  id: string;
  workspace_id: string;
  source: string;
  requested_by: string | null;
  objective: string | null;
  platform: string;
  action_type: string;
  target: Record<string, any>;
  existing_value: any;
  proposed_value: any;
  expected_impact: string | null;
  confidence: number | null;
  risk_level: MarketingRiskLevel;
  approval_required: boolean;
  approval_action_id: string | null;
  status: MarketingActionStatus;
  execution_attempts: number;
  external_resource_id: string | null;
  api_response: any;
  verification_status: string | null;
  verification_evidence: any;
  rollback_payload: any;
  rollback_of: string | null;
  evidence: Record<string, any>;
  error_message: string | null;
  status_history: Array<{ from: string | null; to: string; at: string; note?: string }>;
  created_at: string;
  updated_at: string;
  executed_at: string | null;
  verified_at: string | null;
  measured_at: string | null;
}

export const MARKETING_STATUS_META: Record<MarketingActionStatus, { label: string; tone: "muted" | "info" | "warn" | "active" | "good" | "bad" }> = {
  discovered:        { label: "Discovered",        tone: "muted" },
  recommended:       { label: "Recommended",       tone: "info" },
  awaiting_approval: { label: "Awaiting approval", tone: "warn" },
  approved:          { label: "Approved",          tone: "info" },
  executing:         { label: "Executing",         tone: "active" },
  executed:          { label: "Executed",          tone: "active" },
  verified:          { label: "Verified",          tone: "good" },
  measuring:         { label: "Measuring",         tone: "active" },
  success:           { label: "Success",           tone: "good" },
  failed:            { label: "Failed",            tone: "bad" },
  rolled_back:       { label: "Rolled back",       tone: "muted" },
};
