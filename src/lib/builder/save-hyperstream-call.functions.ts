import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

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

    const row = {
      workspace_id: workspaceId,
      agent_id: data.agentId ?? null,
      agent_name: data.agentName ?? null,
      call_status: "completed",
      call_type: "inbound",
      to_number: "unknown",
      from_number: null,
      started_at: new Date(Date.now() - (data.durationSeconds ?? 0) * 1000).toISOString(),
      ended_at: new Date().toISOString(),
      duration_seconds: data.durationSeconds ?? null,
      transcript: data.transcript ?? null,
      recording_url: recordingUrl,
      provider: "HYPERSTREAM",
    };

    const { data: inserted, error } = await sb.from("calls").insert(row).select("id").single();
    if (error) {
      console.error("[saveHyperStreamTestCall] insert error:", error.message);
      throw new Error(error.message);
    }

    return { id: inserted?.id ?? null, recordingUrl };
  });
