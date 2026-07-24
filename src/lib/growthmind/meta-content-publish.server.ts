// ── Meta content publishing service — SERVER ONLY ────────────────────────────
// Idempotent Instagram reel/feed + Facebook Page publishing for approved
// GrowthMind content projects.
//
//   approveContentProjectPublish — called from the HiveMind action executor
//     (explicit approval) OR the operator auto-exec path. Marks the project
//     approved, creates the idempotent publishing job (unique idempotency_key
//     prevents duplicates), and schedules or immediately runs it.
//   runContentPublishTick — background tick (dev Vite plugin + prod pg_cron
//     executor). Claims due jobs via CAS, publishes with exponential-backoff
//     retries, maps Graph API errors to human guidance.
//
// Graph flows:
//   IG reel : POST /{ig}/media {media_type:REELS, video_url, caption}
//             → poll /{creation}?fields=status_code → POST /{ig}/media_publish
//   IG feed : POST /{ig}/media {image_url|video_url, caption} → media_publish
//   FB page : POST /{page}/photos {url, message} | /{page}/videos {file_url,
//             description} | /{page}/feed {message}

import { createHash } from "crypto";
import { META_GRAPH_VERSION } from "./meta-oauth.functions";

type Sb = any;

const GRAPH = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
const MAX_CONTAINER_POLLS_PER_ATTEMPT = 12;   // × 5s = 60s per attempt
const RETRY_BASE_MINUTES = 5;                  // 5, 10, 20, 40… backoff

function nowIso() { return new Date().toISOString(); }

async function getAdmin(): Promise<Sb> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

// ── Validation ────────────────────────────────────────────────────────────────

export interface PublishValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
  checkedAt: string;
}

