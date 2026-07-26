/**
 * Social, content & ads channel packets — shared (client-safe) pure helpers.
 *
 * Task #489: Meta/Facebook/Instagram, TikTok, LinkedIn, Content Studio
 * cross-channel deployment and Google Ads/SEO instructions must produce
 * evidence-backed intelligence packets with split, scoped approvals —
 * mirroring the Task #488 comms foundation (channel-packets.shared.ts).
 *
 * Everything here is pure and deterministic (no DB, no secrets) so the
 * component test suite can exercise budget validation, creative/destination
 * completeness, audio-rights gating, adaptation checking and deployment
 * state transitions directly. The server module
 * (hivemind/social-work-orders.server.ts) feeds these helpers with real rows.
 */

import type { ApprovalScopeKind } from "./intelligence-packet.shared";

// ── Campaign kinds & split approval ladders ──────────────────────────────────
export interface SocialApprovalStage {
  key: string;
  label: string;
  kind: ApprovalScopeKind;
  /** True for the final Launch/Publish stage — blocked until prior approvals. */
  finalSend: boolean;
}

export type SocialCampaignKind =
  | "meta"
  | "tiktok_organic"
  | "tiktok_ads"
  | "linkedin_organic"
  | "linkedin_ads"
  | "content_deployment"
  | "gads"
  | "seo";

/**
 * Split approval ladder per social/content/ads kind (spec sections 8–11, 15):
 * approving creative never authorises launching; the final Launch/Publish
 * stage is created BLOCKED and only becomes actionable once every earlier
 * stage is approved and provider checks pass.
 */
export function approvalStagesForSocialKind(kind: SocialCampaignKind): SocialApprovalStage[] {
  switch (kind) {
    case "meta":
      return [
        { key: "accounts_assets",     label: "Accounts & Assets",     kind: "change",    finalSend: false },
        { key: "audience_placement",  label: "Audience & Placement",  kind: "change",    finalSend: false },
        { key: "creative_destination",label: "Creative & Destination",kind: "content",   finalSend: false },
        { key: "budget_schedule",     label: "Budget & Schedule",     kind: "change",    finalSend: false },
        { key: "launch",              label: "Launch",                kind: "execution", finalSend: true },
      ];
    case "tiktok_organic":
      return [
        { key: "concept_script", label: "Concept & Script", kind: "content",     finalSend: false },
        { key: "audio_rights",   label: "Audio Rights",     kind: "change",      finalSend: false },
        { key: "publish",        label: "Publish",          kind: "publication", finalSend: true },
      ];
    case "tiktok_ads":
      return [
        { key: "concept_script",  label: "Concept & Script", kind: "content",   finalSend: false },
        { key: "audio_rights",    label: "Audio Rights",     kind: "change",    finalSend: false },
        { key: "audience_budget", label: "Audience & Budget",kind: "change",    finalSend: false },
        { key: "launch",          label: "Launch",           kind: "execution", finalSend: true },
      ];
    case "linkedin_organic":
      return [
        { key: "entity_resolution", label: "Entity Resolution", kind: "change",      finalSend: false },
        { key: "creative",          label: "Creative",          kind: "content",     finalSend: false },
        { key: "publish",           label: "Publish",           kind: "publication", finalSend: true },
      ];
    case "linkedin_ads":
      return [
        { key: "entity_resolution", label: "Entity Resolution",     kind: "change",    finalSend: false },
        { key: "audience",          label: "Audience",              kind: "change",    finalSend: false },
        { key: "creative_leadgen",  label: "Creative & Lead-Gen",   kind: "content",   finalSend: false },
        { key: "budget_schedule",   label: "Budget & Schedule",     kind: "change",    finalSend: false },
        { key: "launch",            label: "Launch",                kind: "execution", finalSend: true },
      ];
    case "content_deployment":
      return [
        { key: "variant_plan", label: "Variant Plan",        kind: "content",     finalSend: false },
        { key: "publish",      label: "Publish",             kind: "publication", finalSend: true },
      ];
    case "gads":
      return [
        { key: "analysis",        label: "Analysis",        kind: "analysis", finalSend: false },
        { key: "change_requests", label: "Change Requests", kind: "change",   finalSend: true },
      ];
    case "seo":
      return [
        { key: "strategy",   label: "Strategy",   kind: "analysis",    finalSend: false },
        { key: "brief",      label: "Brief",      kind: "content",     finalSend: false },
        { key: "content",    label: "Content",    kind: "content",     finalSend: false },
        { key: "deployment", label: "Deployment", kind: "publication", finalSend: true },
      ];
  }
}

