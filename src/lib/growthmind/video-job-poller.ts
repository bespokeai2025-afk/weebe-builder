/**
 * Video Job Poller — core logic.
 *
 * Scans growthmind_video_assets for rows whose video_url contains a pending
 * job sentinel ([veo3_job:…] or [runway_job:…]), polls the respective
 * provider API, and writes back the real video URL (or an error sentinel) when
 * the job settles.
 *
 * Called from:
 *   - video-job-poller.plugin.ts  (Vite dev — every 30 s)
 *   - src/routes/api/public/video-job-poller.ts  (pg_cron / production)
 */

import { createClient } from "@supabase/supabase-js";

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
  return videoUrl.startsWith("http://") || videoUrl.startsWith("https://") || videoUrl.startsWith("gs://");
}

// ── Veo 3 — poll a long-running operation ─────────────────────────────────────

async function pollVeo3Job(
  operationName: string,
  accessToken: string,
): Promise<{ done: false } | { done: true; videoUrl: string } | { done: true; error: string }> {
  try {
    const res = await fetch(
      `https://us-central1-aiplatform.googleapis.com/v1/${operationName}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      },
    );

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      return { done: true, error: `Veo 3 poll HTTP ${res.status}: ${text.slice(0, 200)}` };
    }

    const json = await res.json() as any;

    if (json.error) {
      return { done: true, error: json.error.message ?? JSON.stringify(json.error).slice(0, 200) };
    }

    if (!json.done) return { done: false };

    // Extract video URL from the response
    // Vertex AI predictLongRunning response: response.predictions[]
    const predictions = json.response?.predictions ?? [];
    for (const pred of predictions) {
      // Direct URL
      if (typeof pred === "string" && (pred.startsWith("http") || pred.startsWith("gs://"))) {
        return { done: true, videoUrl: pred };
      }
      // Object with videoUri or gcsUri
      const uri = pred?.videoUri ?? pred?.gcsUri ?? pred?.uri ?? pred?.url;
      if (typeof uri === "string") return { done: true, videoUrl: uri };
      // Sometimes it's bytes in bytesBase64Encoded — convert to data URL
      if (pred?.bytesBase64Encoded) {
        return { done: true, videoUrl: `data:video/mp4;base64,${pred.bytesBase64Encoded}` };
      }
    }

    // Fallback: log and treat as still running
    return { done: true, error: "Veo 3 completed but no video URL found in response" };
  } catch (e: any) {
    return { done: true, error: `Veo 3 poll exception: ${e?.message ?? String(e)}` };
  }
}

// ── Runway Gen-4 — poll a task ────────────────────────────────────────────────

async function pollRunwayJob(
  taskId: string,
  runwayKey: string,
): Promise<{ done: false } | { done: true; videoUrl: string } | { done: true; error: string }> {
  try {
    const res = await fetch(`https://api.dev.runwayml.com/v1/tasks/${taskId}`, {
      headers: {
        Authorization: `Bearer ${runwayKey}`,
        "X-Runway-Version": "2024-11-06",
      },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      return { done: true, error: `Runway poll HTTP ${res.status}: ${text.slice(0, 200)}` };
    }

    const json = await res.json() as any;
    const status: string = json.status ?? "";

    if (status === "PENDING" || status === "THROTTLED" || status === "RUNNING") {
      return { done: false };
    }

    if (status === "FAILED" || status === "CANCELLED") {
      return { done: true, error: json.failure ?? json.failureCode ?? `Runway task ${status.toLowerCase()}` };
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

// ── Main poller ───────────────────────────────────────────────────────────────

export type PollerResult = {
  checked: number;
  resolved: number;
  failed: number;
  errors: string[];
};

export async function runVideoJobPoller(): Promise<PollerResult> {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return { checked: 0, resolved: 0, failed: 0, errors: ["Missing Supabase credentials"] };
  }

  const sb = createClient(supabaseUrl, supabaseKey);

  // Fetch all assets with pending job sentinels (include workspace_id for per-workspace creds)
  const { data: rows, error: fetchErr } = await sb
    .from("growthmind_video_assets")
    .select("id, video_url, provider, workspace_id")
    .or("video_url.like.[veo3_job:%,video_url.like.[runway_job:%")
    .limit(50);

  if (fetchErr) {
    const isTableMissing =
      fetchErr.code === "PGRST205" ||
      (fetchErr.message?.includes("relation") && fetchErr.message?.includes("does not exist"));
    if (isTableMissing) return { checked: 0, resolved: 0, failed: 0, errors: [] };
    return { checked: 0, resolved: 0, failed: 0, errors: [fetchErr.message] };
  }

  const pending = (rows ?? []).filter((r: any) => isJobPending(r.video_url));

  // Pre-load per-workspace video credentials for all unique workspaces
  const workspaceIds = [...new Set(pending.map((r: any) => r.workspace_id).filter(Boolean))] as string[];
  const wsCredsMap: Record<string, { veoToken?: string; runwayKey?: string }> = {};

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
      const veoToken  = (veoRes.data?.credentials as any)?.accessToken?.trim() || "";
      const runwayKey = (runwayRes.data?.credentials as any)?.apiKey?.trim() || "";
      wsCredsMap[wsId] = { veoToken, runwayKey };
    }),
  );

  // Fall back to env vars when workspace creds are absent
  const globalVeoToken  = process.env.GOOGLE_CLOUD_ACCESS_TOKEN ?? "";
  const globalRunwayKey = process.env.RUNWAY_API_KEY ?? "";

  const result: PollerResult = { checked: pending.length, resolved: 0, failed: 0, errors: [] };

  await Promise.all(
    pending.map(async (row: any) => {
      const job = parseJobSentinel(row.video_url);
      if (!job) return;

      const wsCreds  = wsCredsMap[row.workspace_id] ?? {};

      let pollResult:
        | { done: false }
        | { done: true; videoUrl: string }
        | { done: true; error: string };

      if (job.type === "veo3") {
        const token = wsCreds.veoToken || globalVeoToken;
        if (!token) return; // Credentials not available yet — skip silently
        pollResult = await pollVeo3Job(job.jobId, token);
      } else {
        const key = wsCreds.runwayKey || globalRunwayKey;
        if (!key) return;
        pollResult = await pollRunwayJob(job.jobId, key);
      }

      if (!pollResult.done) return; // Still running

      const newUrl = "videoUrl" in pollResult
        ? pollResult.videoUrl
        : `[error:${pollResult.error}]`;

      const { error: updateErr } = await sb
        .from("growthmind_video_assets")
        .update({ video_url: newUrl })
        .eq("id", row.id);

      if (updateErr) {
        result.errors.push(`Failed to update ${row.id}: ${updateErr.message}`);
      } else if ("videoUrl" in pollResult) {
        result.resolved++;
      } else {
        result.failed++;
        result.errors.push(`${row.id}: ${"error" in pollResult ? pollResult.error : "unknown"}`);
      }
    }),
  );

  return result;
}
