/**
 * GrowthMind Veo 3.1 Video Pipeline — durable jobs + cost approval gate.
 *
 * Flow: plan (LLM, cheap) → job row `awaiting_approval` with an upfront cost
 * estimate → user approves → approval consumed ATOMICALLY (CAS) → paid Veo
 * render submitted → background poller completes the job.
 *
 * Money rules (non-negotiable):
 *  - No paid render is ever submitted without a consumed approval.
 *  - A consumed approval can never be reused — retries create a NEW job that
 *    needs a NEW approval.
 *  - Failed renders are never auto-retried.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { VeoProvider, resolveVeoConfig } from "@/lib/video/providers/veo.provider";
import { recordAiUsage } from "@/lib/ai/usage-ledger.server";
import {
  VEO31_MODELS, validateVeoOptions, estimateVeoRenderCostUsd, friendlyJobStatus,
  type VideoQualityTier, type VideoGenerationType, type VideoAspect, type VideoResolution,
} from "./veo31-capabilities.shared";
import { loadBrandContext, planVideoCreative, type VideoPlan } from "./video-planning-engine.server";

// ── Shared types ──────────────────────────────────────────────────────────────

export type VideoPipelineJob = {
  id:               string;
  status:           string;
  friendlyStatus:   string;
  plan:             VideoPlan | null;
  prompt:           string;
  promptVersion:    number;
  brandContext:     Record<string, unknown> | null;
  qualityTier:      VideoQualityTier;
  qualityLabel:     string;
  generationType:   VideoGenerationType;
  aspectRatio:      string;
  resolution:       string;
  durationSeconds:  number;
  generateAudio:    boolean;
  variations:       number;
  estimatedCostUsd: number;
  actualCostUsd:    number | null;
  failureReason:    string | null;
  outputUrl:        string | null;
  campaignId:       string | null;
  createdAt:        string;
  approvedAt:       string | null;
  completedAt:      string | null;
};

function toJob(r: any): VideoPipelineJob {
  const tier: VideoQualityTier = r.quality_tier === "draft" ? "draft" : "premium";
  return {
    id:               r.id,
    status:           r.status,
    friendlyStatus:   friendlyJobStatus(r.status),
    plan:             r.plan ?? null,
    prompt:           r.prompt ?? "",
    promptVersion:    r.prompt_version ?? 1,
    brandContext:     r.brand_context ?? null,
    qualityTier:      tier,
    qualityLabel:     VEO31_MODELS[tier].friendlyLabel,
    generationType:   r.generation_type ?? "text_to_video",
    aspectRatio:      r.aspect_ratio ?? "16:9",
    resolution:       r.resolution ?? "720p",
    durationSeconds:  r.duration_seconds ?? 8,
    generateAudio:    r.generate_audio ?? true,
    variations:       r.variations ?? 1,
    estimatedCostUsd: Number(r.estimated_cost_usd ?? 0),
    actualCostUsd:    r.actual_cost_usd != null ? Number(r.actual_cost_usd) : null,
    failureReason:    r.failure_reason ?? null,
    outputUrl:        r.output_storage_path ?? r.output_url ?? null,
    campaignId:       r.campaign_id ?? null,
    createdAt:        r.created_at,
    approvedAt:       r.approved_at ?? null,
    completedAt:      r.completed_at ?? null,
  };
}

const renderOptionsSchema = z.object({
  qualityTier:     z.enum(["premium", "draft"]),
  generationType:  z.enum(["text_to_video", "image_to_video", "frame_guidance"]).default("text_to_video"),
  aspectRatio:     z.enum(["16:9", "9:16", "1:1"]),
  resolution:      z.enum(["720p", "1080p"]),
  durationSeconds: z.number().int(),
  generateAudio:   z.boolean().default(true),
  variations:      z.number().int().min(1).max(4),
  referenceImageUrl:  z.string().nullish(),
  lastFrameImageUrl:  z.string().nullish(),
});

// ── Plan: create the creative package + durable job row ──────────────────────

const planSchema = z.object({
  brief:      z.string().min(3, "Tell us what the video should be about."),
  objective:  z.string().default(""),
  platform:   z.string().default("Meta"),
  cta:        z.string().default(""),
  campaignId: z.string().uuid().nullish(),
  options:    renderOptionsSchema,
});

export const planVideoPipelineJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => planSchema.parse(input))
  .handler(async ({ data, context }) => {
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const admin = supabaseAdmin as any;

    // Validate the option combination BEFORE any AI spend.
    const issues = validateVeoOptions({
      qualityTier:     data.options.qualityTier,
      generationType:  data.options.generationType,
      aspectRatio:     data.options.aspectRatio as VideoAspect,
      resolution:      data.options.resolution as VideoResolution,
      durationSeconds: data.options.durationSeconds,
      generateAudio:   data.options.generateAudio,
      variations:      data.options.variations,
    });
    if (issues.length > 0) {
      return { ok: false as const, issues, job: null };
    }
    if ((data.options.generationType === "image_to_video" && !data.options.referenceImageUrl) ||
        (data.options.generationType === "frame_guidance" && !data.options.lastFrameImageUrl)) {
      return {
        ok: false as const,
        issues: [{ field: "generationType", message: "This mode needs a reference image — upload one first, or switch to text-to-video." }],
        job: null,
      };
    }

    const brand = await loadBrandContext(admin, workspaceId);
    const { plan } = await planVideoCreative({
      brief:           data.brief,
      objective:       data.objective,
      platform:        data.platform,
      cta:             data.cta,
      aspectRatio:     data.options.aspectRatio,
      durationSeconds: data.options.durationSeconds,
      generateAudio:   data.options.generateAudio,
      brand,
      workspaceId,
    });

    const estimated = estimateVeoRenderCostUsd(data.options);
    const tierModel = VEO31_MODELS[data.options.qualityTier].model;

    const { data: row, error } = await admin
      .from("growthmind_video_jobs")
      .insert({
        workspace_id:         workspaceId,
        user_id:              (context as any).userId ?? null,
        campaign_id:          data.campaignId ?? null,
        plan,
        prompt:               plan.finalVeoPrompt,
        prompt_version:       1,
        brand_context:        {
          companyName: brand.companyName, industry: brand.industry,
          brandVoice: brand.brandVoice, hasDna: brand.hasDna,
        },
        provider:             "google_veo",
        model:                tierModel,
        quality_tier:         data.options.qualityTier,
        generation_type:      data.options.generationType,
        aspect_ratio:         data.options.aspectRatio,
        resolution:           data.options.resolution,
        duration_seconds:     data.options.durationSeconds,
        generate_audio:       data.options.generateAudio,
        variations:           data.options.variations,
        reference_image_url:  data.options.referenceImageUrl ?? null,
        last_frame_image_url: data.options.lastFrameImageUrl ?? null,
        status:               "awaiting_approval",
        estimated_cost_usd:   estimated,
      })
      .select("*")
      .single();

    if (error) throw new Error(`Could not save the video plan: ${error.message}`);
    return { ok: true as const, issues: [], job: toJob(row) };
  });

// ── Adjust prompt (pre-approval only — free, re-runs planning) ───────────────

const adjustSchema = z.object({
  jobId:          z.string().uuid(),
  adjustmentNote: z.string().min(3, "Tell us what to change."),
});

export const adjustVideoPipelinePrompt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => adjustSchema.parse(input))
  .handler(async ({ data, context }) => {
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const admin = supabaseAdmin as any;

    const { data: row } = await admin
      .from("growthmind_video_jobs")
      .select("*")
      .eq("id", data.jobId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (!row) throw new Error("Video job not found.");
    if (row.status !== "awaiting_approval") {
      throw new Error("This video has already been approved — create a new video to change the creative.");
    }

    const brand = await loadBrandContext(admin, workspaceId);
    const { plan } = await planVideoCreative({
      brief:           row.plan?.concept ?? "",
      objective:       "",
      platform:        "as before",
      cta:             row.plan?.cta ?? "",
      aspectRatio:     row.aspect_ratio,
      durationSeconds: row.duration_seconds,
      generateAudio:   row.generate_audio,
      brand,
      workspaceId,
      adjustmentNote:  data.adjustmentNote,
      previousPlan:    row.plan ?? null,
    });

    const { data: updated, error } = await admin
      .from("growthmind_video_jobs")
      .update({
        plan,
        prompt:         plan.finalVeoPrompt,
        prompt_version: (row.prompt_version ?? 1) + 1,
        updated_at:     new Date().toISOString(),
      })
      .eq("id", data.jobId)
      .eq("status", "awaiting_approval")   // guard: never mutate an approved/paid job
      .select("*")
      .single();
    if (error) throw new Error(`Could not update the plan: ${error.message}`);
    return toJob(updated);
  });

// ── Approve & render: ATOMIC approval consumption + paid submission ──────────

const approveSchema = z.object({
  jobId:            z.string().uuid(),
  confirmedCostUsd: z.number(),   // the estimate the user saw and confirmed
});

export const approveAndRenderVideoJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => approveSchema.parse(input))
  .handler(async ({ data, context }) => {
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const admin = supabaseAdmin as any;
    const nowIso = new Date().toISOString();

    // Re-read for estimate confirmation (defence against a stale UI estimate).
    const { data: pre } = await admin
      .from("growthmind_video_jobs")
      .select("id, status, estimated_cost_usd, model, prompt, aspect_ratio, resolution, duration_seconds, generate_audio, variations, generation_type, reference_image_url, last_frame_image_url")
      .eq("id", data.jobId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (!pre) throw new Error("Video job not found.");
    if (pre.status !== "awaiting_approval") {
      throw new Error("This video isn't awaiting approval — it may have already been approved or cancelled.");
    }
    if (Math.abs(Number(pre.estimated_cost_usd) - data.confirmedCostUsd) > 0.005) {
      throw new Error("The price changed since you last looked — please review the updated estimate and approve again.");
    }

    // Spend cap check BEFORE consuming the approval.
    const { enforceGenerationCap } = await import("@/lib/billing/generation-limits.server");
    await enforceGenerationCap(workspaceId, "video", Number(pre.estimated_cost_usd));

    // ── ATOMIC consume: exactly one caller can flip awaiting_approval → submitting.
    const { data: claimed, error: claimErr } = await admin
      .from("growthmind_video_jobs")
      .update({
        status:               "submitting",
        approved_by:          (context as any).userId ?? null,
        approved_at:          nowIso,
        approval_consumed_at: nowIso,
        updated_at:           nowIso,
      })
      .eq("id", data.jobId)
      .eq("workspace_id", workspaceId)
      .eq("status", "awaiting_approval")
      .is("approval_consumed_at", null)
      .select("*");
    if (claimErr) throw new Error(`Approval failed: ${claimErr.message}`);
    if (!claimed || claimed.length === 0) {
      throw new Error("This video was already approved (possibly in another tab) — check the job list.");
    }
    const job = claimed[0];

    // ── Submit the paid render. Failure here → failed, approval stays consumed.
    try {
      const { data: veoSettings } = await admin
        .from("provider_settings")
        .select("credentials")
        .eq("workspace_id", workspaceId)
        .eq("provider_category", "video")
        .eq("provider_name", "google_veo")
        .maybeSingle();
      const veoCfg = resolveVeoConfig((veoSettings?.credentials ?? {}) as Record<string, string>);
      const veo = new VeoProvider(veoCfg);
      if (!veo.authMode) {
        throw new Error("Video generation isn't configured — add a Gemini API key in Settings → Providers → Video.");
      }

      // Inline reference images if needed (image-to-video / frame guidance)
      const fetchAsBase64 = async (url: string): Promise<{ b64: string; mime: string }> => {
        // SSRF guard: user-supplied URL — block private hosts/IPs before fetching.
        const { assertSafePublicUrl } = await import("@/lib/growthmind/gads-deep-analysis.server");
        await assertSafePublicUrl(url);
        const resp = await fetch(url);
        if (!resp.ok) throw new Error("Couldn't load the reference image — please re-upload it.");
        const mime = resp.headers.get("content-type")?.split(";")[0] || "image/png";
        const buf = Buffer.from(await resp.arrayBuffer());
        return { b64: buf.toString("base64"), mime };
      };
      let refImage: { b64: string; mime: string } | null = null;
      let lastFrame: { b64: string; mime: string } | null = null;
      if (job.generation_type === "image_to_video" && job.reference_image_url) {
        refImage = await fetchAsBase64(job.reference_image_url);
      }
      if (job.generation_type === "frame_guidance" && job.last_frame_image_url) {
        lastFrame = await fetchAsBase64(job.last_frame_image_url);
      }

      const result = await veo.generateVideo({
        prompt:          job.prompt,
        model:           job.model,
        aspectRatio:     job.aspect_ratio,
        durationSeconds: job.duration_seconds,
        resolution:      job.resolution,
        sampleCount:     job.variations,
        generateAudio:   job.generate_audio,
        ...(refImage  ? { referenceImageBase64: refImage.b64,  referenceImageMime: refImage.mime }  : {}),
        ...(lastFrame ? { lastFrameBase64: lastFrame.b64, lastFrameMime: lastFrame.mime } : {}),
      });

      const { data: updated } = await admin
        .from("growthmind_video_jobs")
        .update({
          status:                "rendering",
          provider_operation_id: result.jobId,
          submitted_at:          new Date().toISOString(),
          updated_at:            new Date().toISOString(),
        })
        .eq("id", job.id)
        .select("*")
        .single();

      return toJob(updated ?? { ...job, status: "rendering", provider_operation_id: result.jobId });
    } catch (err: any) {
      const reason = String(err?.message ?? "Video submission failed").slice(0, 500);
      await admin
        .from("growthmind_video_jobs")
        .update({ status: "failed", failure_reason: reason, updated_at: new Date().toISOString() })
        .eq("id", job.id);
      // Ledger the failed submission attempt (no video seconds billed on rejection).
      await recordAiUsage({
        workspaceId, department: "growthmind", feature: "video_render",
        provider: "gemini", requestedModel: job.model,
        endpoint: ":predictLongRunning", status: "failed",
        errorMessage: reason, estimatedCostUsd: 0,
      });
      throw new Error(`We couldn't start the render: ${reason} Your approval was not reused — you can create a new render when ready.`);
    }
  });

// ── Retry (creates a NEW job that needs a NEW approval) ──────────────────────

const retrySchema = z.object({
  jobId:       z.string().uuid(),
  qualityTier: z.enum(["premium", "draft"]).nullish(),  // e.g. retry as cheaper draft
});

export const retryVideoPipelineJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => retrySchema.parse(input))
  .handler(async ({ data, context }) => {
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const admin = supabaseAdmin as any;

    const { data: src } = await admin
      .from("growthmind_video_jobs")
      .select("*")
      .eq("id", data.jobId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (!src) throw new Error("Video job not found.");
    if (src.status !== "failed" && src.status !== "cancelled") {
      throw new Error("Only failed or cancelled videos can be retried.");
    }

    const tier: VideoQualityTier = (data.qualityTier ?? src.quality_tier) === "draft" ? "draft" : "premium";
    const estimated = estimateVeoRenderCostUsd({
      qualityTier: tier, durationSeconds: src.duration_seconds,
      variations: src.variations, resolution: src.resolution,
    });

    const { data: row, error } = await admin
      .from("growthmind_video_jobs")
      .insert({
        workspace_id:         workspaceId,
        user_id:              (context as any).userId ?? null,
        campaign_id:          src.campaign_id,
        plan:                 src.plan,
        prompt:               src.prompt,
        prompt_version:       src.prompt_version,
        brand_context:        src.brand_context,
        provider:             "google_veo",
        model:                VEO31_MODELS[tier].model,
        quality_tier:         tier,
        generation_type:      src.generation_type,
        aspect_ratio:         src.aspect_ratio,
        resolution:           tier === "draft" && src.resolution === "1080p" ? "720p" : src.resolution,
        duration_seconds:     src.duration_seconds,
        generate_audio:       src.generate_audio,
        variations:           src.variations,
        reference_image_url:  src.reference_image_url,
        last_frame_image_url: src.last_frame_image_url,
        status:               "awaiting_approval",   // fresh approval required — never auto-retry paid work
        estimated_cost_usd:   estimated,
      })
      .select("*")
      .single();
    if (error) throw new Error(`Could not create the retry: ${error.message}`);
    return toJob(row);
  });

// ── Cancel (pre-render only) ──────────────────────────────────────────────────

export const cancelVideoPipelineJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ jobId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const admin = supabaseAdmin as any;
    const { data: rows, error } = await admin
      .from("growthmind_video_jobs")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", data.jobId)
      .eq("workspace_id", workspaceId)
      .in("status", ["planned", "awaiting_approval"])
      .select("id");
    if (error) throw new Error(error.message);
    if (!rows || rows.length === 0) throw new Error("This video can't be cancelled any more — it's already rendering or finished.");
    return { ok: true };
  });

// ── List / poll ───────────────────────────────────────────────────────────────

export const listVideoPipelineJobs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const sb = context.supabase as any;
    const { data } = await sb
      .from("growthmind_video_jobs")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(50);
    return (data ?? []).map(toJob);
  });

/** On-demand poll for a single rendering job (same logic as the background poller). */
export const pollVideoPipelineJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ jobId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const admin = supabaseAdmin as any;

    const { data: row } = await admin
      .from("growthmind_video_jobs")
      .select("*")
      .eq("id", data.jobId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (!row) throw new Error("Video job not found.");
    if (row.status !== "rendering" && row.status !== "archiving") return toJob(row);

    const { completeRenderingJob } = await import("./video-job-poller");
    const updated = await completeRenderingJob(admin, row);
    return toJob(updated ?? row);
  });
