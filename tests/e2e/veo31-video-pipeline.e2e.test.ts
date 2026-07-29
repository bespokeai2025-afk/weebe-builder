/**
 * Veo 3.1 video pipeline (e2e, real DB + AUTHORISED live premium render).
 *
 * Verifies:
 *   • capability matrix: option validation + cost estimates (premium/draft)
 *   • job creation lands in awaiting_approval with a correct estimate
 *   • ATOMIC approval consume: exactly one CAS update wins; second consume
 *     is rejected (never double-charges)
 *   • cancelled / consumed jobs cannot be re-approved
 *   • LIVE premium render (user-authorised spend): submit via VeoProvider,
 *     complete via completeRenderingJob → ready + archived output +
 *     actual_cost + success ledger row
 *   • failed jobs are never auto-retried (retry semantics = NEW job)
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  validateVeoOptions,
  estimateVeoRenderCostUsd,
  friendlyJobStatus,
  VEO31_MODELS,
} from "@/lib/growthmind/veo31-capabilities.shared";
import { VeoProvider, resolveVeoConfig } from "@/lib/video/providers/veo.provider";
import { completeRenderingJob } from "@/lib/growthmind/video-job-poller";

const sb = supabaseAdmin as any;

const WS = randomUUID();
let ownerUserId: string;
const jobIds: string[] = [];

function baseJob(overrides: Record<string, any> = {}) {
  return {
    id: randomUUID(),
    workspace_id: WS,
    status: "awaiting_approval",
    prompt: "A glowing bee flying over a futuristic office reception desk, cinematic lighting, 4 seconds",
    prompt_version: 1,
    plan: { concept: "e2e test", hook: "test", scenes: [] },
    model: VEO31_MODELS.premium.model,
    quality_tier: "premium",
    generation_type: "text_to_video",
    aspect_ratio: "16:9",
    resolution: "720p",
    duration_seconds: 4,
    generate_audio: true,
    variations: 1,
    estimated_cost_usd: estimateVeoRenderCostUsd({
      qualityTier: "premium", durationSeconds: 4, variations: 1, resolution: "720p",
    }),
    ...overrides,
  };
}

/** Same CAS predicate the approve server fn uses — must be atomic. */
async function consumeApproval(jobId: string) {
  const nowIso = new Date().toISOString();
  const { data, error } = await sb
    .from("growthmind_video_jobs")
    .update({
      status: "submitting",
      approved_by: ownerUserId,
      approved_at: nowIso,
      approval_consumed_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", jobId)
    .eq("workspace_id", WS)
    .eq("status", "awaiting_approval")
    .is("approval_consumed_at", null)
    .select("*");
  if (error) throw error;
  return data ?? [];
}

beforeAll(async () => {
  const { data: profiles, error } = await sb.from("profiles").select("user_id").limit(1);
  if (error || !profiles?.length) throw new Error("Need an existing user for workspace fixture");
  ownerUserId = profiles[0].user_id;

  const { error: wErr } = await sb.from("workspaces").insert({
    id: WS,
    name: `veo31 e2e ${WS.slice(0, 8)}`,
    slug: `veo31-e2e-${WS.slice(0, 8)}`,
    owner_id: ownerUserId,
  });
  if (wErr) throw new Error(`fixture workspace insert failed: ${wErr.message}`);
  const { error: mErr } = await sb.from("workspace_members").insert({
    workspace_id: WS, user_id: ownerUserId, role: "owner",
  });
  if (mErr) throw new Error(`fixture membership insert failed: ${mErr.message}`);
}, 60_000);

afterAll(async () => {
  await sb.from("ai_usage_ledger").delete().eq("workspace_id", WS);
  await sb.from("growthmind_video_jobs").delete().eq("workspace_id", WS);
  await sb.from("workspace_members").delete().eq("workspace_id", WS);
  await sb.from("workspaces").delete().eq("id", WS);
}, 60_000);

describe("capability matrix", () => {
  it("accepts valid premium 720p and draft options", () => {
    expect(validateVeoOptions({
      qualityTier: "premium", generationType: "text_to_video", aspectRatio: "16:9",
      resolution: "720p", durationSeconds: 8, generateAudio: true, variations: 2,
    })).toHaveLength(0);
    expect(validateVeoOptions({
      qualityTier: "draft", generationType: "text_to_video", aspectRatio: "9:16",
      resolution: "720p", durationSeconds: 4, generateAudio: false, variations: 1,
    })).toHaveLength(0);
  });

  it("rejects unsupported combinations before any spend", () => {
    const bad = validateVeoOptions({
      qualityTier: "premium", generationType: "text_to_video", aspectRatio: "16:9",
      resolution: "4k" as any, durationSeconds: 8, generateAudio: true, variations: 1,
    });
    expect(bad.length).toBeGreaterThan(0);
    const badDur = validateVeoOptions({
      qualityTier: "premium", generationType: "text_to_video", aspectRatio: "16:9",
      resolution: "720p", durationSeconds: 30, generateAudio: true, variations: 1,
    });
    expect(badDur.length).toBeGreaterThan(0);
  });

  it("prices premium at $0.75/s and draft at $0.15/s", () => {
    expect(estimateVeoRenderCostUsd({ qualityTier: "premium", durationSeconds: 8, variations: 1, resolution: "720p" })).toBeCloseTo(6.0, 2);
    expect(estimateVeoRenderCostUsd({ qualityTier: "draft", durationSeconds: 8, variations: 1, resolution: "720p" })).toBeCloseTo(1.2, 2);
    expect(estimateVeoRenderCostUsd({ qualityTier: "premium", durationSeconds: 4, variations: 2, resolution: "720p" })).toBeCloseTo(6.0, 2);
  });

  it("maps statuses to friendly copy", () => {
    expect(friendlyJobStatus("awaiting_approval").toLowerCase()).toContain("approval");
    expect(friendlyJobStatus("rendering").length).toBeGreaterThan(0);
  });
});

describe("approval consume is atomic (never double-charge)", () => {
  it("only one concurrent consume wins", async () => {
    const row = baseJob();
    jobIds.push(row.id);
    const { error } = await sb.from("growthmind_video_jobs").insert(row);
    expect(error).toBeNull();

    const [a, b] = await Promise.all([consumeApproval(row.id), consumeApproval(row.id)]);
    const winners = (a.length ? 1 : 0) + (b.length ? 1 : 0);
    expect(winners).toBe(1);

    // A third attempt is also blocked.
    const c = await consumeApproval(row.id);
    expect(c).toHaveLength(0);

    const { data: after } = await sb.from("growthmind_video_jobs").select("status, approval_consumed_at").eq("id", row.id).single();
    expect(after.status).toBe("submitting");
    expect(after.approval_consumed_at).not.toBeNull();
  });

  it("cancelled jobs cannot be approved", async () => {
    const row = baseJob({ status: "cancelled" });
    jobIds.push(row.id);
    await sb.from("growthmind_video_jobs").insert(row);
    const res = await consumeApproval(row.id);
    expect(res).toHaveLength(0);
  });

  it("failed jobs stay failed — no auto-retry path flips them back", async () => {
    const row = baseJob({
      status: "failed",
      approval_consumed_at: new Date().toISOString(),
      failure_reason: "e2e synthetic failure",
    });
    jobIds.push(row.id);
    await sb.from("growthmind_video_jobs").insert(row);
    const res = await consumeApproval(row.id);
    expect(res).toHaveLength(0);
    const { data: after } = await sb.from("growthmind_video_jobs").select("status").eq("id", row.id).single();
    expect(after.status).toBe("failed");
  });
});

// Gated: requires VEO_LIVE=1 (real spend). As of 2026-07-29 the Google project
// behind GEMINI_API_KEY returns 403 PERMISSION_DENIED for ALL Veo models —
// re-run this once Veo access is restored on the Google account.
describe.skipIf(process.env.VEO_LIVE !== "1")("LIVE premium render (authorised spend)", () => {
  it("submits, renders, archives and ledgers a real Veo 3.1 premium video", async () => {
    const cfg = resolveVeoConfig({});
    const veo = new VeoProvider(cfg);
    expect(veo.authMode).toBeTruthy();

    const row = baseJob();
    jobIds.push(row.id);
    const { error: insErr } = await sb.from("growthmind_video_jobs").insert(row);
    expect(insErr).toBeNull();

    // Approve (consume) then submit — mirrors approveAndRenderVideoJob.
    const claimed = await consumeApproval(row.id);
    expect(claimed).toHaveLength(1);

    const result = await veo.generateVideo({
      prompt: row.prompt,
      model: row.model,
      aspectRatio: row.aspect_ratio,
      durationSeconds: row.duration_seconds,
      resolution: row.resolution,
      sampleCount: row.variations,
      generateAudio: row.generate_audio,
    });
    expect(result.jobId).toBeTruthy();

    await sb.from("growthmind_video_jobs").update({
      status: "rendering",
      provider_operation_id: result.jobId,
      submitted_at: new Date().toISOString(),
    }).eq("id", row.id);

    // Poll until settled (premium renders typically take 1–4 minutes).
    let final: any = null;
    const deadline = Date.now() + 8 * 60 * 1000;
    while (Date.now() < deadline) {
      const { data: current } = await sb.from("growthmind_video_jobs").select("*").eq("id", row.id).single();
      if (["ready", "failed"].includes(current.status)) { final = current; break; }
      const updated = await completeRenderingJob(sb, current);
      if (updated && ["ready", "failed"].includes(updated.status)) { final = updated; break; }
      await new Promise(r => setTimeout(r, 15_000));
    }

    expect(final, "render did not settle within 8 minutes").toBeTruthy();
    expect(final.status).toBe("ready");
    expect(final.output_url).toBeTruthy();
    expect(Number(final.actual_cost_usd)).toBeCloseTo(0.75 * 4, 2);
    expect(final.completed_at).toBeTruthy();

    // Ledger: a success video_render row with 4 video seconds.
    const { data: ledger } = await sb
      .from("ai_usage_ledger")
      .select("feature, status, video_seconds, requested_model")
      .eq("workspace_id", WS)
      .eq("feature", "video_render");
    expect((ledger ?? []).some((l: any) => l.status === "success" && Number(l.video_seconds) === 4)).toBe(true);
  }, 600_000);
});
