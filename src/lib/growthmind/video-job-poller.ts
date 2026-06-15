/**
 * Video Job Poller — core logic.
 *
 * Scans growthmind_video_assets for rows whose video_url contains a pending
 * job sentinel ([veo3_job:…] or [runway_job:…]), polls the respective
 * provider API, and writes back the real video URL (or an error sentinel) when
 * the job settles.
 *
 * On completion, permanently archives the video to Supabase Storage
 * (bucket: gm-videos) so URLs never expire. Falls back to the raw provider URL
 * if storage is unavailable.
 *
 * Called from:
 *   - video-job-poller.plugin.ts  (Vite dev — every 30 s)
 *   - src/routes/api/public/video-job-poller.ts  (pg_cron / production)
 */

import { createClient } from "@supabase/supabase-js";
import { VeoProvider, resolveVeoConfig } from "../video/providers/veo.provider";

// ── Sentinel patterns ─────────────────────────────────────────────────────────

export function parseJobSentinel(
  videoUrl: string | null,
): { type: "veo3" | "runway"; jobId: string } | null {
  if (!videoUrl) return null;
  const veoMatch = videoUrl.match(/^\[veo3_job:(.+)\]$/);
  if (veoMatch) return { type: "veo3", jobId: veoMatch[1] };
  const rwayMatch = videoUrl.match(/^\[runway_job:(.+)\]$/);
  if (rwayMatch) return { type: "runway", jobId: rwayMatch[1] };
  return null;
}

export function isJobPending(videoUrl: string | null): boolean {
  return parseJobSentinel(videoUrl) !== null;
}

export function isJobError(videoUrl: string | null): boolean {
  return typeof videoUrl === "string" && videoUrl.startsWith("[error:");
}

export function parseErrorMessage(videoUrl: string): string {
  const m = videoUrl.match(/^\[error:(.+)\]$/s);
  return m ? m[1] : "Job failed";
}

export function isRealVideoUrl(videoUrl: string | null): boolean {
  if (!videoUrl) return false;
  return (
    videoUrl.startsWith("http://") ||
    videoUrl.startsWith("https://") ||
    videoUrl.startsWith("gs://") ||
    videoUrl.startsWith("data:video/") ||
    videoUrl === "__data_uri__"   // lazy-load marker set by getVideoAssets
  );
}

// ── Runway Gen-4 — poll a task ────────────────────────────────────────────────

async function pollRunwayJob(
  taskId:    string,
  runwayKey: string,
): Promise<{ done: false } | { done: true; videoUrl: string } | { done: true; error: string }> {
  try {
    const res = await fetch(`https://api.runwayml.com/v1/tasks/${taskId}`, {
      headers: {
        Authorization:     `Bearer ${runwayKey}`,
        "X-Runway-Version": "2024-11-06",
      },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      return { done: true, error: `Runway poll HTTP ${res.status}: ${text.slice(0, 200)}` };
    }

    const json   = await res.json() as any;
    const status: string = json.status ?? "";

    if (status === "PENDING" || status === "THROTTLED" || status === "RUNNING") {
      return { done: false };
    }

    if (status === "FAILED" || status === "CANCELLED") {
      return {
        done:  true,
        error: json.failure ?? json.failureCode ?? `Runway task ${status.toLowerCase()}`,
      };
    }

    if (status === "SUCCEEDED") {
      const output = json.output;
      const url = Array.isArray(output) ? output[0] : (typeof output === "string" ? output : null);
      if (url) return { done: true, videoUrl: url };
      return { done: true, error: "Runway succeeded but output URL missing" };
    }

    return { done: false };
  } catch (e: any) {
    return { done: true, error: `Runway poll exception: ${e?.message ?? String(e)}` };
  }
}

// ── Permanent video storage (GCS / data-URI / https → Supabase Storage) ───────

const STORAGE_BUCKET = "gm-videos";

async function archiveVideoToStorage(
  sb:          any,
  videoUrl:    string,
  workspaceId: string,
  assetId:     string,
  accessToken: string = "",
): Promise<string> {
  try {
    let bytes: Uint8Array | null = null;

    if (videoUrl.startsWith("data:video/")) {
      // Gemini API returns base64 inline video
      const b64 = videoUrl.split(",")[1] ?? "";
      bytes = Buffer.from(b64, "base64") as unknown as Uint8Array;

    } else if (videoUrl.startsWith("gs://")) {
      // Vertex AI GCS URI — download via GCS JSON API (requires access token)
      if (!accessToken) return videoUrl; // No token → leave as-is
      const withoutScheme = videoUrl.slice("gs://".length);
      const slashIdx = withoutScheme.indexOf("/");
      if (slashIdx === -1) return videoUrl;
      const bucket  = withoutScheme.slice(0, slashIdx);
      const object  = withoutScheme.slice(slashIdx + 1);
      const gcsUrl  = `https://storage.googleapis.com/download/storage/v1/b/${bucket}/o/${encodeURIComponent(object)}?alt=media`;
      const resp    = await fetch(gcsUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!resp.ok) return videoUrl;
      bytes = new Uint8Array(await resp.arrayBuffer());

    } else if (videoUrl.startsWith("https://") || videoUrl.startsWith("http://")) {
      // Runway / public HTTPS URL
      const resp = await fetch(videoUrl);
      if (!resp.ok) return videoUrl;
      bytes = new Uint8Array(await resp.arrayBuffer());

    } else {
      return videoUrl; // Unknown scheme — leave as-is
    }

    if (!bytes) return videoUrl;

    const storagePath = `${workspaceId}/${assetId}.mp4`;

    const { error: uploadErr } = await sb.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, bytes, { contentType: "video/mp4", upsert: true });

    if (uploadErr) {
      console.warn(`[video-poller] Storage upload failed (${uploadErr.message}) — saving raw URL`);
      return videoUrl;
    }

    const { data: urlData } = sb.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(storagePath);

    return urlData?.publicUrl ?? videoUrl;

  } catch (e: any) {
    console.warn(`[video-poller] archiveVideoToStorage exception: ${e?.message ?? e}`);
    return videoUrl; // Graceful degradation — original URL always wins on failure
  }
}

