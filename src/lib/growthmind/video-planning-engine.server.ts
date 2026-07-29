/**
 * GrowthMind Video Planning Engine — Veo 3.1 pipeline planning stage.
 *
 * Runs on the growthmind_video_planning model role (gemini-3.1-pro-preview).
 * Produces the full creative package: concept, script, hook, scene plan /
 * shot list, voiceover copy, on-screen text, brand/camera/audio direction and
 * the final Veo render prompt.
 *
 * This stage is PLANNING only — it is ledgered as an LLM request (tokens),
 * never as video generation, and costs nothing beyond normal text tokens.
 */

import { geminiGenerate } from "./providers/gemini-growth.server";
import { DEFAULT_ROLE_ASSIGNMENTS } from "@/lib/ai/model-registry.shared";

// ── Types ─────────────────────────────────────────────────────────────────────

export type BrandContext = {
  companyName:      string;
  website:          string;
  industry:         string;
  products:         string;
  services:         string;
  offers:           string;
  targetAudience:   string;
  usps:             string;
  brandVoice:       string;
  complianceNotes:  string;   // approved / prohibited claims
  hasDna:           boolean;
};

export type VideoPlanScene = {
  scene:        number;
  duration:     number;
  shot:         string;      // camera direction for this shot
  visual:       string;
  voiceover:    string;
  onScreenText: string;
};

export type VideoPlan = {
  concept:          string;
  hook:             string;
  script:           string;
  voiceoverCopy:    string;
  scenes:           VideoPlanScene[];
  brandDirection:   string;
  cameraDirection:  string;
  audioDirection:   string;
  onScreenTextNotes: string;
  cta:              string;
  finalVeoPrompt:   string;
};

export type PlanVideoInput = {
  brief:           string;
  objective:       string;
  platform:        string;
  cta:             string;
  aspectRatio:     string;
  durationSeconds: number;
  generateAudio:   boolean;
  brand:           BrandContext;
  campaignContext?: string;
  adjustmentNote?: string;   // set when the user asks for prompt adjustments
  previousPlan?:   VideoPlan | null;
  workspaceId:     string;
};

// ── Brand context retrieval ───────────────────────────────────────────────────

/** Load the workspace Business DNA into a compact brand context for planning. */
export async function loadBrandContext(sb: any, workspaceId: string): Promise<BrandContext> {
  const { data } = await sb
    .from("growthmind_business_dna")
    .select("company_name, website, industry, products, services, offers, ideal_customer_profiles, target_markets, unique_selling_points, brand_voice, compliance_notes")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  const d = data ?? {};
  return {
    companyName:     d.company_name ?? "",
    website:         d.website ?? "",
    industry:        d.industry ?? "",
    products:        d.products ?? "",
    services:        d.services ?? "",
    offers:          d.offers ?? "",
    targetAudience:  [d.ideal_customer_profiles, d.target_markets].filter(Boolean).join(" · "),
    usps:            d.unique_selling_points ?? "",
    brandVoice:      d.brand_voice ?? "",
    complianceNotes: d.compliance_notes ?? "",
    hasDna:          Boolean(data),
  };
}

// ── Planning ──────────────────────────────────────────────────────────────────

const PLANNING_ROLE = DEFAULT_ROLE_ASSIGNMENTS.growthmind_video_planning;

