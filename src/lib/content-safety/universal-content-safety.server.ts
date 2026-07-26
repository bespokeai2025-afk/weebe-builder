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

// ── URL extraction & safety check ────────────────────────────────────────────

/** Extract all URLs from generated content text. */
export function extractUrls(text: string): string[] {
  const urlRe = /https?:\/\/[^\s"'<>)\]]+/gi;
  return Array.from(new Set(text.match(urlRe) ?? []));
}

/**
 * Returns false when the URL's hostname looks private/internal/non-public.
 * Mirrors the pattern in publication-engine.server.ts#isSafeVerificationHost
 * but operates on a full URL string rather than a hostname.
 * Does NOT do DNS resolution — structural check only (safe for content scanning).
 */
export function isContentUrlSafe(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return false;
  // Raw IPv4
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const p = h.split(".").map(Number);
    if (
      p[0] === 0 || p[0] === 10 || p[0] === 127 ||
      (p[0] === 100 && p[1] >= 64 && p[1] <= 127) ||
      (p[0] === 169 && p[1] === 254) ||
      (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
      (p[0] === 192 && p[1] === 168)
    ) return false;
  }
  // IPv6 literals
  if (h.startsWith("[")) return false;
  return true;
}

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
    // Both columns are strings in the schema (pipe/semicolon/newline-delimited lists).
    // `approved_claims` is the canonical allow-list; `unique_selling_points` holds USPs
    // that the workspace has confirmed are accurate.
    const { data } = await sb
      .from("growthmind_business_dna")
      .select("unique_selling_points, approved_claims")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (!data) return [];
    const parseColumn = (col: string | null | undefined): string[] =>
      (typeof col === "string" && col.trim())
        ? col.split(/[;,|\n]/).map((s) => s.trim()).filter((s) => s.length > 5)
        : [];
    return [...parseColumn(data.unique_selling_points), ...parseColumn(data.approved_claims)];
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
  // Sentences that match a stat pattern AND are covered by the workspace allow-list
  // are classified as approved_customer_evidence (verified claim on file).
  const statFlaggedAll   = sentences.filter((s) => FABRICATED_STAT_PATTERNS.some((p) => p.test(s)) && !hasSourcingContext(s));
  const statAllowListed  = statFlaggedAll.filter((s) => matchesAllowList(s, allowedClaims));
  const fabricatedStatSentences = statFlaggedAll.filter((s) => !matchesAllowList(s, allowedClaims));

  for (const s of statAllowListed) {
    claimClassifications.push({
      text:     s.slice(0, 200),
      category: "approved_customer_evidence",
      reason:   "Numeric claim matches workspace-approved claim in Business DNA allow-list",
    });
  }
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
      ? `No unsourced statistics detected${statAllowListed.length ? ` (${statAllowListed.length} stat(s) exempted by workspace allow-list)` : ""}.`
      : `${fabricatedStatSentences.length} sentence(s) contain unsourced statistics: ${fabricatedStatSentences
          .slice(0, 2)
          .map((s) => `"${s.slice(0, 80)}"`)
          .join("; ")}`,
    fabricatedStatSentences.length === 0 ? "warning" : "violation",
  );

  // ── 3. Fake testimonials / invented quotations ──────────────────────────────
  const testimonialFlaggedAll  = sentences.filter((s) => FAKE_TESTIMONIAL_PATTERNS.some((p) => p.test(s)));
  const testimonialAllowListed = testimonialFlaggedAll.filter((s) => matchesAllowList(s, allowedClaims));
  const testimonialSentences   = testimonialFlaggedAll.filter((s) => !matchesAllowList(s, allowedClaims));

  for (const s of testimonialAllowListed) {
    if (!claimClassifications.find((c) => c.text === s.slice(0, 200))) {
      claimClassifications.push({
        text:     s.slice(0, 200),
        category: "approved_customer_evidence",
        reason:   "Testimonial/quotation matches workspace-approved evidence in Business DNA",
      });
    }
  }
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
  const guaranteeFlaggedAll  = sentences.filter((s) => GUARANTEE_PATTERNS.some((p) => p.test(s)) && !hasSourcingContext(s));
  const guaranteeAllowListed = guaranteeFlaggedAll.filter((s) => matchesAllowList(s, allowedClaims));
  const guaranteeSentences   = guaranteeFlaggedAll.filter((s) => !matchesAllowList(s, allowedClaims));

  for (const s of guaranteeAllowListed) {
    if (!claimClassifications.find((c) => c.text === s.slice(0, 200))) {
      claimClassifications.push({
        text:     s.slice(0, 200),
        category: "approved_customer_evidence",
        reason:   "Guarantee claim matches workspace-approved claim in Business DNA allow-list",
      });
    }
  }
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
  const rankingFlaggedAll  = sentences.filter((s) => RANKING_GUARANTEE_PATTERNS.some((p) => p.test(s)) && !hasSourcingContext(s));
  const rankingAllowListed = rankingFlaggedAll.filter((s) => matchesAllowList(s, allowedClaims));
  const rankingSentences   = rankingFlaggedAll.filter((s) => !matchesAllowList(s, allowedClaims));

  for (const s of rankingAllowListed) {
    if (!claimClassifications.find((c) => c.text === s.slice(0, 200))) {
      claimClassifications.push({
        text:     s.slice(0, 200),
        category: "approved_customer_evidence",
        reason:   "Ranking claim matches workspace-approved claim in Business DNA allow-list",
      });
    }
  }
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

  // ── 8. Unsafe embedded URLs ─────────────────────────────────────────────────
  // Structural check (no DNS) — flags private/internal hosts embedded in content.
  // Uses isContentUrlSafe() which mirrors the SSRF guard in publication-engine.
  const embeddedUrls  = extractUrls(text);
  const unsafeUrls    = embeddedUrls.filter((u) => !isContentUrlSafe(u));
  addCheck(
    "unsafe_urls",
    unsafeUrls.length === 0,
    unsafeUrls.length === 0
      ? `${embeddedUrls.length > 0 ? `${embeddedUrls.length} URL(s) found, all structurally safe.` : "No embedded URLs detected."}`
      : `${unsafeUrls.length} URL(s) point to private/internal/non-public hosts and must be removed: ${unsafeUrls.slice(0, 3).join(", ")}`,
    unsafeUrls.length === 0 ? "warning" : "violation",
  );

  // ── 9. Broken / placeholder link detection ───────────────────────────────────
  // Static heuristics only (no HTTP fetch). Flags:
  //   a) URLs that are syntactically malformed (cannot be parsed by `new URL()`).
  //   b) URLs pointing to well-known placeholder/example domains.
  //   c) URLs containing template-placeholder syntax (e.g. [your-url], {{link}}).
  const PLACEHOLDER_DOMAINS = new Set([
    "example.com", "example.org", "example.net",
    "yoursite.com", "your-site.com", "yourwebsite.com", "your-website.com",
    "yourdomain.com", "your-domain.com", "mydomain.com", "mysite.com",
    "website.com", "placeholder.com", "sample-site.com", "samplesite.com",
    "testsite.com", "test-site.com", "demo-site.com", "demosite.com",
    "insertlinkhere.com", "addlinkhere.com", "linkhere.com",
  ]);
  const PLACEHOLDER_URL_PATTERN = /[\[{](?:your[_-]?(?:url|link|website|site)|link|url|href|insert[_-]?link|\d+)[\]}]/i;

  const malformedUrls: string[]    = [];
  const placeholderUrls: string[]  = [];
  for (const u of embeddedUrls) {
    // Skip URLs already flagged as unsafe (check 8)
    if (!isContentUrlSafe(u)) continue;
    // a) Malformed — cannot be parsed
    let parsed: URL | null = null;
    try { parsed = new URL(u); } catch { malformedUrls.push(u); continue; }
    // b) Placeholder domain
    const host = parsed.hostname.replace(/^www\./, "");
    if (PLACEHOLDER_DOMAINS.has(host)) { placeholderUrls.push(u); continue; }
    // c) Placeholder syntax anywhere in the URL string
    if (PLACEHOLDER_URL_PATTERN.test(u)) { placeholderUrls.push(u); continue; }
  }
  const brokenLinkIssues = [...malformedUrls, ...placeholderUrls];
  addCheck(
    "broken_links",
    brokenLinkIssues.length === 0,
    brokenLinkIssues.length === 0
      ? "No malformed or placeholder URLs detected."
      : [
          malformedUrls.length > 0 ? `${malformedUrls.length} malformed URL(s) (unparseable): ${malformedUrls.slice(0, 3).join(", ")}` : "",
          placeholderUrls.length > 0 ? `${placeholderUrls.length} placeholder URL(s) (must be replaced before publication): ${placeholderUrls.slice(0, 3).join(", ")}` : "",
        ].filter(Boolean).join("; "),
    brokenLinkIssues.length === 0 ? "warning" : "violation",
  );

  // ── Universal claim classification pass ────────────────────────────────────
  // Every sentence that could be making a factual assertion gets classified into
  // one of the required categories. Sentences already classified by the violation
  // checks above are skipped (they already have a category).
  const classifiedTexts = new Set(claimClassifications.map((c) => c.text));
  for (const s of sentences) {
    const key = s.slice(0, 200);
    if (classifiedTexts.has(key)) continue;               // already classified by a check
    if (s.trim().endsWith("?")) continue;                  // skip questions
    if (s.split(/\s+/).length < 5) continue;               // skip very short fragments

    // Heuristic: a sentence is "factual-sounding" if it contains a quantitative
    // term, a performance word, or any of the sourcing/estimate/hypothesis patterns.
    const hasQuantitative    = /\d|%|roi|revenue|growth|increase|decrease|improv|reduc|cost|saving|customer/i.test(s);
    const hasClaim           = /\bis\b|\bare\b|\bhas\b|\bhave\b|\benables?\b|\bhelps?\b|\bdrives?\b|\bdeliver/i.test(s);
    const hasSourcing        = hasSourcingContext(s);
    const hasEstimateOrHypo  = ESTIMATE_PATTERNS.some((p) => p.test(s)) ||
                               HYPOTHESIS_PATTERNS.some((p) => p.test(s)) ||
                               HYPOTHETICAL_PATTERNS.some((p) => p.test(s));

    if (!hasQuantitative && !hasClaim && !hasSourcing && !hasEstimateOrHypo) continue;

    // Apply classification hierarchy.
    let category: ClaimCategory;
    let reason: string;

    if (matchesAllowList(s, allowedClaims)) {
      category = "approved_customer_evidence";
      reason   = "Matches workspace-approved claim in Business DNA";
    } else {
      category = classifyClaimSentence(s);
      reason   = (() => {
        switch (category) {
          case "verified_internal_fact":              return "Contains a sourcing marker referencing internal data";
          case "verified_external_source":            return "Contains an explicit external source citation";
          case "labelled_estimate":                   return "Claim is clearly labelled as an estimate";
          case "labelled_hypothesis":                 return "Claim is clearly labelled as a hypothesis or belief";
          case "labelled_hypothetical":               return "Claim is clearly labelled as a hypothetical example";
          default:                                    return "Factual assertion without a declared source or label";
        }
      })();
    }

    claimClassifications.push({ text: key, category, reason });
    classifiedTexts.add(key);
  }

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
    source: "safety_check",
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
