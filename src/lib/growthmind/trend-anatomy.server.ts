// ── Trend Scout Deep Analysis (Content Anatomy) + Adaptation Engine ───────────
// SERVER ONLY. Phase 3 of the content intelligence pipeline.
//
//   runDeepAnalysis     — multimodal (Gemini) analysis of ONE trend item's video
//                         (YouTube URL directly; small fetched video inline; else
//                         metadata-only "partial" analysis). Stores a validated
//                         Content Anatomy record. User-triggered only, daily-capped,
//                         cost logged to growthmind_discovery_runs (deep_analysis).
//   generateAdaptation  — transforms the anatomy's MECHANISM (never the creative
//                         expression) into a complete original brief grounded in
//                         Business DNA, with n-gram similarity blocking against the
//                         source transcript + restricted-claim blocking. Stored in
//                         growthmind_content_recommendations.

import { getTrendAdminClient } from "./trend-discovery.server";
import { calcCostUsd } from "./model-router.shared";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const ANALYSIS_MODEL = "gemini-2.5-flash";
const INLINE_VIDEO_MAX_BYTES = 15 * 1024 * 1024; // Gemini inline part limit headroom

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, Math.round(Number(n) || 0)));
}

function isYouTubeUrl(url: string): boolean {
  return /(^https?:\/\/)(www\.|m\.)?(youtube\.com|youtu\.be)\//i.test(url);
}

function extractJson(text: string): any {
  const jsonText = text.match(/\{[\s\S]*\}/)?.[0] ?? text;
  return JSON.parse(jsonText);
}

// ── Daily cap ──────────────────────────────────────────────────────────────────

async function assertDeepAnalysisBudget(admin: any, workspaceId: string): Promise<number> {
  const { data: settings } = await admin
    .from("workspace_settings")
    .select("growthmind_deep_analysis_daily_limit")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const limit = Math.max(1, Number(settings?.growthmind_deep_analysis_daily_limit ?? 5));

  const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
  const { count, error } = await admin
    .from("growthmind_discovery_runs")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("run_kind", "deep_analysis")
    .gte("created_at", dayStart.toISOString());
  if (error) throw new Error(`Deep-analysis budget check failed: ${error.message}`);
  if ((count ?? 0) >= limit) {
    throw new Error(`Daily deep-analysis limit reached (${limit}/day). Raise it in Trend Scout settings or try tomorrow.`);
  }
  return limit;
}

// ── Multimodal Gemini call ─────────────────────────────────────────────────────

type GeminiPart =
  | { text: string }
  | { file_data: { file_uri: string; mime_type?: string } }
  | { inline_data: { mime_type: string; data: string } };

