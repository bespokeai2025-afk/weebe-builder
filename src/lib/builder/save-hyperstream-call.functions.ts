import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { cacheDel } from "@/lib/cache/redis.server";

const BUCKET = "call-recordings";

async function ensureBucket() {
  const { data: buckets } = await supabaseAdmin.storage.listBuckets();
  const exists = (buckets ?? []).some((b) => b.name === BUCKET);
  if (!exists) {
    await supabaseAdmin.storage.createBucket(BUCKET, { public: true, fileSizeLimit: 52428800 });
  }
}

export const saveHyperStreamTestCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        agentId: z.string().nullable().optional(),
        agentName: z.string().nullable().optional(),
        durationSeconds: z.number().int().min(0).optional(),
        transcript: z.string().nullable().optional(),
        recordingBase64: z.string().nullable().optional(),
        recordingMimeType: z.string().default("audio/webm"),
        costUsd: z.number().nullable().optional(),
        disconnectionReason: z.string().nullable().optional(),
        channelType: z.string().nullable().optional(),
        sessionId: z.string().nullable().optional(),
        fromNumber: z.string().nullable().optional(),
        sentiment: z.enum(["positive", "neutral", "negative"]).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const sb = supabase as any;

    let recordingUrl: string | null = null;

    if (data.recordingBase64) {
      try {
        await ensureBucket();
        const callId = crypto.randomUUID();
        const ext = data.recordingMimeType.includes("ogg") ? "ogg" : "webm";
        const path = `${workspaceId}/${callId}.${ext}`;
        const buf = Buffer.from(data.recordingBase64, "base64");
        const { error: uploadError } = await supabaseAdmin.storage
          .from(BUCKET)
          .upload(path, buf, { contentType: data.recordingMimeType, upsert: false });
        if (!uploadError) {
          const { data: pub } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
          recordingUrl = pub?.publicUrl ?? null;
        } else {
          console.warn("[saveHyperStreamTestCall] upload failed:", uploadError.message);
        }
      } catch (e) {
        console.warn("[saveHyperStreamTestCall] storage error:", e);
      }
    }

    const now = new Date();
    const startedAt = new Date(now.getTime() - (data.durationSeconds ?? 0) * 1000);
    // NOTE: `provider` and `channel_type` columns require migration
    // supabase/migrations/20260613_calls_provider_channel.sql — apply via CLI.
    // Until then we use from_number="web" as a proxy for HyperStream calls.
    const row: Record<string, unknown> = {
      workspace_id: workspaceId,
      agent_id: data.agentId ?? null,
      agent_name: data.agentName ?? null,
      call_status: "completed",
      call_type: "outbound",
      to_number: "unknown",
      from_number: "web",
      started_at: startedAt.toISOString(),
      ended_at: now.toISOString(),
      duration_seconds: data.durationSeconds ?? null,
      transcript: data.transcript ?? null,
      recording_url: recordingUrl,
      disconnection_reason: data.disconnectionReason ?? null,
      sentiment: data.sentiment ?? null,
    };
    if (data.costUsd != null) {
      row.cost_cents = Math.round(data.costUsd * 100);
    }
    if (data.sessionId) {
      row.retell_call_id = data.sessionId;
    }

    const { data: inserted, error } = await sb.from("calls").insert(row).select("id").single();
    if (error) {
      console.error("[saveHyperStreamTestCall] insert error:", error.message);
      throw new Error(error.message);
    }

    cacheDel(
      `webee:hivemind:${workspaceId}:platform`,
      `webee:growthmind:${workspaceId}:platform`,
      `webee:dashboard:${workspaceId}:overview`,
    ).catch(() => {});

    return { id: inserted?.id ?? null, recordingUrl };
  });

export const updateCallSentiment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        callId: z.string(),
        sentiment: z.enum(["positive", "neutral", "negative"]).nullable(),
        callSummary: z.string().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const sb = supabase as any;
    const update: Record<string, unknown> = { sentiment: data.sentiment };
    if (data.callSummary !== undefined) update.call_summary = data.callSummary;
    const { error } = await sb
      .from("calls")
      .update(update)
      .eq("id", data.callId)
      .eq("workspace_id", workspaceId);
    if (error) console.warn("[updateCallSentiment] error:", error.message);
    return { ok: !error };
  });
