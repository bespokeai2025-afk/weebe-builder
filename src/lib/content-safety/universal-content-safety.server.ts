/**
 * Universal Content Safety Gate — Task #498.
 *
 * Shared, deterministic, rule-based claim classification and safety checking
 * for ALL Mind-generated content before it reaches any approval queue.
 * No LLM call — fully auditable.
 *
 * Checks applied:
 *  1. Workspace teaching restrictions (restricted_claim / topic_to_avoid)
 *  2. Fabricated statistics (unsourced numeric percentages / ROI claims)
 *  3. Fake testimonials / invented quotation patterns
 *  4. Unsupported performance / savings guarantees
 *  5. Absolute ranking guarantees (#1 in industry / world's best)
 *  6. Embedded private data patterns (email addresses / phone numbers)
 *  7. Thin content (per content-type minimum word counts)
 *
 * Every detected factual claim is classified as one of the ClaimCategory values.
 * Gate result can be attached as a `safety_check` evidence item on an
 * intelligence packet — violations block the packet from reaching an approvable
 * readiness state.
 *
 * The Business DNA `unique_selling_points` (plus any `verified_claims` column
 * if present) form an allow-list: a stat that matches a confirmed USP is
 * treated as a verified internal fact rather than a fabricated claim.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const sb = supabaseAdmin as any;

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Claim classification categories. Every factual claim detected in generated
 * content is assigned one of these.
 */
export type ClaimCategory =
  | "verified_internal_fact"
  | "verified_external_source"
  | "approved_customer_evidence"
  | "labelled_estimate"
  | "labelled_hypothesis"
  | "labelled_hypothetical"
  | "unclassified_flagged";

export interface ClassifiedClaim {
  text: string;
  category: ClaimCategory;
  reason: string;
}

export interface SafetyCheckItem {
  check: string;
  passed: boolean;
  detail: string;
  severity: "violation" | "warning";
}

export interface SafetyCheckResult {
  passed: boolean;
  violations: string[];
  warnings: string[];
  checks: SafetyCheckItem[];
  claim_classifications: ClassifiedClaim[];
  ranAt: string;
  contentKind: string;
}

// ── Per-content-type minimum word counts ──────────────────────────────────────

const MIN_WORDS: Record<string, number> = {
  blog_article:              400,
  landing_page:              150,
  email_campaign:             60,
  follow_up_sequence:         40,
  // WhatsApp templates are often brief single-purpose messages
  whatsapp_campaign:          10,
  // Social posts range from micro-copy to substantial thought leadership
  linkedin_post:              15,
  facebook_post:              15,
  instagram_caption:           5,
  x_post:                      3,
  video_script:              100,
  vsl_script:                120,
  ai_call_script:             80,
  podcast_script:            120,
  sales_letter:              150,
  lead_magnet:               150,
  case_study:                200,
  google_ad:                   5,
  meta_ad:                     5,
  review_request_campaign:    10,
  referral_campaign:          10,
  // Video studio types (stored in growthmind_video_assets)
  meta_video_ad:              30,
  explainer_video:            60,
  tiktok_video:               20,
  youtube_ad:                 50,
};

const DEFAULT_MIN_WORDS = 20;

function minWordsFor(contentKind: string): number {
  return MIN_WORDS[contentKind] ?? DEFAULT_MIN_WORDS;
}

// ── Claim detection patterns ──────────────────────────────────────────────────

/**
 * Fabricated / unsourced statistic patterns.
 * A sentence matching any of these — without a source marker — is flagged.
 */
const FABRICATED_STAT_PATTERNS: RegExp[] = [
  /\b(\d[\d,.]*\s*%)\s+(?:roi|return|increase|growth|improvement|conversion|uplift|savings?|reduction|boost|more)\b/i,
  /\b(?:increase|boost|grow|improve|save)\w*\s+(?:by\s+)?(\d[\d,.]*\s*%)/i,
  /\b(\d+[xX])\s+(?:more|faster|cheaper|better|growth|roi|return)\b/i,
  /\b(?:customers?|clients?|users?|businesses?)\s+(?:see|get|achieve|experience|report|gain(?:ed?)?)\s+(\d[\d,.]*\s*%)/i,
  /\b(\$[\d,.]+[KMBkmb]?)\s+(?:saved?|revenue|profit|roi|return|growth|generated?)\b/i,
  /\b(?:average|typical)\s+(?:customer|client|user)\s+(?:sees?|gets?|saves?|earns?)\s+\d/i,
];

