// ── GrowthMind content project approval — shared (client-safe) ───────────────
// Project status state machine + configurable approval rules. No secrets,
// no server imports. Rule evaluation is deterministic so server and UI agree.

export const CONTENT_PROJECT_STATUSES = [
  "in_production",
  "awaiting_assets",
  "awaiting_approval",
  "changes_requested",
  "approved",
  "scheduled",
  "publishing",
  "published",
  "failed",
  "archived",
] as const;
export type ContentProjectStatus = (typeof CONTENT_PROJECT_STATUSES)[number];

/** Allowed transitions — every project status write must pass through this map. */
export const PROJECT_TRANSITIONS: Record<ContentProjectStatus, ContentProjectStatus[]> = {
  in_production:      ["awaiting_assets", "awaiting_approval", "archived"],
  awaiting_assets:    ["in_production", "awaiting_approval", "archived"],
  awaiting_approval:  ["approved", "changes_requested", "in_production", "archived"],
  changes_requested:  ["in_production", "awaiting_approval", "archived"],
  approved:           ["scheduled", "publishing", "in_production", "archived"],
  scheduled:          ["publishing", "approved", "in_production", "archived"],
  publishing:         ["published", "failed", "scheduled"],
  published:          ["archived"],
  failed:             ["approved", "scheduled", "in_production", "archived"],
  archived:           [],
};

export function canTransition(from: string, to: string): boolean {
  const allowed = PROJECT_TRANSITIONS[from as ContentProjectStatus];
  return Array.isArray(allowed) && allowed.includes(to as ContentProjectStatus);
}

// ── Approval rules ────────────────────────────────────────────────────────────
// Stored per-workspace in workspaces.settings.growthmind_approval_rules
// (partial override of the defaults below). A triggered rule FORCES explicit
// human approval regardless of autonomy mode.

export interface ApprovalRuleConfig {
  /** Master switch — when true, EVERY publish requires explicit approval. */
  always_require_approval: boolean;
  /** Content containing product/health/income claims requires approval. */
  claims_require_approval: boolean;
  /** Content mentioning prices, discounts or offers requires approval. */
  pricing_require_approval: boolean;
  /** AI-generated spokesperson/voice/media requires approval. */
  ai_media_require_approval: boolean;
  /** Extra words/phrases that force approval when present (case-insensitive). */
  restricted_terms: string[];
}

export const DEFAULT_APPROVAL_RULES: ApprovalRuleConfig = {
  always_require_approval:   true, // safe default — publishing is external
  claims_require_approval:   true,
  pricing_require_approval:  true,
  ai_media_require_approval: true,
  restricted_terms:          [],
};

export function normalizeApprovalRules(raw: unknown): ApprovalRuleConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    always_require_approval:   r.always_require_approval   !== false,
    claims_require_approval:   r.claims_require_approval   !== false,
    pricing_require_approval:  r.pricing_require_approval  !== false,
    ai_media_require_approval: r.ai_media_require_approval !== false,
    restricted_terms: Array.isArray(r.restricted_terms)
      ? r.restricted_terms.filter((t): t is string => typeof t === "string" && t.trim().length > 0).slice(0, 50)
      : [],
  };
}

const CLAIM_PATTERN =
  /\b(guarantee[ds]?|cure[sd]?|clinically proven|scientifically proven|100% (safe|effective|success)|risk[- ]free|no\.?\s?1\b|best in (the )?(uk|world|market)|earn (up to )?[£$€]|double your|lose \d+ ?(lbs|kg|pounds))\b/i;
const PRICING_PATTERN =
  /([£$€]\s?\d)|(\d+\s?% *off)|\b(discount|sale price|free trial|money[- ]back|cheapest|lowest price|from only)\b/i;

export interface ApprovalEvaluation {
  requiresApproval: boolean;
  flags: string[]; // e.g. ["always_require_approval","claims","pricing","ai_media","restricted_term:xyz"]
}

/** Deterministic rule evaluation over the project's publishable text + media labels. */
export function evaluateApprovalRules(
  rules: ApprovalRuleConfig,
  project: {
    caption?: string | null; script?: string | null; voiceover_script?: string | null;
    subtitles?: string | null; cta?: string | null; thumbnail_text?: string | null;
    media_is_ai?: boolean | null; voiceover_is_ai?: boolean | null;
  },
): ApprovalEvaluation {
  const flags: string[] = [];
  const text = [project.caption, project.script, project.voiceover_script, project.subtitles, project.cta, project.thumbnail_text]
    .filter(Boolean).join("\n");

  if (rules.always_require_approval) flags.push("always_require_approval");
  if (rules.claims_require_approval && CLAIM_PATTERN.test(text)) flags.push("claims");
  if (rules.pricing_require_approval && PRICING_PATTERN.test(text)) flags.push("pricing");
  if (rules.ai_media_require_approval && (project.media_is_ai === true || project.voiceover_is_ai === true)) flags.push("ai_media");
  for (const term of rules.restricted_terms) {
    if (text.toLowerCase().includes(term.toLowerCase())) flags.push(`restricted_term:${term}`);
  }
  return { requiresApproval: flags.length > 0, flags };
}

/** Human labels for approval flags (UI). */
export function approvalFlagLabel(flag: string): string {
  if (flag === "always_require_approval") return "All publishes require approval (workspace rule)";
  if (flag === "claims")   return "Contains marketing claims";
  if (flag === "pricing")  return "Mentions pricing / offers";
  if (flag === "ai_media") return "Uses AI-generated media or voice";
  if (flag.startsWith("restricted_term:")) return `Restricted term: "${flag.slice("restricted_term:".length)}"`;
  return flag;
}
