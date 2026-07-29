/**
 * Veo 3.1 LIVE premium render — phased runner (authorised spend).
 *
 * Sandbox command windows are short, so the live render is driven in phases:
 *   VEO_LIVE_PHASE=submit  → create fixture ws + job, consume approval, submit real render
 *   VEO_LIVE_PHASE=poll    → one completeRenderingJob pass; prints current status
 *   VEO_LIVE_PHASE=verify  → asserts ready + archive + cost + ledger, then cleans up
 *
 * Without VEO_LIVE_PHASE set, every test is skipped (no accidental spend).
 * State handoff: /tmp/veo31-live-job.json
 */
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { estimateVeoRenderCostUsd, VEO31_MODELS } from "@/lib/growthmind/veo31-capabilities.shared";
import { VeoProvider, resolveVeoConfig } from "@/lib/video/providers/veo.provider";
import { completeRenderingJob } from "@/lib/growthmind/video-job-poller";

const sb = supabaseAdmin as any;
const PHASE = process.env.VEO_LIVE_PHASE ?? "";
const STATE_FILE = "/tmp/veo31-live-job.json";

describe.skipIf(PHASE !== "submit")("live phase: submit", () => {
  it("creates job, consumes approval and submits the real premium render", async () => {
    const { data: profiles } = await sb.from("profiles").select("user_id").limit(1);
    const ownerUserId = profiles[0].user_id;
    const WS = randomUUID();

    await sb.from("workspaces").insert({
      id: WS, name: `veo31 live ${WS.slice(0, 8)}`, slug: `veo31-live-${WS.slice(0, 8)}`, owner_id: ownerUserId,
    });
    await sb.from("workspace_members").insert({ workspace_id: WS, user_id: ownerUserId, role: "owner" });

    const jobId = randomUUID();
    const { error: insErr } = await sb.from("growthmind_video_jobs").insert({
      id: jobId,
      workspace_id: WS,
      status: "awaiting_approval",
      prompt: "A glowing golden bee flying gracefully over a sleek futuristic office reception desk, warm cinematic lighting, shallow depth of field, gentle ambient hum",
      prompt_version: 1,
      plan: { concept: "live e2e premium render", hook: "test", scenes: [] },
      model: VEO31_MODELS.premium.model,
      quality_tier: "premium",
      generation_type: "text_to_video",
      aspect_ratio: "16:9",
      resolution: "720p",
      duration_seconds: 4,
      generate_audio: true,
      variations: 1,
      estimated_cost_usd: estimateVeoRenderCostUsd({ qualityTier: "premium", durationSeconds: 4, variations: 1, resolution: "720p" }),
    });
    expect(insErr).toBeNull();

    // Atomic approval consume (same predicate as the server fn)
    const nowIso = new Date().toISOString();
    const { data: claimed } = await sb.from("growthmind_video_jobs")
      .update({ status: "submitting", approved_by: ownerUserId, approved_at: nowIso, approval_consumed_at: nowIso, updated_at: nowIso })
      .eq("id", jobId).eq("status", "awaiting_approval").is("approval_consumed_at", null)
      .select("*");
    expect(claimed).toHaveLength(1);

    const veo = new VeoProvider(resolveVeoConfig({}));
    expect(veo.authMode).toBeTruthy();
    const result = await veo.generateVideo({
      prompt: claimed[0].prompt,
      model: claimed[0].model,
      aspectRatio: "16:9",
      durationSeconds: 4,
      resolution: "720p",
      sampleCount: 1,
      generateAudio: true,
    });
    expect(result.jobId).toBeTruthy();

    await sb.from("growthmind_video_jobs").update({
      status: "rendering", provider_operation_id: result.jobId, submitted_at: new Date().toISOString(),
    }).eq("id", jobId);

    writeFileSync(STATE_FILE, JSON.stringify({ jobId, WS }));
    console.log(`[live-submit] job=${jobId} ws=${WS} op=${result.jobId}`);
  }, 120_000);
});

describe.skipIf(PHASE !== "poll")("live phase: poll", () => {
  it("runs one poller pass", async () => {
    const { jobId } = JSON.parse(readFileSync(STATE_FILE, "utf8"));
    const { data: row } = await sb.from("growthmind_video_jobs").select("*").eq("id", jobId).single();
    if (["ready", "failed"].includes(row.status)) {
      console.log(`[live-poll] already settled: ${row.status}`);
      return;
    }
    const updated = await completeRenderingJob(sb, row);
    console.log(`[live-poll] status=${updated?.status ?? row.status} polls=${row.poll_count}`);
  }, 110_000);
});

describe.skipIf(PHASE !== "verify")("live phase: verify + cleanup", () => {
  it("asserts ready, archived, costed and ledgered — then cleans up", async () => {
    const { jobId, WS } = JSON.parse(readFileSync(STATE_FILE, "utf8"));
    const { data: job } = await sb.from("growthmind_video_jobs").select("*").eq("id", jobId).single();

    expect(job.status).toBe("ready");
    expect(job.output_url).toBeTruthy();
    expect(job.completed_at).toBeTruthy();
    expect(Number(job.actual_cost_usd)).toBeCloseTo(3.0, 2); // 4s × $0.75/s premium
    console.log(`[live-verify] output=${job.output_url}`);
    console.log(`[live-verify] storage=${job.output_storage_path}`);

    const { data: ledger } = await sb.from("ai_usage_ledger")
      .select("feature, status, video_seconds, requested_model")
      .eq("workspace_id", WS).eq("feature", "video_render");
    expect((ledger ?? []).some((l: any) => l.status === "success" && Number(l.video_seconds) === 4)).toBe(true);

    // Cleanup fixtures (keep nothing behind in shared dev/prod DB)
    await sb.from("ai_usage_ledger").delete().eq("workspace_id", WS);
    await sb.from("growthmind_video_jobs").delete().eq("workspace_id", WS);
    await sb.from("workspace_members").delete().eq("workspace_id", WS);
    await sb.from("workspaces").delete().eq("id", WS);
  }, 110_000);
});