// ── Launch modes (Meta split final approval) ─────────────────────────────────
export type LaunchMode = "create_paused" | "launch_live";

export const LAUNCH_MODE_LABELS: Record<LaunchMode, string> = {
  create_paused: "Approve and Create as Paused",
  launch_live:   "Approve and Launch",
};

// ── Budget validation ────────────────────────────────────────────────────────
export interface BudgetValidationResult {
  ok: boolean;
  problems: string[];
}

/**
 * Hard budget gate for paid campaigns: a null/missing/zero/negative or
 * non-finite budget can NEVER reach launch approval.
 */
export function validateCampaignBudget(
  budget: { amount?: number | null; currency?: string | null; period?: "daily" | "lifetime" | null } | null | undefined,
): BudgetValidationResult {
  const problems: string[] = [];
  if (!budget || budget.amount == null) {
    problems.push("Budget is missing — a paid campaign cannot be launched without an explicit budget.");
    return { ok: false, problems };
  }
  const amt = Number(budget.amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    problems.push(`Budget amount ${String(budget.amount)} is not a positive number.`);
  }
  if (!budget.currency) problems.push("Budget currency is missing.");
  if (!budget.period) problems.push("Budget period (daily/lifetime) is missing.");
  return { ok: problems.length === 0, problems };
}

// ── Meta creative/destination completeness ───────────────────────────────────
export interface MetaCampaignSpecInput {
  objective?: string | null;
  pageId?: string | null;
  igAccountId?: string | null;
  adAccountId?: string | null;
  pixelId?: string | null;
  audienceDescription?: string | null;
  placements?: string[] | null;
  creative?: { mediaUrl?: string | null; caption?: string | null; format?: string | null } | null;
  destinationUrl?: string | null;
  conversionEvent?: string | null;
  budget?: { amount?: number | null; currency?: string | null; period?: "daily" | "lifetime" | null } | null;
  schedule?: { startAt?: string | null; endAt?: string | null } | null;
}

export interface MetaSpecCheckResult {
  complete: boolean;
  missing: string[];
  /** Items that hard-block the Launch stage (budget/creative/destination). */
  launchBlockers: string[];
}

/**
 * Deterministic completeness check for a Meta paid-campaign proposal.
 * Missing budget, creative or destination are LAUNCH BLOCKERS — the Launch
 * stage must carry them as hard blockers so it can never be approved.
 */
export function checkMetaCampaignSpec(spec: MetaCampaignSpecInput): MetaSpecCheckResult {
  const missing: string[] = [];
  const launchBlockers: string[] = [];
  if (!spec.objective) missing.push("campaign objective");
  if (!spec.adAccountId) missing.push("ad account");
  if (!spec.pageId) missing.push("Facebook page");
  if (!spec.audienceDescription) missing.push("audience definition");
  if (!spec.placements?.length) missing.push("placements");
  if (!spec.conversionEvent) missing.push("conversion event");
  if (!spec.pixelId) missing.push("pixel");
  if (!spec.schedule?.startAt) missing.push("schedule start");

  const budget = validateCampaignBudget(spec.budget);
  if (!budget.ok) launchBlockers.push(...budget.problems);
  if (!spec.creative?.mediaUrl && !spec.creative?.caption) {
    launchBlockers.push("Creative is missing (no media and no copy) — nothing exists to launch.");
  }
  if (!spec.destinationUrl) {
    launchBlockers.push("Destination URL is missing — the ad has nowhere to send people.");
  }
  return { complete: missing.length === 0 && launchBlockers.length === 0, missing, launchBlockers };
}

// ── TikTok proposal completeness & audio rights ──────────────────────────────
export type AudioRightsStatus = "verified_rights" | "original_audio" | "unverified" | "copyrighted_no_rights";

export interface TikTokProposalInput {
  concept?: string | null;
  hook?: string | null;
  script?: string | null;
  shotList?: string[] | null;
  caption?: string | null;
  cta?: string | null;
  durationSeconds?: number | null;
  safeZonesChecked?: boolean | null;
  audioTitle?: string | null;
  audioRightsStatus?: AudioRightsStatus | null;
  // ads-only
  isAd?: boolean;
  audienceDescription?: string | null;
  optimisationGoal?: string | null;
  trackingSetup?: string | null;
  budget?: { amount?: number | null; currency?: string | null; period?: "daily" | "lifetime" | null } | null;
}

export interface TikTokCheckResult {
  complete: boolean;
  missing: string[];
  /** Hard blockers — copyrighted/unverified audio, missing ad budget. */
  publishBlockers: string[];
}