async function geminiMultimodal(
  apiKey: string,
  system: string,
  parts: GeminiPart[],
  maxTokens: number,
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const res = await fetch(`${GEMINI_BASE}/${ANALYSIS_MODEL}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts }],
      generationConfig: { maxOutputTokens: maxTokens, temperature: 0.4 },
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`Gemini (${ANALYSIS_MODEL}): ${err.slice(0, 300)}`);
  }
  const json = await res.json() as any;
  return {
    text: json.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "",
    inputTokens:  json.usageMetadata?.promptTokenCount     ?? 0,
    outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
  };
}

// ── SSRF-safe outbound fetch for inline video ─────────────────────────────────
// item.url comes from external discovery sources and must be treated as
// untrusted: https only, public unicast IPs only (checked after DNS resolution),
// manual redirect handling with re-validation on every hop.

function isPrivateIp(ip: string): boolean {
  if (ip.includes(":")) {
    const v6 = ip.toLowerCase();
    // loopback, unspecified, link-local, unique-local, v4-mapped
    return v6 === "::1" || v6 === "::" || v6.startsWith("fe80:") || v6.startsWith("fc") ||
           v6.startsWith("fd") || v6.startsWith("::ffff:");
  }
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some(n => Number.isNaN(n))) return true;
  return (
    p[0] === 0 || p[0] === 10 || p[0] === 127 ||
    (p[0] === 100 && p[1] >= 64 && p[1] <= 127) ||       // CGNAT
    (p[0] === 169 && p[1] === 254) ||                    // link-local / cloud metadata
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168) ||
    (p[0] === 192 && p[1] === 0 && p[2] === 0) ||
    (p[0] === 198 && (p[1] === 18 || p[1] === 19)) ||
    p[0] >= 224                                          // multicast/reserved
  );
}

async function assertSafePublicUrl(raw: string): Promise<URL | null> {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  const host = u.hostname;
  if (isPrivateIp(host) || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return null;
  try {
    const { lookup } = await import("node:dns/promises");
    const addrs = await lookup(host, { all: true });
    if (addrs.length === 0 || addrs.some(a => isPrivateIp(a.address))) return null;
  } catch { return null; }
  return u;
}

async function safeFetch(rawUrl: string, init: RequestInit, timeoutMs: number): Promise<Response | null> {
  let current = rawUrl;
  for (let hop = 0; hop < 3; hop++) {
    const u = await assertSafePublicUrl(current);
    if (!u) return null;
    const res = await fetch(u.toString(), {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return null;
      current = new URL(loc, u).toString(); // re-validated on next hop
      continue;
    }
    return res;
  }
  return null; // too many redirects
}

/** Try to fetch a small direct video file for inline analysis. Null when not permitted/possible. */
async function tryFetchInlineVideo(url: string): Promise<{ mimeType: string; base64: string } | null> {
  try {
    const head = await safeFetch(url, { method: "HEAD" }, 10_000);
    if (!head) return null;
    const type = head.headers.get("content-type") ?? "";
    const len  = Number(head.headers.get("content-length") ?? 0);
    if (!head.ok || !type.startsWith("video/") || len <= 0 || len > INLINE_VIDEO_MAX_BYTES) return null;
    const res = await safeFetch(url, {}, 30_000);
    if (!res || !res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.startsWith("video/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > INLINE_VIDEO_MAX_BYTES) return null;
    return { mimeType: ct.split(";")[0], base64: buf.toString("base64") };
  } catch {
    return null;
  }
}

// ── Anatomy prompt & validation ────────────────────────────────────────────────

const ANATOMY_SYSTEM =
  "You are GrowthMind's video analyst. Deconstruct WHY a piece of content works — its mechanism, not its surface. " +
  "Analyse the provided video (or, if only metadata is provided, analyse from that and set confidence lower). " +
  'Respond with ONLY valid JSON: {' +
  '"transcript":"full spoken transcript, or empty if unavailable",' +
  '"onScreenText":"all on-screen text/captions in order, or empty",' +
  '"hookType":"e.g. question / pattern-interrupt / bold-claim / story-open",' +
  '"hookDurationSeconds":0,' +
  '"format":"e.g. talking-head / voiceover-broll / skit / tutorial / testimonial",' +
  '"structure":["ordered narrative beats"],' +
  '"sceneCount":0,' +
  '"paceSecondsPerScene":0,' +
  '"emotionalDriver":"primary emotion mechanism e.g. curiosity / fear-of-missing-out / relief",' +
  '"cta":"call to action used, or empty",' +
  '"targetAudience":"who this speaks to",' +
  '"proofElements":["social proof / demos / stats used"],' +
  '"successMechanism":"2-3 sentence explanation of WHY this works",' +
  '"relevance":0-100 (how transferable the mechanism is to other businesses),' +
  '"reproductionDifficulty":0-100 (production effort to do an original version),' +
  '"risks":["copyright / trademark / unlicensed_audio / claims / controversy risks"],' +
  '"adaptationOpportunities":["specific ways a business could adapt the MECHANISM originally"],' +
  '"confidence":0-100}';

export type DeepAnalysisOutcome = {
  anatomyId: string;
  status: "completed" | "partial";
  analysisMode: "video_url" | "video_inline" | "metadata_only";
  costUsd: number;
};

export async function runDeepAnalysis(workspaceId: string, itemId: string): Promise<DeepAnalysisOutcome> {
  const admin = getTrendAdminClient() as any;
  const t0 = Date.now();

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Gemini API key not configured — deep video analysis requires GEMINI_API_KEY.");

  await assertDeepAnalysisBudget(admin, workspaceId);

  const { data: item, error: itemErr } = await admin
    .from("growthmind_trend_items")
    .select("id, platform, url, title, caption, media_type, author_handle, author_name, metrics, scores, status, raw")
    .eq("id", itemId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (itemErr) throw new Error(`Failed to load item: ${itemErr.message}`);
  if (!item) throw new Error("Trend item not found");
  if (item.status === "archived") throw new Error("This item is archived.");

  // Choose analysis mode
  let mode: DeepAnalysisOutcome["analysisMode"] = "metadata_only";
  const parts: GeminiPart[] = [];
  const url: string = item.url ?? "";
  const isVideo = ["video", "reel"].includes(item.media_type ?? "");

  if (url && isYouTubeUrl(url)) {
    mode = "video_url";
    parts.push({ file_data: { file_uri: url } });
  } else if (url && isVideo) {
    const inline = await tryFetchInlineVideo(url);
    if (inline) {
      mode = "video_inline";
      parts.push({ inline_data: { mime_type: inline.mimeType, data: inline.base64 } });
    }
  }

  const metaBlock =
    `ITEM METADATA:\nPlatform: ${item.platform}${item.media_type ? "/" + item.media_type : ""}\n` +
    `Author: ${item.author_handle ?? item.author_name ?? "unknown"}\n` +
    `Title: ${(item.title ?? "").slice(0, 300)}\nCaption: ${(item.caption ?? "").slice(0, 1500)}\n` +
    `Metrics: ${JSON.stringify(item.metrics ?? {}).slice(0, 400)}\n` +
    (mode === "metadata_only"
      ? "NOTE: The video itself could not be provided — analyse from metadata only and set confidence accordingly."
      : "Analyse the attached video in full.");
  parts.push({ text: metaBlock });

  let outcomeStatus: "completed" | "partial" = mode === "metadata_only" ? "partial" : "completed";
  let costUsd = 0;
  let anatomyRecord: any = null;
  let transcript = "";
  let onScreenText = "";
  let errorMessage: string | null = null;

  try {
    const r = await geminiMultimodal(apiKey, ANATOMY_SYSTEM, parts, 6000);
    costUsd = calcCostUsd(ANALYSIS_MODEL as any, r.inputTokens, r.outputTokens);
    const parsed = extractJson(r.text);
    transcript   = String(parsed.transcript ?? "").slice(0, 20000);
    onScreenText = String(parsed.onScreenText ?? "").slice(0, 5000);
    anatomyRecord = {
      hookType:                String(parsed.hookType ?? "").slice(0, 200),
      hookDurationSeconds:     Number(parsed.hookDurationSeconds) || 0,
      format:                  String(parsed.format ?? "").slice(0, 200),
      structure:               Array.isArray(parsed.structure) ? parsed.structure.slice(0, 20).map(String) : [],
      sceneCount:              Number(parsed.sceneCount) || 0,
      paceSecondsPerScene:     Number(parsed.paceSecondsPerScene) || 0,
      emotionalDriver:         String(parsed.emotionalDriver ?? "").slice(0, 300),
      cta:                     String(parsed.cta ?? "").slice(0, 300),
      targetAudience:          String(parsed.targetAudience ?? "").slice(0, 500),
      proofElements:           Array.isArray(parsed.proofElements) ? parsed.proofElements.slice(0, 12).map(String) : [],
      successMechanism:        String(parsed.successMechanism ?? "").slice(0, 1500),
      relevance:               clamp(parsed.relevance),
      reproductionDifficulty:  clamp(parsed.reproductionDifficulty),
      risks:                   Array.isArray(parsed.risks) ? parsed.risks.slice(0, 12).map(String) : [],
      adaptationOpportunities: Array.isArray(parsed.adaptationOpportunities) ? parsed.adaptationOpportunities.slice(0, 12).map(String) : [],
      confidence:              clamp(parsed.confidence),
    };
  } catch (e: any) {
    errorMessage = String(e?.message ?? e).slice(0, 500);
  }

  const failed = anatomyRecord == null;
  const { data: upserted, error: upErr } = await admin
    .from("growthmind_content_anatomy")
    .upsert({
      workspace_id:   workspaceId,
      trend_item_id:  itemId,
      status:         failed ? "failed" : outcomeStatus,
      analysis_mode:  mode,
      transcript:     transcript || null,
      on_screen_text: onScreenText || null,
      anatomy:        anatomyRecord ?? {},
      model:          ANALYSIS_MODEL,
      cost_estimate:  costUsd,
      error_message:  errorMessage,
      updated_at:     new Date().toISOString(),
    }, { onConflict: "workspace_id,trend_item_id" })
    .select("id")
    .single();
  if (upErr) throw new Error(`Failed to store anatomy: ${upErr.message}`);

  // Advance the item lifecycle (analysed) unless it failed.
  if (!failed && !["recommended", "archived"].includes(item.status)) {
    await admin
      .from("growthmind_trend_items")
      .update({ status: "analysed", updated_at: new Date().toISOString() })
      .eq("id", itemId)
      .eq("workspace_id", workspaceId);
  }

  const { error: logErr } = await admin.from("growthmind_discovery_runs").insert({
    workspace_id:  workspaceId,
    run_kind:      "deep_analysis",
    source:        "anatomy_ai",
    status:        failed ? "error" : "success",
    items_found:   1,
    items_new:     failed ? 0 : 1,
    error_message: errorMessage,
    cost_estimate: costUsd,
    duration_ms:   Date.now() - t0,
    triggered_by:  "user",
  });
  if (logErr) console.error("[trend-anatomy] failed to log run:", logErr.message);

  if (failed) throw new Error(`Deep analysis failed: ${errorMessage ?? "unknown error"}`);
  return { anatomyId: upserted.id, status: outcomeStatus, analysisMode: mode, costUsd };
}

// ── Similarity check (word n-gram overlap) ─────────────────────────────────────

const SIMILARITY_BLOCK_THRESHOLD = 0.18; // >18% of 5-gram phrases shared = too close

export function computeSimilarity(candidate: string, source: string): number {
  const grams = (t: string): Set<string> => {
    const words = t.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
    const out = new Set<string>();
    for (let i = 0; i + 5 <= words.length; i++) out.add(words.slice(i, i + 5).join(" "));
    return out;
  };
  const c = grams(candidate);
  const s = grams(source);
  if (c.size === 0 || s.size === 0) return 0;
  let shared = 0;
  for (const g of c) if (s.has(g)) shared++;
  return shared / c.size;
}

// ── Restricted-claim check ─────────────────────────────────────────────────────

function findRestrictedClaims(text: string, restrictedRaw: string): string[] {
  const hits: string[] = [];
  const lower = text.toLowerCase();
  const claims = restrictedRaw
    .split(/\r?\n|;|,(?=\s*[A-Z])/)
    .map(c => c.trim())
    .filter(c => c.length >= 6);
  for (const claim of claims) {
    const key = claim.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(w => w.length > 3);
    if (key.length === 0) continue;
    const matched = key.filter(w => lower.includes(w)).length / key.length;
    if (matched >= 0.7) hits.push(claim.slice(0, 120));
  }
  return hits.slice(0, 6);
}

// ── Adaptation engine ──────────────────────────────────────────────────────────

const DNA_FIELDS = [
  "company_name", "industry", "products", "services", "ideal_customer_profiles",
  "target_markets", "unique_selling_points", "brand_voice", "offers",
  "locations", "main_growth_objective",
] as const;

export type AdaptationOutcome = {
  recommendationId: string;
  blocked: boolean;
  blockedReasons: string[];
  warnings: string[];
  similarity: number;
  costUsd: number;
};

export async function generateAdaptation(workspaceId: string, itemId: string): Promise<AdaptationOutcome> {
  const admin = getTrendAdminClient() as any;
  const t0 = Date.now();

  const [{ data: anatomyRow, error: aErr }, { data: item, error: iErr }, { data: dna, error: dErr }] = await Promise.all([
    admin.from("growthmind_content_anatomy").select("*").eq("workspace_id", workspaceId).eq("trend_item_id", itemId).maybeSingle(),
    admin.from("growthmind_trend_items").select("id, platform, url, title, caption, media_type, author_handle, author_name, scores").eq("id", itemId).eq("workspace_id", workspaceId).maybeSingle(),
    admin.from("growthmind_business_dna").select("*").eq("workspace_id", workspaceId).maybeSingle(),
  ]);
  if (aErr) throw new Error(`Anatomy load failed: ${aErr.message}`);
  if (iErr) throw new Error(`Item load failed: ${iErr.message}`);
  if (!item) throw new Error("Trend item not found");
  if (!anatomyRow || anatomyRow.status === "failed") {
    throw new Error("Run deep analysis first — an adaptation must be grounded in a completed Content Anatomy.");
  }
  if (dErr) throw new Error(`Business DNA load failed: ${dErr.message}`);
  const filled = dna ? DNA_FIELDS.filter(f => typeof dna[f] === "string" && dna[f].trim().length > 0) : [];
  if (filled.length < 3) {
    throw new Error("Business DNA is too empty to generate an original adaptation — fill in at least your industry, products/services and ideal customers first.");
  }

  const dnaSummary = DNA_FIELDS
    .filter(f => dna[f]?.trim())
    .map(f => `${f.replace(/_/g, " ")}: ${String(dna[f]).slice(0, 300)}`)
    .join("\n");
  const restrictedRaw = [dna.restricted_claims ?? "", dna.compliance_notes ?? ""].filter(Boolean).join("\n");
  const anatomy = anatomyRow.anatomy ?? {};

  const system =
    "You are GrowthMind, an elite creative director. You transform the underlying MECHANISM of a successful video " +
    "(its hook type, structure, pacing, emotional driver) into a COMPLETELY ORIGINAL piece for one specific business. " +
    "HARD RULES: never copy the source's words, script, jokes, on-screen text or scenario. Do not imitate the creator. " +
    "Do not reference the source's brand. Only the abstract mechanism transfers. All claims must be supportable by the Business DNA — " +
    "if the DNA lists restricted claims or compliance notes, you must not make those claims. Never suggest using the source's audio track; " +
    "recommend original or licensed audio only. " +
    'Respond with ONLY valid JSON: {' +
    '"title":"..","objective":"..","audience":"..","platform":"..","hookOptions":["3 alternative hooks"],' +
    '"script":"full voiceover/dialogue script",' +
    '"shotList":[{"scene":1,"shot":"..","duration":0,"onScreenText":".."}],' +
    '"brollRequirements":["footage the business must capture"],' +
    '"onScreenText":["overlays in order"],"subtitles":"style note","caption":"post caption","cta":"..",' +
    '"thumbnailText":"..","hashtags":["#.."],"audioDirection":"original/licensed only","durationSeconds":0,' +
    '"postingTime":"best time + why","expectedOutcome":"realistic expectation","riskNotes":["risks"],' +
    '"inspiredBy":["structural elements taken from the source mechanism"],' +
    '"changed":["what was changed vs the source"],' +
    '"whyOriginal":"2-3 sentences on why this is original, not a copy"}';

  const user =
    `BUSINESS DNA:\n${dnaSummary}\n\n` +
    (restrictedRaw ? `RESTRICTED CLAIMS / COMPLIANCE (never violate):\n${restrictedRaw.slice(0, 1500)}\n\n` : "") +
    `SOURCE CONTENT ANATOMY (mechanism to transform):\n${JSON.stringify(anatomy).slice(0, 4000)}\n\n` +
    `SOURCE CONTEXT (for reference only — never copy): platform ${item.platform}, title "${(item.title ?? "").slice(0, 150)}"`;

  const { routeGenerate } = await import("./model-router.server");
  const result = await routeGenerate({
    system, user,
    contentType: "video_script",
    maxTokens:   6000,
    mode:        "smart",
    settings:    {},
    workspaceId,
    sb:          admin,
  });

  let brief: any;
  try { brief = extractJson(result.text); }
  catch { throw new Error("Adaptation generation returned unparseable output — try again."); }

  // ── Originality & compliance checks ─────────────────────────────────────────
  const blockedReasons: string[] = [];
  const warnings: string[] = [];

  const candidateText = [
    brief.script ?? "", brief.caption ?? "",
    ...(Array.isArray(brief.hookOptions) ? brief.hookOptions : []),
    ...(Array.isArray(brief.onScreenText) ? brief.onScreenText : []),
  ].join("\n");
  const sourceText = [anatomyRow.transcript ?? "", anatomyRow.on_screen_text ?? "", item.caption ?? "", item.title ?? ""].join("\n");
  const similarity = computeSimilarity(candidateText, sourceText);
  if (similarity > SIMILARITY_BLOCK_THRESHOLD) {
    blockedReasons.push(`Too similar to the source (${Math.round(similarity * 100)}% phrase overlap, limit ${Math.round(SIMILARITY_BLOCK_THRESHOLD * 100)}%).`);
  }

  if (restrictedRaw) {
    const claimHits = findRestrictedClaims(candidateText, restrictedRaw);
    if (claimHits.length > 0) {
      blockedReasons.push(`Contains restricted/unsupported claims: ${claimHits.join(" | ")}`);
    }
  }

  const risks: string[] = Array.isArray(anatomy.risks) ? anatomy.risks.map(String) : [];
  if (risks.some(r => /audio|music|sound/i.test(r)) || /same (sound|audio|track)|trending audio|original sound by/i.test(String(brief.audioDirection ?? ""))) {
    warnings.push("Source may use unlicensed/trending audio — use original or licensed audio only.");
  }
  if (risks.some(r => /copyright|trademark|imitat/i.test(r))) {
    warnings.push("Source flagged copyright/imitation risk — keep visual style clearly distinct.");
  }

  const blocked = blockedReasons.length > 0;

  const payload = {
    brief,
    originality: {
      inspiredBy:  Array.isArray(brief.inspiredBy) ? brief.inspiredBy.slice(0, 12).map(String) : [],
      changed:     Array.isArray(brief.changed) ? brief.changed.slice(0, 12).map(String) : [],
      whyOriginal: String(brief.whyOriginal ?? "").slice(0, 1000),
      similarity,
      similarityLimit: SIMILARITY_BLOCK_THRESHOLD,
    },
    compliance: { blocked, blockedReasons, warnings },
    source: {
      trendItemId: itemId,
      anatomyId:   anatomyRow.id,
      url:         item.url,
      platform:    item.platform,
      author:      item.author_handle ?? item.author_name ?? null,
    },
    model: result.model,
    costUsd: result.costUsd,
  };

  const { data: rec, error: recErr } = await admin
    .from("growthmind_content_recommendations")
    .insert({
      workspace_id:    workspaceId,
      trend_item_id:   itemId,
      title:           String(brief.title ?? item.title ?? "Adaptation").slice(0, 300),
      brief:           String(brief.objective ?? "").slice(0, 2000),
      angle:           String(brief.whyOriginal ?? "").slice(0, 1000),
      format:          "reel",
      target_platform: String(brief.platform ?? item.platform ?? "multi").slice(0, 40),
      status:          blocked ? "failed" : "recommended",
      risk_flags:      [...blockedReasons, ...warnings].slice(0, 10),
      scores:          { similarity, sourceOpportunity: item.scores?.total ?? null },
      payload,
      created_by:      "growthmind",
    })
    .select("id")
    .single();
  if (recErr) throw new Error(`Failed to store adaptation: ${recErr.message}`);

  const { error: logErr } = await admin.from("growthmind_discovery_runs").insert({
    workspace_id:  workspaceId,
    run_kind:      "adaptation",
    source:        "adaptation_ai",
    status:        "success",
    items_found:   1,
    items_new:     blocked ? 0 : 1,
    error_message: blocked ? blockedReasons.join("; ").slice(0, 500) : null,
    cost_estimate: result.costUsd ?? 0,
    duration_ms:   Date.now() - t0,
    triggered_by:  "user",
  });
  if (logErr) console.error("[trend-anatomy] failed to log adaptation run:", logErr.message);

  return { recommendationId: rec.id, blocked, blockedReasons, warnings, similarity, costUsd: result.costUsd ?? 0 };
}
