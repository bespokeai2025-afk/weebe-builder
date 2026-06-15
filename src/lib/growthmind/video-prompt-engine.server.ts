/**
 * GrowthMind Video Prompt Optimisation Engine
 *
 * Converts a raw user creative prompt into a full, Veo-ready ad pipeline:
 *   1. Marketing angle
 *   2. Target audience (refined)
 *   3. Hook (first 3 seconds)
 *   4. Full script
 *   5. Scene-by-scene storyboard
 *   6. Per-scene Veo generation prompts
 *   7. Voiceover script
 *   8. On-screen text per scene
 *   9. CTA
 *  10. Quality check (10 rules) + auto-fix if needed
 */

import { routeGenerate } from "./model-router.server";

// ── Types ──────────────────────────────────────────────────────────────────────

export type VideoPlatform =
  | "meta" | "tiktok" | "linkedin" | "youtube" | "instagram" | "general";

export type VideoAspectRatio = "16:9" | "9:16" | "1:1" | "4:5";

export type PromptEngineInput = {
  userPrompt:     string;
  businessGoal:   string;
  targetAudience: string;
  platform:       VideoPlatform;
  videoLength:    number;
  aspectRatio:    VideoAspectRatio;
  brandStyle:     string;
  cta:            string;
  voiceoverNeeded: boolean;

  companyName:    string;
  industry:       string;
  keywords:       string;
  competitors:    string;
  playbook:       string;
  kbSummary:      string;

  valuePoint?:     string;
  topOpportunity?: string;

  settings:       Record<string, string>;
  workspaceId:    string;
  sb:             any;
};

export type OptimisedScene = {
  scene:        number;
  duration:     number;
  visual:       string;
  voiceover:    string;
  onScreenText: string;
  cta?:         string;
  veoPrompt:    string;
};

export type QualityCheck = {
  rule:   string;
  passed: boolean;
  note:   string;
};

export type PromptEngineOutput = {
  title:            string;
  marketingAngle:   string;
  refinedAudience:  string;
  hook:             string;
  script:           string;
  storyboard:       OptimisedScene[];
  voiceoverScript:  string;
  cta:              string;
  optimisedPrompt:  string;
  qualityChecks:    QualityCheck[];
  allChecksPassed:  boolean;
  costUsd:          number;
};

// ── Platform rules ─────────────────────────────────────────────────────────────

const PLATFORM_RULES: Record<VideoPlatform, { maxWords: number; hookSeconds: number; style: string }> = {
  meta:      { maxWords: 150, hookSeconds: 3,  style: "Thumb-stopping, emotional, benefit-first" },
  tiktok:    { maxWords: 100, hookSeconds: 2,  style: "Fast-paced, Gen Z energy, trending audio style" },
  linkedin:  { maxWords: 200, hookSeconds: 4,  style: "Professional, credibility-first, thought leadership" },
  youtube:   { maxWords: 300, hookSeconds: 5,  style: "Story-driven, informative, skip-proof first 5 seconds" },
  instagram: { maxWords: 120, hookSeconds: 3,  style: "Visual-first, aspirational, lifestyle aesthetic" },
  general:   { maxWords: 200, hookSeconds: 4,  style: "Clear, benefit-driven, professional" },
};

// ── Main engine ────────────────────────────────────────────────────────────────