/**
 * TikTok proposal gate: concept/hook/script/shot list/caption/CTA/duration/
 * safe zones + audio-rights status are required. NO copyrighted audio without
 * verified rights — unverified or rights-missing audio hard-blocks publish.
 */
export function checkTikTokProposal(p: TikTokProposalInput): TikTokCheckResult {
  const missing: string[] = [];
  const publishBlockers: string[] = [];
  if (!p.concept) missing.push("concept");
  if (!p.hook) missing.push("hook");
  if (!p.script) missing.push("script");
  if (!p.shotList?.length) missing.push("shot list");
  if (!p.caption) missing.push("caption");
  if (!p.cta) missing.push("CTA");
  if (!p.durationSeconds || p.durationSeconds <= 0) missing.push("duration");
  if (p.safeZonesChecked !== true) missing.push("safe-zone check");

  const rights = p.audioRightsStatus ?? "unverified";
  if (rights === "copyrighted_no_rights") {
    publishBlockers.push(`Audio "${p.audioTitle ?? "unknown"}" is copyrighted without verified rights — publication is blocked.`);
  } else if (rights === "unverified") {
    publishBlockers.push(`Audio rights are unverified${p.audioTitle ? ` for "${p.audioTitle}"` : ""} — verify rights (or use original audio) before publish.`);
  }
  if (p.isAd) {
    if (!p.audienceDescription) missing.push("ad audience");
    if (!p.optimisationGoal) missing.push("optimisation goal");
    if (!p.trackingSetup) missing.push("tracking setup");
    const budget = validateCampaignBudget(p.budget);
    if (!budget.ok) publishBlockers.push(...budget.problems);
  }
  return { complete: missing.length === 0 && publishBlockers.length === 0, missing, publishBlockers };
}

// ── LinkedIn proposal completeness ───────────────────────────────────────────
export interface LinkedInProposalInput {
  entityType?: "organization" | "profile" | null;
  entityName?: string | null;
  creative?: { headline?: string | null; body?: string | null; mediaUrl?: string | null } | null;
  // ads-only
  isAd?: boolean;
  campaignManagerAccount?: string | null;
  audienceFacets?: string[] | null;
  leadGenForm?: { name?: string | null; fields?: string[] | null } | null;
  budget?: { amount?: number | null; currency?: string | null; period?: "daily" | "lifetime" | null } | null;
}

export interface LinkedInCheckResult {
  complete: boolean;
  missing: string[];
  launchBlockers: string[];
}

export function checkLinkedInProposal(p: LinkedInProposalInput): LinkedInCheckResult {
  const missing: string[] = [];
  const launchBlockers: string[] = [];
  if (!p.entityType || !p.entityName) missing.push("organisation/profile resolution");
  if (!p.creative?.headline && !p.creative?.body) missing.push("creative (headline/body)");
  if (p.isAd) {
    if (!p.campaignManagerAccount) missing.push("Campaign Manager account");
    if (!p.audienceFacets?.length) missing.push("audience facets");
    const budget = validateCampaignBudget(p.budget);
    if (!budget.ok) launchBlockers.push(...budget.problems);
  }
  return { complete: missing.length === 0 && launchBlockers.length === 0, missing, launchBlockers };
}

// ── Content Studio channel variants ─────────────────────────────────────────
export const CONTENT_VARIANT_CHANNELS = [
  "blog",
  "meta_ad",
  "fb_post",
  "ig_post",
  "ig_story",
  "ig_reel",
  "tiktok",
  "linkedin_post",
  "linkedin_ad",
  "whatsapp",
  "email",
  "sms",
  "landing",
] as const;
export type ContentVariantChannel = (typeof CONTENT_VARIANT_CHANNELS)[number];

export interface VariantChannelRule {
  label: string;
  maxChars: number | null;
  format: string;
  ratio: string | null;
  /** Whether WEBEE has an API publish path (Meta family only today). */
  apiPublish: boolean;
}

