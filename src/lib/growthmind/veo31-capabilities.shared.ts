// ── Veo 3.1 capability matrix (client-safe, no secrets) ──────────────────────
// Single source of truth for which render option combinations the available
// Veo 3.1 preview models support, with human-readable explanations for
// unsupported combinations. Shown to users BEFORE any paid generation.

import { VIDEO_SECOND_COSTS } from "@/lib/ai/model-registry.shared";

export type VideoQualityTier = "premium" | "draft";
export type VideoGenerationType = "text_to_video" | "image_to_video" | "frame_guidance";
export type VideoAspect = "16:9" | "9:16" | "1:1";
export type VideoResolution = "720p" | "1080p";

export const VEO31_MODELS: Record<VideoQualityTier, { model: string; friendlyLabel: string }> = {
  premium: { model: "veo-3.1-generate-preview",      friendlyLabel: "Veo 3.1 Premium" },
  draft:   { model: "veo-3.1-fast-generate-preview", friendlyLabel: "Veo 3.1 Fast Draft" },
};

export const VEO31_DURATIONS = [4, 6, 8] as const;
export const VEO31_MAX_VARIATIONS = 2;

export type VeoRenderOptions = {
  qualityTier:    VideoQualityTier;
  generationType: VideoGenerationType;
  aspectRatio:    VideoAspect;
  resolution:     VideoResolution;
  durationSeconds: number;
  generateAudio:  boolean;
  variations:     number;
};

export type CapabilityIssue = { field: string; message: string };

/**
 * Validate a render option combination against what the Veo 3.1 preview
 * models actually support. Returns friendly, human-readable issues —
 * these are shown to the user before generation, never raw provider errors.
 */
export function validateVeoOptions(o: VeoRenderOptions): CapabilityIssue[] {
  const issues: CapabilityIssue[] = [];

  if (o.aspectRatio === "1:1") {
    issues.push({
      field: "aspectRatio",
      message: "Square (1:1) video isn't supported by Veo 3.1 yet. Choose widescreen (16:9) or vertical (9:16) — you can crop to square in your editor afterwards.",
    });
  }
  if (o.resolution !== "720p" && o.resolution !== "1080p") {
    issues.push({
      field: "resolution",
      message: VEO31_4K_LIMITATION,
    });
  }
  if (o.resolution === "1080p" && o.aspectRatio !== "16:9") {
    issues.push({
      field: "resolution",
      message: "1080p is only available for widescreen (16:9) videos. Vertical videos render at 720p.",
    });
  }
  if (o.resolution === "1080p" && o.qualityTier === "draft") {
    issues.push({
      field: "resolution",
      message: "Fast Draft renders at 720p to keep costs low. Switch to Premium quality for 1080p.",
    });
  }
  if (!VEO31_DURATIONS.includes(o.durationSeconds as any)) {
    issues.push({
      field: "durationSeconds",
      message: "Veo 3.1 clips can be 4, 6 or 8 seconds long. For longer videos, generate multiple clips and combine them.",
    });
  }
  if (o.variations < 1 || o.variations > VEO31_MAX_VARIATIONS) {
    issues.push({
      field: "variations",
      message: `You can generate 1 or ${VEO31_MAX_VARIATIONS} variations per render.`,
    });
  }
  if (o.generationType === "image_to_video" || o.generationType === "frame_guidance") {
    // Supported — but requires a reference image, validated server-side.
  }
  return issues;
}

/** Why 4K isn't offered — surfaced in the UI as an explained limitation. */
export const VEO31_4K_LIMITATION =
  "4K output isn't available on the Veo 3.1 preview models we use. The highest supported resolution is 1080p (widescreen). We'll add 4K as soon as Google makes it available.";

/** Estimated render cost in USD for a given option set. */
export function estimateVeoRenderCostUsd(o: Pick<VeoRenderOptions, "qualityTier" | "durationSeconds" | "variations" | "resolution">): number {
  const model = VEO31_MODELS[o.qualityTier].model;
  const perSecond = VIDEO_SECOND_COSTS[model] ?? 0.75;
  // 1080p renders cost the same per-second on the preview models today; the
  // multiplier is kept explicit so a future price split is a one-line change.
  const resolutionMultiplier = 1;
  const usd = perSecond * o.durationSeconds * Math.max(1, o.variations) * resolutionMultiplier;
  return Math.round(usd * 10000) / 10000;
}

// ── Friendly status mapping ───────────────────────────────────────────────────

export const FRIENDLY_JOB_STATUS: Record<string, string> = {
  planning:          "Generating concept…",
  planned:           "Creative plan ready for review",
  awaiting_approval: "Waiting for your approval",
  approved:          "Approved — starting render",
  submitting:        "Sending to the video engine…",
  rendering:         "Generating your video…",
  archiving:         "Finishing up — saving your video…",
  ready:             "Ready",
  failed:            "Failed",
  cancelled:         "Cancelled",
};

export function friendlyJobStatus(status: string): string {
  return FRIENDLY_JOB_STATUS[status] ?? "Working…";
}