export async function optimiseVideoPrompt(
  input: PromptEngineInput,
): Promise<PromptEngineOutput> {
  const platform = PLATFORM_RULES[input.platform] ?? PLATFORM_RULES.general;
  const sceneCount = Math.max(2, Math.min(8, Math.ceil(input.videoLength / 5)));

  const kbContext = [
    input.kbSummary    ? `## Company Knowledge\n${input.kbSummary}`   : "",
    input.keywords     ? `## SEO Keywords: ${input.keywords}`          : "",
    input.competitors  ? `## Competitors: ${input.competitors}`        : "",
    input.playbook     ? `## Active Playbook: ${input.playbook}`       : "",
  ].filter(Boolean).join("\n\n");

  const valueContext = [
    input.valuePoint     ? `## Current Highest Value Point\n${input.valuePoint}\nIMPORTANT: Make this the central pillar of the video — it is the strongest market angle right now.` : "",
    input.topOpportunity ? `## Top Live Opportunity\n${input.topOpportunity}` : "",
  ].filter(Boolean).join("\n\n");

  const systemPrompt = `You are GrowthMind Video Studio — an elite AI advertising strategist and video director.

Your job: Convert a raw creative prompt into a production-ready, 10/10 marketing video pipeline for ${input.platform.toUpperCase()}.

## Business Context
Company: ${input.companyName || "the business"}
Industry: ${input.industry || "not specified"}
${kbContext}
${valueContext}

## Platform Rules (${input.platform.toUpperCase()})
- Hook window: first ${platform.hookSeconds} seconds must stop the scroll
- Max voiceover words: ~${platform.maxWords}
- Style mandate: ${platform.style}
- Aspect ratio: ${input.aspectRatio}
- Target duration: ${input.videoLength} seconds
- Scenes: ${sceneCount} scenes

## Veo Prompt Requirements
Each scene must have a specific, cinematic Veo generation prompt that includes:
- Camera angle (e.g. "close-up", "wide shot", "drone aerial", "tracking shot")
- Lighting (e.g. "golden hour", "studio lighting", "cinematic blue-toned")
- Action (what is happening in the frame)
- Style (e.g. "cinematic 4K", "UGC authentic", "corporate clean")
- Brand elements (colours, if specified)

## Output Format
Respond ONLY with valid JSON — no markdown fences, no commentary:
{
  "title": "Compelling video title",
  "marketingAngle": "The core unique angle that makes this ad work",
  "refinedAudience": "Precise audience definition (demographics + psychographics + pain point)",
  "hook": "Exact words/visual for the first ${platform.hookSeconds} seconds — must stop the scroll",
  "script": "Full voiceover script (${platform.maxWords} words max)",
  "voiceoverScript": "Clean voiceover text only — no stage directions",
  "cta": "Strong, specific CTA",
  "optimisedPrompt": "Master Veo generation prompt for the entire video — cinematic, specific, brand-aware",
  "storyboard": [
    {
      "scene": 1,
      "duration": 5,
      "visual": "What the camera shows — specific and visual",
      "voiceover": "Exact words spoken in this scene",
      "onScreenText": "Text overlay / caption shown on screen",
      "cta": "Optional CTA text for final scene only",
      "veoPrompt": "Specific Veo AI prompt for this scene — camera, lighting, action, style"
    }
  ]
}`;

  const userPrompt = `Convert this creative brief into a complete video ad pipeline:

CREATIVE PROMPT: ${input.userPrompt}

BUSINESS GOAL: ${input.businessGoal || "Not specified"}
TARGET AUDIENCE: ${input.targetAudience || "Derive from prompt"}
BRAND STYLE: ${input.brandStyle || "Professional, trustworthy"}
CTA: ${input.cta || "Derive from prompt"}
VOICEOVER NEEDED: ${input.voiceoverNeeded ? "Yes" : "No"}

Produce exactly ${sceneCount} scenes totalling ~${input.videoLength} seconds.
Make every word and every visual count. This must be a 10/10 ad.`;

  const result = await routeGenerate({
    system:      systemPrompt,
    user:        userPrompt,
    contentType: "video_freeform",
    maxTokens:   3000,
    mode:        "manual",
    provider:    "claude",
    model:       "claude-sonnet-4-5",
    settings:    input.settings,
    workspaceId: input.workspaceId,
    sb:          input.sb,
  });

  let parsed: any = null;
  try {
    const cleaned = result.text.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error("GrowthMind could not parse the video pipeline response. Please try again.");
  }

  const storyboard: OptimisedScene[] = (parsed.storyboard ?? []).map((s: any, i: number) => ({
    scene:        s.scene        ?? i + 1,
    duration:     Number(s.duration ?? Math.ceil(input.videoLength / sceneCount)),
    visual:       s.visual       ?? "",
    voiceover:    s.voiceover    ?? "",
    onScreenText: s.onScreenText ?? s.on_screen_text ?? "",
    cta:          s.cta          ?? undefined,
    veoPrompt:    s.veoPrompt    ?? s.veo_prompt ?? s.visual ?? "",
  }));

  // ── Quality checks ─────────────────────────────────────────────────────────

  const qualityChecks: QualityCheck[] = runQualityChecks({
    hook:            parsed.hook         ?? "",
    refinedAudience: parsed.refinedAudience ?? "",
    script:          parsed.script       ?? "",
    cta:             parsed.cta          ?? "",
    storyboard,
    onScreenTexts:   storyboard.map(s => s.onScreenText),
    aspectRatio:     input.aspectRatio,
    brandStyle:      input.brandStyle,
    businessGoal:    input.businessGoal,
    platform:        input.platform,
  });

  const allChecksPassed = qualityChecks.every(c => c.passed);

  let finalParsed = parsed;
  let finalStoryboard = storyboard;

  if (!allChecksPassed) {
    const failures = qualityChecks.filter(c => !c.passed).map(c => `• ${c.rule}: ${c.note}`).join("\n");

    const fixResult = await routeGenerate({
      system:      systemPrompt,
      user:        `${userPrompt}

## IMPORTANT — Auto-fix required
The previous generation failed these quality checks:
${failures}

Fix all issues and regenerate the complete JSON pipeline. Be specific and decisive.`,
      contentType: "video_freeform_fix",
      maxTokens:   3000,
      mode:        "manual",
      provider:    "claude",
      model:       "claude-sonnet-4-5",
      settings:    input.settings,
      workspaceId: input.workspaceId,
      sb:          input.sb,
    });

    try {
      const cleanedFix = fixResult.text.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
      finalParsed    = JSON.parse(cleanedFix);
      finalStoryboard = (finalParsed.storyboard ?? []).map((s: any, i: number) => ({
        scene:        s.scene     ?? i + 1,
        duration:     Number(s.duration ?? Math.ceil(input.videoLength / sceneCount)),
        visual:       s.visual    ?? "",
        voiceover:    s.voiceover ?? "",
        onScreenText: s.onScreenText ?? s.on_screen_text ?? "",
        cta:          s.cta       ?? undefined,
        veoPrompt:    s.veoPrompt ?? s.veo_prompt ?? s.visual ?? "",
      }));
    } catch {
      finalParsed    = parsed;
      finalStoryboard = storyboard;
    }
  }

  return {
    title:            finalParsed.title            ?? `${input.platform} Ad — ${new Date().toLocaleDateString()}`,
    marketingAngle:   finalParsed.marketingAngle   ?? "",
    refinedAudience:  finalParsed.refinedAudience  ?? input.targetAudience,
    hook:             finalParsed.hook             ?? "",
    script:           finalParsed.script           ?? "",
    storyboard:       finalStoryboard,
    voiceoverScript:  finalParsed.voiceoverScript  ?? finalParsed.script ?? "",
    cta:              finalParsed.cta              ?? input.cta,
    optimisedPrompt:  finalParsed.optimisedPrompt  ?? finalStoryboard[0]?.veoPrompt ?? "",
    qualityChecks,
    allChecksPassed,
    costUsd:          result.costUsd ?? 0,
  };
}