// ── Main poller ───────────────────────────────────────────────────────────────

export type PollerResult = {
  checked:  number;
  resolved: number;
  failed:   number;
  archived: number;
  errors:   string[];
};

export async function runVideoJobPoller(): Promise<PollerResult> {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return { checked: 0, resolved: 0, failed: 0, archived: 0, errors: ["Missing Supabase credentials"] };
  }

  const sb = createClient(supabaseUrl, supabaseKey);

  // Ensure the storage bucket exists (idempotent — safe to call every time)
  await Promise.resolve(
    sb.storage.createBucket(STORAGE_BUCKET, { public: true }),
  ).catch(() => {/* already exists or insufficient perms — ignore */});

  // Fetch all assets with pending job sentinels (include workspace_id for per-workspace creds)
  const { data: rows, error: fetchErr } = await sb
    .from("growthmind_video_assets")
    .select("id, video_url, provider, workspace_id, created_at")
    .or("video_url.like.[veo3_job:%,video_url.like.[runway_job:%")
    .limit(50);

  if (fetchErr) {
    const isTableMissing =
      fetchErr.code === "PGRST205" ||
      (fetchErr.message?.includes("relation") && fetchErr.message?.includes("does not exist"));
    if (isTableMissing) return { checked: 0, resolved: 0, failed: 0, archived: 0, errors: [] };
    return { checked: 0, resolved: 0, failed: 0, archived: 0, errors: [fetchErr.message] };
  }

  const JOB_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours — mark stale jobs as failed
  const now = Date.now();

  // Expire any jobs older than the timeout before polling so they don't clog the queue
  const timedOut = (rows ?? []).filter((r: any) => {
    if (!isJobPending(r.video_url)) return false;
    const age = r.created_at ? now - new Date(r.created_at).getTime() : 0;
    return age > JOB_TIMEOUT_MS;
  });

  if (timedOut.length > 0) {
    await Promise.all(
      timedOut.map((r: any) =>
        sb.from("growthmind_video_assets")
          .update({ video_url: "[error:Job timed out after 2 hours]" })
          .eq("id", r.id)
          .catch(() => {}),
      ),
    );
    console.warn(`[video-poller] Expired ${timedOut.length} stuck job(s) older than 2 hours`);
  }

  const pending = (rows ?? []).filter((r: any) => {
    if (!isJobPending(r.video_url)) return false;
    const age = r.created_at ? now - new Date(r.created_at).getTime() : 0;
    return age <= JOB_TIMEOUT_MS;
  });

  // Pre-load per-workspace video credentials for all unique workspaces
  const workspaceIds = [
    ...new Set(pending.map((r: any) => r.workspace_id).filter(Boolean)),
  ] as string[];

  const wsCredsMap: Record<string, {
    veoCreds:   Record<string, string>;
    runwayKey:  string;
  }> = {};

  await Promise.all(
    workspaceIds.map(async (wsId) => {
      const [veoRes, runwayRes] = await Promise.all([
        sb.from("provider_settings")
          .select("credentials")
          .eq("workspace_id", wsId)
          .eq("provider_category", "video")
          .eq("provider_name", "google_veo")
          .maybeSingle()
          .catch(() => ({ data: null })),
        sb.from("provider_settings")
          .select("credentials")
          .eq("workspace_id", wsId)
          .eq("provider_category", "video")
          .eq("provider_name", "runway")
          .maybeSingle()
          .catch(() => ({ data: null })),
      ]);
      const veoCreds  = (veoRes.data?.credentials  ?? {}) as Record<string, string>;
      const runwayKey = (runwayRes.data?.credentials as any)?.apiKey?.trim() || "";
      wsCredsMap[wsId] = { veoCreds, runwayKey };
    }),
  );

  // Global env-var fallbacks
  const globalRunwayKey = process.env.RUNWAY_API_KEY ?? "";

  const result: PollerResult = {
    checked:  pending.length,
    resolved: 0,
    failed:   0,
    archived: 0,
    errors:   [],
  };

  await Promise.all(
    pending.map(async (row: any) => {
      const job = parseJobSentinel(row.video_url);
      if (!job) return;

      const wsCreds  = wsCredsMap[row.workspace_id] ?? { veoCreds: {}, runwayKey: "" };
      const veoCfg   = resolveVeoConfig(wsCreds.veoCreds);
      const runwayKey= wsCreds.runwayKey || globalRunwayKey;

      let pollResult:
        | { done: false }
        | { done: true; videoUrl: string }
        | { done: true; error: string };

      if (job.type === "veo3") {
        const veo = new VeoProvider(veoCfg);
        if (!veo.authMode) return; // Credentials not configured — skip silently
        const veoStatus = await veo.getStatus(job.jobId);
        if (veoStatus.status === "processing" || veoStatus.status === "pending") {
          pollResult = { done: false };
        } else if (veoStatus.status === "completed") {
          pollResult = { done: true, videoUrl: veoStatus.videoUrl };
        } else {
          pollResult = { done: true, error: veoStatus.error ?? "Veo job failed" };
        }
      } else {
        if (!runwayKey) return;
        pollResult = await pollRunwayJob(job.jobId, runwayKey);
      }

      if (!pollResult.done) return; // Still running

      if ("videoUrl" in pollResult) {
        // Archive to permanent Supabase Storage before saving URL
        const accessToken = veoCfg.accessToken ?? "";
        const permanentUrl = await archiveVideoToStorage(
          sb,
          pollResult.videoUrl,
          row.workspace_id,
          row.id,
          accessToken,
        );

        const { error: updateErr } = await sb
          .from("growthmind_video_assets")
          .update({ video_url: permanentUrl })
          .eq("id", row.id);

        if (updateErr) {
          result.errors.push(`Failed to update ${row.id}: ${updateErr.message}`);
        } else {
          result.resolved++;
          if (permanentUrl !== pollResult.videoUrl) result.archived++;
        }
      } else {
        const errorSentinel = `[error:${"error" in pollResult ? pollResult.error : "Job failed"}]`;
        const { error: updateErr } = await sb
          .from("growthmind_video_assets")
          .update({ video_url: errorSentinel })
          .eq("id", row.id);

        if (updateErr) {
          result.errors.push(`Failed to update ${row.id}: ${updateErr.message}`);
        } else {
          result.failed++;
          result.errors.push(`${row.id}: ${"error" in pollResult ? pollResult.error : "unknown"}`);
        }
      }
    }),
  );

  // ── Re-archive any existing data:video/ URLs to Supabase Storage ─────────────
  // This happens when a previous poll succeeded but the bucket didn't exist yet.
  // Now that createBucket ran above, we can try again.
  try {
    const { data: dataUriRows } = await sb
      .from("growthmind_video_assets")
      .select("id, video_url, workspace_id")
      .like("video_url", "data:video/%")
      .limit(10);

    if (dataUriRows && dataUriRows.length > 0) {
      await Promise.all(
        dataUriRows.map(async (row: any) => {
          const permanentUrl = await archiveVideoToStorage(
            sb,
            row.video_url,
            row.workspace_id,
            row.id,
          );
          if (permanentUrl !== row.video_url) {
            await sb
              .from("growthmind_video_assets")
              .update({ video_url: permanentUrl })
              .eq("id", row.id)
              .catch(() => {});
            result.archived++;
          }
        }),
      );
    }
  } catch {
    // Re-archive sweep is best-effort
  }

  return result;
}