export async function validatePublishPreconditions(
  admin: Sb,
  workspaceId: string,
  project: Record<string, any>,
  connection: Record<string, any> | null,
  targetType: string,
): Promise<PublishValidation> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Approval / compliance state
  if (!["approved", "scheduled", "publishing"].includes(project.status)) {
    errors.push(`Project must be approved before publishing (currently "${project.status}").`);
  }
  if (!project.approved_version) errors.push("No approved content snapshot — re-submit for approval.");
  if ((project.inspiration as any)?.compliance?.blocked === true) {
    errors.push("Compliance checks blocked this adaptation — it cannot be published.");
  }

  // Connection
  if (!connection) errors.push("Social account connection not found.");
  else {
    if (connection.status !== "connected") errors.push(`Social account is ${connection.status}.`);
    if (!connection.access_token_encrypted) errors.push("Social account has no stored access token — reconnect it.");
    if (connection.token_expires_at && new Date(connection.token_expires_at).getTime() < Date.now()) {
      errors.push("The social account's access token has expired — reconnect the account.");
    }
    const perms: string[] = Array.isArray(connection.permissions) ? connection.permissions : [];
    if (connection.account_type === "instagram_business" && perms.length && !perms.includes("instagram_content_publish")) {
      errors.push("Missing instagram_content_publish permission — reconnect and grant publishing access.");
    }
    if (connection.account_type === "facebook_page" && perms.length && !perms.includes("pages_manage_posts")) {
      errors.push("Missing pages_manage_posts permission — reconnect and grant publishing access.");
    }
    if (connection.account_type === "facebook_page" && ["reel", "story"].includes(targetType)) {
      errors.push("Reels/stories publishing targets an Instagram professional account, not a Facebook Page.");
    }
  }

  // Media
  const mediaUrl: string = project.media_url ?? "";
  if (!mediaUrl) errors.push("No media attached.");
  else if (!/^https:\/\//i.test(mediaUrl)) {
    errors.push("Media must be hosted on a public https:// URL for Meta to fetch it.");
  }
  if (targetType === "reel" && project.media_type !== "video") errors.push("Reels require a video.");
  if (targetType === "reel" && mediaUrl && !/\.(mp4|mov)(\?|$)/i.test(mediaUrl)) {
    warnings.push("Reel media should be an .mp4/.mov file — Meta may reject other formats.");
  }
  if (project.media_type === "image" && mediaUrl && !/\.(jpe?g|png)(\?|$)/i.test(mediaUrl)) {
    warnings.push("Feed images should be JPEG/PNG — Meta may reject other formats.");
  }

  // Caption
  const caption = buildCaption(project);
  if (!caption.trim()) errors.push("Caption is empty.");
  if (caption.length > 2200) errors.push(`Caption is ${caption.length} characters — Meta's limit is 2,200.`);
  const hashtagCount = (caption.match(/#[\w]+/g) ?? []).length;
  if (hashtagCount > 30) errors.push(`Caption has ${hashtagCount} hashtags — Meta allows at most 30.`);

  // Duplicate prevention beyond idempotency: same media+caption already published recently.
  try {
    const contentHash = contentFingerprint(project);
    const { data: dupes } = await admin
      .from("growthmind_publishing_jobs")
      .select("id, status, created_at")
      .eq("workspace_id", workspaceId)
      .eq("status", "published")
      .contains("payload", { content_fingerprint: contentHash })
      .gte("created_at", new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString())
      .limit(1);
    if (dupes?.length) errors.push("Identical content was already published in the last 7 days (duplicate prevention).");
  } catch { /* contains() on jsonb may be unsupported for odd payloads — non-fatal */ }

  return { ok: errors.length === 0, errors, warnings, checkedAt: nowIso() };
}

function buildCaption(project: Record<string, any>): string {
  const approved = (project.approved_version ?? {}) as Record<string, any>;
  const caption  = String(approved.caption ?? project.caption ?? "");
  const tags     = Array.isArray(approved.hashtags ?? project.hashtags) ? (approved.hashtags ?? project.hashtags) : [];
  const tagLine  = tags.filter((t: any) => typeof t === "string" && t.trim()).join(" ");
  const full     = tagLine && !caption.includes(tagLine) ? `${caption}\n\n${tagLine}` : caption;
  return full.slice(0, 2200);
}

function contentFingerprint(project: Record<string, any>): string {
  return createHash("sha256")
    .update(`${project.media_url ?? ""}::${buildCaption(project)}`)
    .digest("hex");
}

export function buildIdempotencyKey(input: {
  workspaceId: string; projectId: string; connectionId: string;
  targetType: string; mediaUrl: string; caption: string;
}): string {
  return createHash("sha256")
    .update([input.workspaceId, input.projectId, input.connectionId, input.targetType, input.mediaUrl, input.caption].join("::"))
    .digest("hex");
}

// ── Approval → job creation (idempotent) ─────────────────────────────────────

export async function approveContentProjectPublish(
  admin: Sb,
  workspaceId: string,
  opts: { projectId: string; actionId: string; approvedBy: string; scheduledAt?: string | null },
): Promise<Record<string, any>> {
  const { data: project, error } = await admin
    .from("growthmind_content_projects").select("*")
    .eq("id", opts.projectId).eq("workspace_id", workspaceId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!project) throw new Error("Project not found");
  if (project.status !== "awaiting_approval") {
    throw new Error(`Project is "${project.status}" — approval can only be granted while awaiting approval.`);
  }

  const { data: connection } = await admin
    .from("growthmind_social_connections").select("*")
    .eq("id", project.target_connection_id).eq("workspace_id", workspaceId).maybeSingle();

  const targetType = project.format === "reel" ? "reel"
    : project.format === "story" ? "story"
    : connection?.account_type === "facebook_page" ? "page_post" : "feed";

  // Read the scheduled time preferring the action payload set at submission.
  let scheduledAt: string | null = opts.scheduledAt ?? null;
  if (!scheduledAt) {
    const { data: action } = await admin
      .from("hivemind_actions").select("action_payload")
      .eq("id", opts.actionId).eq("workspace_id", workspaceId).maybeSingle();
    const raw = (action?.action_payload as any)?.scheduled_at;
    if (typeof raw === "string" && raw) scheduledAt = raw;
  }

  // Validate BEFORE any state transition so a validation failure leaves the
  // project in awaiting_approval (recoverable) instead of stranding it in
  // "approved" with no job.
  const validation = await validatePublishPreconditions(
    admin, workspaceId, { ...project, status: "approved" }, connection, targetType,
  );
  if (!validation.ok) {
    throw new Error(`Publish blocked by validation: ${validation.errors.join(" | ")}`);
  }

  const { transitionProjectStatus } = await import("@/lib/growthmind/growthmind.content-projects");
  await transitionProjectStatus(admin, workspaceId, project.id, "approved", opts.approvedBy, "Publish approved", {
    approved_at: nowIso(), approved_by: opts.approvedBy,
  });

  const caption = buildCaption(project);
  const idempotencyKey = buildIdempotencyKey({
    workspaceId, projectId: project.id, connectionId: connection.id,
    targetType, mediaUrl: project.media_url, caption,
  });

  // Idempotent job creation — a live job with this key wins; only recreate
  // after a terminal cancel/fail.
  const { data: existing } = await admin
    .from("growthmind_publishing_jobs")
    .select("id, status")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  let jobId: string;
  if (existing && !["cancelled", "failed"].includes(existing.status)) {
    jobId = existing.id;
  } else {
    const insertRow = {
      workspace_id:      workspaceId,
      connection_id:     connection.id,
      recommendation_id: project.recommendation_id ?? null,
      project_id:        project.id,
      platform:          connection.account_type === "facebook_page" ? "facebook" : "instagram",
      target_type:       targetType,
      payload: {
        caption,
        media_url:  project.media_url,
        media_type: project.media_type,
        thumbnail_url: project.thumbnail_url ?? null,
        content_fingerprint: contentFingerprint(project),
        approval_action_id: opts.actionId,
      },
      validation,
      idempotency_key: idempotencyKey,
      scheduled_at:    scheduledAt ?? nowIso(),
      next_attempt_at: scheduledAt ?? nowIso(),
      status:          "scheduled",
      created_by:      opts.approvedBy,
    };
    const { data: job, error: jErr } = await admin
      .from("growthmind_publishing_jobs").insert(insertRow).select("id").single();
    if (jErr) {
      if (String(jErr.code) === "23505") {
        // Unique-key race: another request created it — reuse.
        const { data: raced } = await admin.from("growthmind_publishing_jobs")
          .select("id").eq("idempotency_key", idempotencyKey).single();
        jobId = raced.id;
      } else throw new Error(jErr.message);
    } else jobId = job.id;
  }

  await transitionProjectStatus(admin, workspaceId, project.id, "scheduled", opts.approvedBy,
    scheduledAt ? `Scheduled for ${scheduledAt}` : "Queued for immediate publish");
  try {
    await admin.from("growthmind_content_recommendations")
      .update({ status: "scheduled", updated_at: nowIso() })
      .eq("id", project.recommendation_id).eq("workspace_id", workspaceId);
  } catch { /* best-effort mirror */ }

  // Immediate publishes run right away (still idempotent — the tick would
  // otherwise pick it up within 5 minutes).
  let publishedNow = false;
  if (!scheduledAt || new Date(scheduledAt).getTime() <= Date.now()) {
    try {
      const r = await executePublishJob(admin, jobId);
      publishedNow = r.status === "published";
    } catch { /* tick retries with backoff */ }
  }

  return { job_id: jobId, scheduled_at: scheduledAt, published_now: publishedNow, validation };
}

// ── Error mapping ─────────────────────────────────────────────────────────────

interface GraphError { code: number | null; subcode: number | null; message: string }

function parseGraphError(json: any, fallback: string): GraphError {
  const e = json?.error ?? {};
  return {
    code:    typeof e.code === "number" ? e.code : null,
    subcode: typeof e.error_subcode === "number" ? e.error_subcode : null,
    message: String(e.message ?? fallback).slice(0, 500),
  };
}

function classifyGraphError(err: GraphError): { retryable: boolean; errorCode: string; guidance: string } {
  const c = err.code;
  if (c === 190) return { retryable: false, errorCode: "token_expired", guidance: "The Meta access token is invalid or expired. Reconnect the social account in GrowthMind → Social Connections, then re-approve the publish." };
  if (c === 200 || c === 10 || c === 3) return { retryable: false, errorCode: "missing_permission", guidance: "The connected account is missing a publishing permission. Reconnect and grant Instagram publishing / Page posting access." };
  if (c === 100) return { retryable: false, errorCode: "invalid_media", guidance: "Meta rejected the media or parameters. Check the media URL is public https, the format is MP4/MOV (reels) or JPEG/PNG (images), and the caption is valid." };
  if (c === 4 || c === 17 || c === 32 || c === 613) return { retryable: true, errorCode: "rate_limited", guidance: "Meta rate limit hit — the job will retry automatically with backoff." };
  if (c === 1 || c === 2 || c === null) return { retryable: true, errorCode: "transient", guidance: "Temporary Meta API problem — the job will retry automatically." };
  return { retryable: false, errorCode: `graph_${c}`, guidance: `Meta error ${c}: ${err.message}` };
}

// ── Publish execution ─────────────────────────────────────────────────────────

async function graphPost(path: string, params: Record<string, string>): Promise<{ ok: boolean; json: any }> {
  const res = await fetch(`${GRAPH}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, json };
}

async function graphGet(path: string, params: Record<string, string>): Promise<{ ok: boolean; json: any }> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${GRAPH}/${path}?${qs}`);
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, json };
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Execute one publishing job. CAS-claims the row (scheduled → publishing) so
 * concurrent ticks / immediate-publish calls never double-post.
 */
export async function executePublishJob(admin: Sb, jobId: string): Promise<{ status: string; externalPostId?: string }> {
  // CAS claim
  const { data: claimed } = await admin
    .from("growthmind_publishing_jobs")
    .update({ status: "publishing", updated_at: nowIso() })
    .eq("id", jobId)
    .eq("status", "scheduled")
    .select("*");
  const job = (claimed ?? [])[0] as Record<string, any> | undefined;
  if (!job) {
    const { data: cur } = await admin.from("growthmind_publishing_jobs").select("status").eq("id", jobId).maybeSingle();
    return { status: cur?.status ?? "unknown" };
  }

  const workspaceId = job.workspace_id as string;
  const attemptNo = (job.attempts ?? 0) + 1;
  const history = Array.isArray(job.attempt_history) ? job.attempt_history : [];

  const fail = async (errorCode: string, message: string, guidance: string, retryable: boolean) => {
    const terminal = !retryable || attemptNo >= (job.max_attempts ?? 5);
    const backoffMin = RETRY_BASE_MINUTES * Math.pow(2, Math.max(0, attemptNo - 1));
    const update: Record<string, any> = {
      status:          terminal ? "failed" : "scheduled",
      attempts:        attemptNo,
      attempt_history: [...history, { attempt: attemptNo, at: nowIso(), outcome: "error", error_code: errorCode, message: message.slice(0, 500) }].slice(-20),
      last_error_code: errorCode,
      error_message:   message.slice(0, 1000),
      guidance,
      next_attempt_at: terminal ? null : new Date(Date.now() + backoffMin * 60_000).toISOString(),
      updated_at:      nowIso(),
    };
    await admin.from("growthmind_publishing_jobs").update(update).eq("id", jobId);
    if (terminal && job.project_id) {
      try {
        const { transitionProjectStatus } = await import("@/lib/growthmind/growthmind.content-projects");
        await transitionProjectStatus(admin, workspaceId, job.project_id, "failed", "system", `${errorCode}: ${guidance}`.slice(0, 500));
      } catch { /* project may be in another state */ }
    }
    return { status: terminal ? "failed" : "scheduled" };
  };

  const requeueInProgress = async (creationId: string) => {
    // Container still processing — NOT a failure; resume on the next tick.
    await admin.from("growthmind_publishing_jobs").update({
      status: "scheduled",
      payload: { ...job.payload, ig_creation_id: creationId },
      attempt_history: [...history, { attempt: attemptNo, at: nowIso(), outcome: "container_processing", creation_id: creationId }].slice(-20),
      next_attempt_at: new Date(Date.now() + 2 * 60_000).toISOString(),
      updated_at: nowIso(),
    }).eq("id", jobId);
    return { status: "scheduled" };
  };

  try {
    // Load + decrypt connection token
    const { data: conn } = await admin
      .from("growthmind_social_connections").select("*")
      .eq("id", job.connection_id).eq("workspace_id", workspaceId).maybeSingle();
    if (!conn || conn.status !== "connected" || !conn.access_token_encrypted) {
      return await fail("connection_unavailable", "Social connection missing, disconnected or token-less.",
        "Reconnect the social account, then re-approve the publish.", false);
    }
    let token: string;
    try {
      const { decryptMetaToken } = await import("@/lib/growthmind/meta-token.server");
      token = decryptMetaToken(conn.access_token_encrypted);
    } catch {
      return await fail("token_undecryptable", "Stored access token could not be decrypted.",
        "Reconnect the social account to store a fresh token.", false);
    }

    // Re-validate right before the external call (project may have changed).
    if (job.project_id) {
      const { data: project } = await admin
        .from("growthmind_content_projects").select("*")
        .eq("id", job.project_id).eq("workspace_id", workspaceId).maybeSingle();
      if (!project || !["scheduled", "publishing", "approved"].includes(project.status)) {
        return await fail("project_state", `Project is no longer publishable (${project?.status ?? "missing"}).`,
          "Re-approve the project to publish it.", false);
      }
      try {
        const { transitionProjectStatus } = await import("@/lib/growthmind/growthmind.content-projects");
        if (project.status !== "publishing") {
          await transitionProjectStatus(admin, workspaceId, project.id, "publishing", "system");
        }
      } catch { /* non-fatal */ }
    }

    const payload   = (job.payload ?? {}) as Record<string, any>;
    const caption   = String(payload.caption ?? "");
    const mediaUrl  = String(payload.media_url ?? "");
    const accountId = String(conn.external_account_id ?? "");
    let externalPostId = "";
    let permalink: string | null = null;

    if (job.platform === "instagram") {
      // 1. Create (or resume) the media container
      let creationId = typeof payload.ig_creation_id === "string" ? payload.ig_creation_id : "";
      if (!creationId) {
        const containerParams: Record<string, string> =
          job.target_type === "reel"
            ? { media_type: "REELS", video_url: mediaUrl, caption, share_to_feed: "true", access_token: token }
            : job.target_type === "story"
              ? (payload.media_type === "video"
                  ? { media_type: "STORIES", video_url: mediaUrl, access_token: token }
                  : { media_type: "STORIES", image_url: mediaUrl, access_token: token })
              : payload.media_type === "video"
                ? { media_type: "REELS", video_url: mediaUrl, caption, share_to_feed: "true", access_token: token }
                : { image_url: mediaUrl, caption, access_token: token };
        if (payload.thumbnail_url && job.target_type === "reel") containerParams.cover_url = String(payload.thumbnail_url);
        const created = await graphPost(`${accountId}/media`, containerParams);
        if (!created.ok || !created.json?.id) {
          const err = parseGraphError(created.json, "Container creation failed");
          const cls = classifyGraphError(err);
          return await fail(cls.errorCode, err.message, cls.guidance, cls.retryable);
        }
        creationId = String(created.json.id);
      }

      // 2. Poll container status (videos process asynchronously)
      let ready = payload.media_type !== "video" && job.target_type !== "reel";
      for (let i = 0; !ready && i < MAX_CONTAINER_POLLS_PER_ATTEMPT; i++) {
        const st = await graphGet(creationId, { fields: "status_code", access_token: token });
        const code = st.json?.status_code;
        if (code === "FINISHED") { ready = true; break; }
        if (code === "ERROR") {
          const err = parseGraphError(st.json, "Media container failed processing");
          return await fail("container_error", err.message,
            "Meta could not process the media. Check the video is a valid MP4/MOV under 90s for reels, then retry.", false);
        }
        await sleep(5000);
      }
      if (!ready) return await requeueInProgress(creationId);

      // 3. Publish
      const published = await graphPost(`${accountId}/media_publish`, { creation_id: creationId, access_token: token });
      if (!published.ok || !published.json?.id) {
        const err = parseGraphError(published.json, "media_publish failed");
        const cls = classifyGraphError(err);
        // Keep the creation id so a retry never re-creates the container (idempotency).
        await admin.from("growthmind_publishing_jobs").update({
          payload: { ...payload, ig_creation_id: creationId }, updated_at: nowIso(),
        }).eq("id", jobId);
        return await fail(cls.errorCode, err.message, cls.guidance, cls.retryable);
      }
      externalPostId = String(published.json.id);
      const perma = await graphGet(externalPostId, { fields: "permalink", access_token: token });
      permalink = typeof perma.json?.permalink === "string" ? perma.json.permalink : null;
    } else {
      // Facebook Page
      const isVideo = payload.media_type === "video";
      const path = isVideo ? `${accountId}/videos` : mediaUrl ? `${accountId}/photos` : `${accountId}/feed`;
      const params: Record<string, string> = isVideo
        ? { file_url: mediaUrl, description: caption, access_token: token }
        : mediaUrl
          ? { url: mediaUrl, caption, access_token: token }
          : { message: caption, access_token: token };
      const posted = await graphPost(path, params);
      const postId = posted.json?.post_id ?? posted.json?.id;
      if (!posted.ok || !postId) {
        const err = parseGraphError(posted.json, "Page post failed");
        const cls = classifyGraphError(err);
        return await fail(cls.errorCode, err.message, cls.guidance, cls.retryable);
      }
      externalPostId = String(postId);
      const perma = await graphGet(externalPostId, { fields: "permalink_url", access_token: token });
      permalink = typeof perma.json?.permalink_url === "string" ? perma.json.permalink_url : null;
    }

    // Success
    await admin.from("growthmind_publishing_jobs").update({
      status:             "published",
      external_post_id:   externalPostId,
      external_permalink: permalink,
      published_at:       nowIso(),
      attempts:           attemptNo,
      attempt_history:    [...history, { attempt: attemptNo, at: nowIso(), outcome: "published", external_post_id: externalPostId }].slice(-20),
      last_error_code:    null,
      error_message:      null,
      guidance:           null,
      next_attempt_at:    null,
      updated_at:         nowIso(),
    }).eq("id", jobId);

    if (job.project_id) {
      try {
        const { transitionProjectStatus } = await import("@/lib/growthmind/growthmind.content-projects");
        await transitionProjectStatus(admin, workspaceId, job.project_id, "published", "system", `Published (${externalPostId})`);
      } catch { /* non-fatal */ }
      try {
        await admin.from("growthmind_content_recommendations")
          .update({ status: "published", updated_at: nowIso() })
          .eq("id", job.recommendation_id).eq("workspace_id", workspaceId);
        await admin.from("growthmind_content_links")
          .update({ status: "completed", updated_at: nowIso() })
          .eq("workspace_id", workspaceId).eq("studio_kind", "content_studio").eq("studio_ref_id", job.project_id);
      } catch { /* best-effort mirrors */ }
    }
    try {
      const { logGrowthMindActivity } = await import("@/lib/growthmind/growthmind.activity.server");
      await logGrowthMindActivity({
        workspaceId, actor: "growthmind", category: "content",
        action: "content.published",
        summary: `Published ${job.target_type} to ${job.platform} (${externalPostId})`,
        entityType: "growthmind_publishing_jobs", entityId: jobId,
      });
    } catch { /* best-effort */ }

    return { status: "published", externalPostId };
  } catch (err: any) {
    return await fail("unexpected", err?.message ?? String(err),
      "Unexpected error while publishing — the job will retry automatically.", true);
  }
}

// ── Background tick ───────────────────────────────────────────────────────────

/** Publish due jobs. Called from the dev Vite scheduler plugin and the prod campaign-executor endpoint. */
export async function runContentPublishTick(): Promise<{ processed: number; published: number }> {
  const admin = await getAdmin();
  const now = nowIso();
  const { data: due, error } = await admin
    .from("growthmind_publishing_jobs")
    .select("id")
    .eq("status", "scheduled")
    .lte("scheduled_at", now)
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${now}`)
    .order("scheduled_at", { ascending: true })
    .limit(10);
  if (error) {
    console.warn("[content-publish-tick] due query failed:", error.message);
    return { processed: 0, published: 0 };
  }
  let published = 0;
  for (const row of due ?? []) {
    try {
      const r = await executePublishJob(admin, row.id);
      if (r.status === "published") published++;
    } catch (e: any) {
      console.warn("[content-publish-tick] job failed:", row.id, e?.message);
    }
  }
  return { processed: (due ?? []).length, published };
}

/** Manual "retry now" from the project page — resets the backoff clock. */
export async function retryPublishJobNow(admin: Sb, workspaceId: string, jobId: string): Promise<{ status: string }> {
  const { data: job } = await admin
    .from("growthmind_publishing_jobs").select("id, status, attempts, max_attempts, project_id")
    .eq("id", jobId).eq("workspace_id", workspaceId).maybeSingle();
  if (!job) throw new Error("Publishing job not found");
  if (job.status === "published") return { status: "published" };
  if (!["failed", "scheduled"].includes(job.status)) throw new Error(`Job is ${job.status} — cannot retry now.`);

  // A terminal failure moved the project to "failed" — bring it back to a
  // publishable state before executing, or the state gate re-fails the retry.
  if (job.project_id) {
    const { data: project } = await admin
      .from("growthmind_content_projects").select("id, status")
      .eq("id", job.project_id).eq("workspace_id", workspaceId).maybeSingle();
    if (project?.status === "failed") {
      const { transitionProjectStatus } = await import("@/lib/growthmind/growthmind.content-projects");
      await transitionProjectStatus(admin, workspaceId, project.id, "scheduled", "user", "Manual publish retry");
    }
  }

  await admin.from("growthmind_publishing_jobs").update({
    status: "scheduled",
    attempts: job.status === "failed" ? 0 : job.attempts, // fresh budget after terminal failure
    next_attempt_at: nowIso(),
    updated_at: nowIso(),
  }).eq("id", jobId).eq("workspace_id", workspaceId);
  return await executePublishJob(admin, jobId);
}