/** Per-channel constraints — length/format/ratio guidance + honest API support. */
export const VARIANT_CHANNEL_RULES: Record<ContentVariantChannel, VariantChannelRule> = {
  blog:          { label: "Blog article",     maxChars: null, format: "long-form article with headings",         ratio: null,    apiPublish: false },
  meta_ad:       { label: "Meta ad",          maxChars: 300,  format: "primary text + headline + CTA",           ratio: "1:1 or 4:5", apiPublish: false },
  fb_post:       { label: "Facebook post",    maxChars: 2200, format: "post copy + optional media",              ratio: "1.91:1 or 1:1", apiPublish: true },
  ig_post:       { label: "Instagram post",   maxChars: 2200, format: "caption + image/carousel",                ratio: "1:1 or 4:5", apiPublish: true },
  ig_story:      { label: "Instagram story",  maxChars: 250,  format: "vertical story frame + sticker CTA",      ratio: "9:16",  apiPublish: false },
  ig_reel:       { label: "Instagram reel",   maxChars: 2200, format: "vertical video + caption + hook",         ratio: "9:16",  apiPublish: true },
  tiktok:        { label: "TikTok video",     maxChars: 2200, format: "vertical video: hook, script, shot list", ratio: "9:16",  apiPublish: false },
  linkedin_post: { label: "LinkedIn post",    maxChars: 3000, format: "professional-tone post copy",             ratio: "1.91:1", apiPublish: false },
  linkedin_ad:   { label: "LinkedIn ad",      maxChars: 600,  format: "intro text + headline + CTA",             ratio: "1.91:1", apiPublish: false },
  whatsapp:      { label: "WhatsApp message", maxChars: 1024, format: "approved template message",               ratio: null,    apiPublish: false },
  email:         { label: "Email",            maxChars: null, format: "subject + preheader + body + CTA",        ratio: null,    apiPublish: false },
  sms:           { label: "SMS",              maxChars: 320,  format: "short message + link",                    ratio: null,    apiPublish: false },
  landing:       { label: "Landing copy",     maxChars: null, format: "hero headline + sections + CTA",          ratio: null,    apiPublish: false },
};

export interface VariantAdaptationInput {
  channel: ContentVariantChannel;
  masterCopy: string;
  variantCopy: string;
}

export interface VariantAdaptationResult {
  ok: boolean;
  problems: string[];
}

const squash = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Adaptation gate: a channel variant must be genuinely ADAPTED, not identical
 * text. Rules (deterministic):
 *  - non-empty copy;
 *  - not byte-identical to the master after whitespace/case normalisation;
 *  - respects the channel max length where one exists.
 */
export function checkVariantAdaptation(input: VariantAdaptationInput): VariantAdaptationResult {
  const problems: string[] = [];
  const rule = VARIANT_CHANNEL_RULES[input.channel];
  const variant = (input.variantCopy ?? "").trim();
  if (!variant) {
    problems.push(`${rule.label}: variant copy is empty.`);
    return { ok: false, problems };
  }
  if (squash(variant) === squash(input.masterCopy ?? "")) {
    problems.push(`${rule.label}: variant copy is identical to the master content — adapt length/hook/tone/format/CTA for the channel.`);
  }
  if (rule.maxChars != null && variant.length > rule.maxChars) {
    problems.push(`${rule.label}: copy is ${variant.length} characters — channel limit is ${rule.maxChars}.`);
  }
  return { ok: problems.length === 0, problems };
}

// ── Variant deployment state machine ─────────────────────────────────────────
export const VARIANT_DEPLOYMENT_STATES = [
  "draft",
  "awaiting_channel_approval",
  "approved",
  "publishing",
  "published",
  "verification_failed",
  "monitoring",
  "awaiting_manual_publication",
  "blocked",
] as const;
export type VariantDeploymentState = (typeof VARIANT_DEPLOYMENT_STATES)[number];

const VARIANT_TRANSITIONS: Record<VariantDeploymentState, VariantDeploymentState[]> = {
  draft:                        ["awaiting_channel_approval", "blocked"],
  awaiting_channel_approval:    ["approved", "draft", "blocked"],
  approved:                     ["publishing", "awaiting_manual_publication", "draft", "blocked"],
  publishing:                   ["published", "verification_failed", "blocked"],
  published:                    ["monitoring", "verification_failed"],
  verification_failed:          ["publishing", "draft", "blocked"],
  monitoring:                   ["verification_failed"],
  awaiting_manual_publication:  ["published", "draft", "blocked"],
  blocked:                      ["draft"],
};

export function isValidVariantTransition(
  from: VariantDeploymentState,
  to: VariantDeploymentState,
): boolean {
  return (VARIANT_TRANSITIONS[from] ?? []).includes(to);
}

/**
 * Honest deployment path for a channel: API-publishable channels go through
 * publishing → published (only after a verified provider record); everything
 * else goes to awaiting_manual_publication — never a fabricated "published".
 */
export function deploymentPathForChannel(channel: ContentVariantChannel): "api" | "manual" {
  return VARIANT_CHANNEL_RULES[channel].apiPublish ? "api" : "manual";
}