export async function planVideoCreative(input: PlanVideoInput): Promise<{ plan: VideoPlan; model: string }> {
  const apiKey = process.env.GEMINI_API_KEY ?? "";
  if (!apiKey) throw new Error("The video planning engine isn't configured yet. Ask your administrator to add the Gemini API key.");

  const model = process.env[PLANNING_ROLE.envVar] || PLANNING_ROLE.model;
  const b = input.brand;

  const brandBlock = b.hasDna
    ? `## Business DNA (use this — every creative decision must fit this brand)
Company: ${b.companyName || "n/a"} (${b.website || "no website"})
Industry: ${b.industry || "n/a"}
Products: ${b.products || "n/a"}
Services: ${b.services || "n/a"}
Offers: ${b.offers || "n/a"}
Target audience: ${b.targetAudience || "n/a"}
Unique selling points: ${b.usps || "n/a"}
Brand voice / style: ${b.brandVoice || "n/a"}
Approved & prohibited claims (STRICT — never violate): ${b.complianceNotes || "none recorded"}`
    : `## Business DNA
No Business DNA is recorded for this workspace — derive brand cues from the brief only and keep claims generic and safe.`;

  const system = `You are GrowthMind's video creative director. You produce production-ready creative plans for AI video generation (Google Veo 3.1).

${brandBlock}

${input.campaignContext ? `## Campaign context\n${input.campaignContext}\n` : ""}
## Output rules
- The video is ${input.durationSeconds} seconds, aspect ratio ${input.aspectRatio}, platform: ${input.platform}.
- ${input.generateAudio ? "The video WILL have native AI audio — write audio direction (music mood, ambient sound, spoken dialogue if any) into the plan and the final prompt." : "The video will be silent — do not rely on audio."}
- The finalVeoPrompt must be ONE self-contained cinematic prompt: subject, action, setting, camera movement, lighting, style, brand colours/elements, audio direction. It is sent verbatim to the video model.
- Never invent claims outside the approved claims list. Respect prohibited claims absolutely.
- Respond ONLY with valid JSON (no markdown fences):
{
  "concept": "one-paragraph creative concept",
  "hook": "what happens in the first 2 seconds to stop the scroll",
  "script": "full script (visuals + words)",
  "voiceoverCopy": "clean spoken words only",
  "scenes": [{ "scene": 1, "duration": 4, "shot": "camera direction", "visual": "what we see", "voiceover": "words", "onScreenText": "overlay text" }],
  "brandDirection": "colours, style, tone to enforce",
  "cameraDirection": "overall camera language",
  "audioDirection": "music / sound / dialogue direction",
  "onScreenTextNotes": "how text overlays should look",
  "cta": "final call to action",
  "finalVeoPrompt": "the single master prompt for the video model"
}`;

  const user = [
    `CREATIVE BRIEF: ${input.brief}`,
    `OBJECTIVE: ${input.objective || "Not specified"}`,
    `CALL TO ACTION: ${input.cta || "Derive from brief"}`,
    input.adjustmentNote
      ? `\n## Adjustment requested by the user\n${input.adjustmentNote}\n\nPrevious plan (improve on it, keep what works):\n${JSON.stringify(input.previousPlan ?? {}).slice(0, 6000)}`
      : "",
  ].filter(Boolean).join("\n");

  const result = await geminiGenerate({
    system,
    user,
    model,
    maxTokens: 4000,
    apiKey,
    usage: {
      workspaceId: input.workspaceId,
      department:  "growthmind",
      feature:     "video_planning",
    },
  });

  let parsed: any;
  try {
    const cleaned = result.text.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error("The planning engine returned an unreadable plan. Please try again.");
  }

  const scenes: VideoPlanScene[] = (parsed.scenes ?? []).map((s: any, i: number) => ({
    scene:        Number(s.scene ?? i + 1),
    duration:     Number(s.duration ?? Math.ceil(input.durationSeconds / Math.max(1, (parsed.scenes ?? []).length))),
    shot:         String(s.shot ?? ""),
    visual:       String(s.visual ?? ""),
    voiceover:    String(s.voiceover ?? ""),
    onScreenText: String(s.onScreenText ?? s.on_screen_text ?? ""),
  }));

  const plan: VideoPlan = {
    concept:           String(parsed.concept ?? ""),
    hook:              String(parsed.hook ?? ""),
    script:            String(parsed.script ?? ""),
    voiceoverCopy:     String(parsed.voiceoverCopy ?? parsed.script ?? ""),
    scenes,
    brandDirection:    String(parsed.brandDirection ?? ""),
    cameraDirection:   String(parsed.cameraDirection ?? ""),
    audioDirection:    String(parsed.audioDirection ?? ""),
    onScreenTextNotes: String(parsed.onScreenTextNotes ?? ""),
    cta:               String(parsed.cta ?? input.cta ?? ""),
    finalVeoPrompt:    String(parsed.finalVeoPrompt ?? "").trim(),
  };

  if (!plan.finalVeoPrompt) {
    throw new Error("The planning engine didn't produce a render prompt. Please try again.");
  }

  return { plan, model };
}