/**
 * Fake testimonial / invented quotation patterns.
 * Quoted text attributed to a person, or customer-name references.
 */
const FAKE_TESTIMONIAL_PATTERNS: RegExp[] = [
  // "Quote text" — Name or "Quote" - Name
  /["\u201C\u201D]([^"\u201C\u201D]{10,200})["\u201C\u201D]\s*[-\u2013\u2014]\s*[A-Z][a-z]/,
  // said/says/commented/shared: "quote"
  /\b(?:said|says|commented|shared|remarked|noted|told us)\s*[:,.]\s*["\u201C\u201D]/i,
  // Our customer John / Our client Jane
  /\bour\s+(?:customer|client)\s+[A-Z][a-z]+\b/,
  // Case Study: CompanyName Inc
  /\bcase\s+study\s*[:.]?\s+[A-Z][a-z]+\s+(?:Inc|Ltd|LLC|Corp|Co)\b/i,
];

/** Unsupported absolute performance / savings guarantees. */
const GUARANTEE_PATTERNS: RegExp[] = [
  /\bguaranteed?\s+(?:to|results?|success|roi|return|growth|improvement|savings?)\b/i,
  /\b100\s*%\s+(?:success|guarantee|satisfaction|accuracy|reliable|effective|certain)\b/i,
  /\bproven\s+to\s+(?:increase|boost|generate|deliver|produce|save|improve)\b/i,
  /\bnever\s+(?:fails?|misses?|loses?)\b/i,
  /\balways\s+(?:works?|delivers?|succeeds?|performs?)\b/i,
  /\bzero\s+(?:risk|failure|downtime|errors?)\b/i,
];

/** Absolute ranking claims without evidence. */
const RANKING_GUARANTEE_PATTERNS: RegExp[] = [
  // "the #1 [optional noun phrase] in/for" — allow any words between #1 and in/for
  /\bthe\s+(?:#\s*1|number\s+one)\b.{0,40}?\b(?:in|for)\s+(?:the|our|your|any)\b/i,
  // Plain "#1" or "number one" in/for
  /\b#\s*1\s+(?:in|for|choice|option)\b/i,
  /\bnumber\s+one\s+(?:in|for|choice|option|solution)\b/i,
  // "best in class/industry/market…"
  /\bbest\s+in\s+(?:class|industry|market|the\s+world|country|region|field)\b/i,
  // "world's best/leading/top…" — handles straight and curly apostrophes
  /\bworld(?:[''\u2019]s)?\s+(?:best|leading|top|finest|most\s+trusted|most\s+innovative)\b/i,
  /\bindustry[-\s]leading\b/i,
  /\bmarket[-\s]leading\b/i,
];

/** Patterns indicating the claim has a stated source — exempt from flagging. */
const SOURCED_PATTERNS: RegExp[] = [
  /\baccording\s+to\b/i,
  /\bsource(?:d)?\s*[:]\s*/i,
  /\bcited?\s+(?:from|in|by)\b/i,
  /\bpublished\s+(?:in|by)\b/i,
  /\bstudy\s+(?:from|by|published)\b/i,
  /\bdata\s+from\b/i,
  /\bour\s+(?:internal\s+)?data\s+shows?\b/i,
  /\bour\s+(?:client\s+)?results?\s+show\b/i,
  /\bbased\s+on\s+(?:our|real|actual|verified)\b/i,
  /\bfrom\s+our\s+(?:research|data|analytics|platform|records)\b/i,
];

/** Clearly labelled estimates — safe. */
const ESTIMATE_PATTERNS: RegExp[] = [
  /\b(?:approximately|approx\.?|around|roughly|about|nearly|up\s+to|as\s+(?:much|little)\s+as)\b/i,
  /\bestimate[ds]?\b/i,
  /\bproject(?:ed|ion)\b/i,
  /\btypical(?:ly)?\b/i,
  /\baverage\s+of\b/i,
  /\ben\s+average\b/i,
  /\bon\s+average\b/i,
];

/** Clearly labelled hypotheses — safe. */
const HYPOTHESIS_PATTERNS: RegExp[] = [
  /\bwe\s+(?:believe|think|expect|anticipate|suggest|recommend)\b/i,
  /\blikely\s+to\b/i,
  /\bmay\s+(?:help|improve|increase|boost|reduce|save)\b/i,
  /\bcould\s+(?:lead|result|help|improve|save|boost)\b/i,
  /\bhas\s+(?:the\s+potential|potential\s+to)\b/i,
  /\bcan\s+help\b/i,
  /\baim(?:s|ed)?\s+to\b/i,
];

/** Clearly labelled hypothetical examples — safe. */
const HYPOTHETICAL_PATTERNS: RegExp[] = [
  /\bfor\s+example\b/i,
  /\bimagine\s+if\b/i,
  /\bhypothetically\b/i,
  /\blet['s]?\s+say\b/i,
  /\bsuppose\b/i,
  /\bscenario\b/i,
  /\bif\s+you\s+were\s+to\b/i,
  /\bpicture\s+this\b/i,
];

/** PII patterns — embedded contact details in generated content. */
const PII_PATTERNS: RegExp[] = [
  /\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/,
  /\b(?:\+\d{1,3}[\s\-.]?)?\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4}\b/,
];

// ── Pure helpers (exported for tests) ────────────────────────────────────────

/** Split text into sentences for per-claim analysis. */
export function splitIntoSentences(text: string): string[] {
  return text
    .replace(/\r?\n+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 5);
}

/** True when a sentence has an explicit source citation — exempts it from fabricated-stat checks. */
export function hasSourcingContext(sentence: string): boolean {
  return SOURCED_PATTERNS.some((p) => p.test(sentence));
}

/** Classify a single factual claim sentence into a ClaimCategory. */
export function classifyClaimSentence(sentence: string): ClaimCategory {
  if (hasSourcingContext(sentence)) {
    if (/our\s+(?:internal\s+)?data|our\s+client\s+results|from\s+our\s+(?:research|data|platform|records)/i.test(sentence)) {
      return "verified_internal_fact";
    }
    return "verified_external_source";
  }
  if (HYPOTHETICAL_PATTERNS.some((p) => p.test(sentence))) return "labelled_hypothetical";
  if (ESTIMATE_PATTERNS.some((p) => p.test(sentence)))     return "labelled_estimate";
  if (HYPOTHESIS_PATTERNS.some((p) => p.test(sentence)))   return "labelled_hypothesis";
  return "unclassified_flagged";
}

/** True when a sentence closely matches a workspace-approved claim (allow-list). */
export function matchesAllowList(sentence: string, allowedClaims: string[]): boolean {
  const lower = sentence.toLowerCase();
  return allowedClaims.some((claim) => {
    const c = claim.toLowerCase().trim();
    return c.length > 5 && lower.includes(c);
  });
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function fetchWorkspaceRestrictions(workspaceId: string): Promise<Array<{ teaching_type: string; content: string }>> {
  try {
    const { data } = await sb
      .from("growthmind_seo_teachings")
      .select("teaching_type, content")
      .eq("workspace_id", workspaceId)
      .eq("status", "active")
      .in("teaching_type", ["restricted_claim", "topic_to_avoid"])
      .limit(200);
    return data ?? [];
  } catch {
    return [];
  }
}

async function fetchBusinessDnaAllowList(workspaceId: string): Promise<string[]> {
  try {
    const { data } = await sb
      .from("growthmind_business_dna")
      .select("unique_selling_points")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (!data) return [];
    const claims: string[] = [];
    if (typeof data.unique_selling_points === "string" && data.unique_selling_points.trim()) {
      claims.push(
        ...data.unique_selling_points
          .split(/[;,\n]/)
          .map((s: string) => s.trim())
          .filter((s: string) => s.length > 5),
      );
    }
    // Also check a `verified_claims` column if it exists (graceful — column may not be present yet)
    if (Array.isArray((data as any).verified_claims)) {
      claims.push(...(data as any).verified_claims.map(String).filter((s: string) => s.length > 5));
    }
    return claims;
  } catch {
    return [];
  }
}

// ── Main gate ─────────────────────────────────────────────────────────────────

/**
 * Run the universal content safety gate on `text`.
 *
 * @param text         The generated content to check (plain text or markdown).
 * @param contentKind  The content type string (e.g. "blog_article", "email_campaign").
 * @param workspaceId  Workspace context — used to load teaching restrictions
 *                     and the Business DNA allow-list.
 */
export async function runContentSafetyCheck(
  text: string,
  contentKind: string,
  workspaceId: string,
): Promise<SafetyCheckResult> {
  const checks: SafetyCheckItem[] = [];
  const claimClassifications: ClassifiedClaim[] = [];

  const addCheck = (
    check: string,
    passed: boolean,
    detail: string,
    severity: "violation" | "warning" = "violation",
  ) => checks.push({ check, passed, detail, severity });

  const sentences = splitIntoSentences(text);
  const haystack  = text.toLowerCase();

  const [restrictions, allowedClaims] = await Promise.all([
    fetchWorkspaceRestrictions(workspaceId),
    fetchBusinessDnaAllowList(workspaceId),
  ]);

  // ── 1. Workspace teaching restrictions ─────────────────────────────────────
  const violated = restrictions.filter((r) => {
    const needle = r.content
      .toLowerCase()
      .replace(/^(never|avoid|don'?t)\s+(say|claim|mention|write\s+about)\s*/i, "")
      .trim();
    return needle.length > 3 && haystack.includes(needle);
  });
  addCheck(
    "workspace_restrictions",
    violated.length === 0,
    violated.length === 0
      ? `No restricted claims/topics matched (${restrictions.length} rules checked).`
      : `Matched workspace restrictions: ${violated.map((v) => `"${v.content.slice(0, 80)}"`).join("; ")}`,
    violated.length === 0 ? "warning" : "violation",
  );

  // ── 2. Fabricated statistics ────────────────────────────────────────────────
  const fabricatedStatSentences = sentences.filter(
    (s) =>
      FABRICATED_STAT_PATTERNS.some((p) => p.test(s)) &&
      !hasSourcingContext(s) &&
      !matchesAllowList(s, allowedClaims),
  );
  for (const s of fabricatedStatSentences) {
    claimClassifications.push({
      text:     s.slice(0, 200),
      category: classifyClaimSentence(s),
      reason:   "Contains a numeric statistic without a declared source",
    });
  }
  addCheck(
    "fabricated_statistics",
    fabricatedStatSentences.length === 0,
    fabricatedStatSentences.length === 0
      ? "No unsourced statistics detected."
      : `${fabricatedStatSentences.length} sentence(s) contain unsourced statistics: ${fabricatedStatSentences
          .slice(0, 2)
          .map((s) => `"${s.slice(0, 80)}"`)
          .join("; ")}`,
    fabricatedStatSentences.length === 0 ? "warning" : "violation",
  );

  // ── 3. Fake testimonials / invented quotations ──────────────────────────────
  const testimonialSentences = sentences.filter(
    (s) =>
      FAKE_TESTIMONIAL_PATTERNS.some((p) => p.test(s)) &&
      !matchesAllowList(s, allowedClaims),
  );
  for (const s of testimonialSentences) {
    if (!claimClassifications.find((c) => c.text === s.slice(0, 200))) {
      claimClassifications.push({
        text:     s.slice(0, 200),
        category: "unclassified_flagged",
        reason:   "Possible fabricated testimonial or invented quotation",
      });
    }
  }
  addCheck(
    "fake_testimonials",
    testimonialSentences.length === 0,
    testimonialSentences.length === 0
      ? "No fabricated testimonial or invented quotation patterns detected."
      : `${testimonialSentences.length} sentence(s) match testimonial/quotation patterns: ${testimonialSentences
          .slice(0, 2)
          .map((s) => `"${s.slice(0, 80)}"`)
          .join("; ")}`,
    testimonialSentences.length === 0 ? "warning" : "violation",
  );

  // ── 4. Unsupported performance guarantees ──────────────────────────────────
  const guaranteeSentences = sentences.filter(
    (s) =>
      GUARANTEE_PATTERNS.some((p) => p.test(s)) &&
      !hasSourcingContext(s) &&
      !matchesAllowList(s, allowedClaims),
  );
  for (const s of guaranteeSentences) {
    if (!claimClassifications.find((c) => c.text === s.slice(0, 200))) {
      claimClassifications.push({
        text:     s.slice(0, 200),
        category: "unclassified_flagged",
        reason:   "Unsupported absolute performance guarantee",
      });
    }
  }
  addCheck(
    "performance_guarantees",
    guaranteeSentences.length === 0,
    guaranteeSentences.length === 0
      ? "No unsupported performance guarantees detected."
      : `${guaranteeSentences.length} sentence(s) contain unsupported guarantees: ${guaranteeSentences
          .slice(0, 2)
          .map((s) => `"${s.slice(0, 80)}"`)
          .join("; ")}`,
    guaranteeSentences.length === 0 ? "warning" : "violation",
  );

  // ── 5. Absolute ranking guarantees ─────────────────────────────────────────
  const rankingSentences = sentences.filter(
    (s) =>
      RANKING_GUARANTEE_PATTERNS.some((p) => p.test(s)) &&
      !hasSourcingContext(s) &&
      !matchesAllowList(s, allowedClaims),
  );
  for (const s of rankingSentences) {
    if (!claimClassifications.find((c) => c.text === s.slice(0, 200))) {
      claimClassifications.push({
        text:     s.slice(0, 200),
        category: "unclassified_flagged",
        reason:   "Unsupported absolute ranking claim",
      });
    }
  }
  addCheck(
    "ranking_guarantees",
    rankingSentences.length === 0,
    rankingSentences.length === 0
      ? "No unsupported absolute ranking claims detected."
      : `${rankingSentences.length} sentence(s) contain absolute ranking claims: ${rankingSentences
          .slice(0, 2)
          .map((s) => `"${s.slice(0, 80)}"`)
          .join("; ")}`,
    rankingSentences.length === 0 ? "warning" : "violation",
  );

  // ── 6. Embedded private data ────────────────────────────────────────────────
  const piiSentences = sentences.filter((s) => PII_PATTERNS.some((p) => p.test(s)));
  addCheck(
    "private_data_patterns",
    piiSentences.length === 0,
    piiSentences.length === 0
      ? "No embedded email addresses or phone numbers detected."
      : `${piiSentences.length} sentence(s) may contain embedded contact data — verify these are intentional public details.`,
    piiSentences.length === 0 ? "warning" : "violation",
  );

  // ── 7. Thin content ─────────────────────────────────────────────────────────
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const minWords  = minWordsFor(contentKind);
  addCheck(
    "content_depth",
    wordCount >= minWords,
    wordCount >= minWords
      ? `Content has ${wordCount} words (minimum ${minWords} for ${contentKind}).`
      : `Content has ${wordCount} words — below the minimum of ${minWords} for ${contentKind}.`,
    wordCount >= minWords ? "warning" : "violation",
  );

  const violations = checks.filter((c) => !c.passed && c.severity === "violation").map((c) => `${c.check}: ${c.detail}`);
  const warnings   = checks.filter((c) => !c.passed && c.severity === "warning").map((c) => `${c.check}: ${c.detail}`);

  return {
    passed: violations.length === 0,
    violations,
    warnings,
    checks,
    claim_classifications: claimClassifications,
    ranAt:       new Date().toISOString(),
    contentKind,
  };
}

// ── Intelligence packet evidence helper ──────────────────────────────────────

/**
 * Converts a SafetyCheckResult into a PacketEvidence item suitable for attaching
 * to a UniversalMindIntelligencePacket.
 *
 * When violations are present the description starts with "FAILED" — the caller
 * should add a `blocked` entry to the packet's blockers array so the readiness
 * validator puts the packet into the `blocked` state.
 */
export function safetyCheckEvidenceItem(result: SafetyCheckResult): {
  source: string;
  description: string;
  data: Record<string, unknown>;
  retrieved_at: string;
} {
  return {
    source: "content_safety_gate",
    description: result.passed
      ? `Content safety gate passed (${result.checks.length} checks, ${result.warnings.length} warning(s)).`
      : `Content safety gate FAILED: ${result.violations.length} violation(s) — ${result.violations
          .map((v) => v.split(":")[0])
          .join(", ")}. Approval is blocked until all violations are resolved.`,
    data: {
      passed:          result.passed,
      violation_count: result.violations.length,
      warning_count:   result.warnings.length,
      violations:      result.violations,
      warnings:        result.warnings,
      claim_count:     result.claim_classifications.length,
      flagged_claims:  result.claim_classifications.filter((c) => c.category === "unclassified_flagged").length,
      content_kind:    result.contentKind,
    },
    retrieved_at: result.ranAt,
  };
}