// ── Quality rules ──────────────────────────────────────────────────────────────

function runQualityChecks(params: {
  hook:            string;
  refinedAudience: string;
  script:          string;
  cta:             string;
  storyboard:      OptimisedScene[];
  onScreenTexts:   string[];
  aspectRatio:     VideoAspectRatio;
  brandStyle:      string;
  businessGoal:    string;
  platform:        VideoPlatform;
}): QualityCheck[] {
  return [
    {
      rule:   "Hook in first 3 seconds",
      passed: params.hook.trim().length >= 10,
      note:   params.hook.trim().length < 10
        ? "Hook is missing or too short — must clearly stop the scroll"
        : "Hook present",
    },
    {
      rule:   "Single target audience defined",
      passed: params.refinedAudience.trim().length > 10,
      note:   params.refinedAudience.trim().length <= 10
        ? "Target audience not clearly defined"
        : "Audience defined",
    },
    {
      rule:   "Single clear offer",
      passed: params.script.trim().length > 20,
      note:   params.script.trim().length <= 20
        ? "Script too short to contain a clear offer"
        : "Offer present in script",
    },
    {
      rule:   "Clear visual story (storyboard populated)",
      passed: params.storyboard.length >= 2 && params.storyboard.every(s => s.visual.length > 15),
      note:   params.storyboard.length < 2
        ? "Less than 2 scenes — not enough for a visual story"
        : params.storyboard.some(s => s.visual.length <= 15)
          ? "Some scenes have vague or missing visual descriptions"
          : "Visual story complete",
    },
    {
      rule:   "Strong CTA",
      passed: params.cta.trim().length >= 5,
      note:   params.cta.trim().length < 5
        ? "CTA missing or too vague"
        : "CTA present",
    },
    {
      rule:   "No vague claims",
      passed: !/(amazing|incredible|best ever|unbelievable|revolutionary|game.?changing)/i.test(params.script),
      note:   /(amazing|incredible|best ever|unbelievable|revolutionary|game.?changing)/i.test(params.script)
        ? "Script contains vague/hyperbolic claims — replace with specific benefits"
        : "No vague claims detected",
    },
    {
      rule:   "On-screen text not overloaded",
      passed: params.onScreenTexts.every(t => t.split(/\s+/).length <= 8),
      note:   params.onScreenTexts.some(t => t.split(/\s+/).length > 8)
        ? "Some on-screen text blocks exceed 8 words — simplify"
        : "On-screen text concise",
    },
    {
      rule:   "Platform aspect ratio specified",
      passed: ["16:9", "9:16", "1:1", "4:5"].includes(params.aspectRatio),
      note:   !["16:9", "9:16", "1:1", "4:5"].includes(params.aspectRatio)
        ? `Aspect ratio "${params.aspectRatio}" not standard for ${params.platform}`
        : `Aspect ratio ${params.aspectRatio} correct for ${params.platform}`,
    },
    {
      rule:   "Brand style included",
      passed: params.brandStyle.trim().length > 3 || params.storyboard.some(s => s.veoPrompt.length > 20),
      note:   params.brandStyle.trim().length <= 3 && !params.storyboard.some(s => s.veoPrompt.length > 20)
        ? "Brand style not specified — Veo prompts may produce off-brand visuals"
        : "Brand style present",
    },
    {
      rule:   "Ad objective included",
      passed: params.businessGoal.trim().length > 3 || params.script.length > 30,
      note:   params.businessGoal.trim().length <= 3
        ? "No business goal specified — ad may lack direction"
        : "Ad objective present",
    },
  ];
}
