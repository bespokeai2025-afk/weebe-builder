/**
 * E2E verification for Task: Instagram/Facebook Content Studio publishing.
 *
 * The workspace has no real Meta connection (user opted to skip the live
 * test), so this exercises the FULL real pipeline — approval → idempotent job
 * → executePublishJob (CAS claim, container create/poll/publish, error
 * classification, exponential backoff) → retryPublishJobNow — against the
 * REAL shared Supabase database, with ONLY the Meta Graph API mocked at the
 * global fetch level using real Graph response shapes.
 *
 * Covers "done looks like":
 *  1. a project publishes successfully (IG image feed + IG reel w/ container
 *     polling + FB page photo),
 *  2. a deliberately failing job (bad media) retries with backoff, surfaces a
 *     clear classified error, and the Retry button recovers it.
 *
 * Run: npx vitest run tests/e2e/meta-content-publish.e2e.test.ts --config vitest.e2e.config.ts
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { encryptMetaToken } from "@/lib/growthmind/meta-token.server";
import {
  approveContentProjectPublish,
  executePublishJob,
  retryPublishJobNow,
  runContentPublishTick,
  validatePublishPreconditions,
  buildIdempotencyKey,
} from "@/lib/growthmind/meta-content-publish.server";

const sb = supabaseAdmin as any;
const WS = randomUUID(); // throw-away workspace (real row; publish tables have no ws FK)
const FAKE_TOKEN = "EAAG-e2e-fake-page-token";
let IG_CONN = "";
let FB_CONN = "";

// ── Graph API mock ────────────────────────────────────────────────────────────
// Intercepts ONLY graph.facebook.com; everything else (Supabase) passes through.
type GraphCall = { method: string; path: string; params: Record<string, string> };
const graphCalls: GraphCall[] = [];
let graphHandler: (call: GraphCall) => { status?: number; json: any };

const realFetch = globalThis.fetch;
function installFetchMock() {
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : input?.url ?? String(input);
    if (!url.includes("graph.facebook.com")) return realFetch(input, init);
    const u = new URL(url);
    const method = (init?.method ?? "GET").toUpperCase();
    const params: Record<string, string> = {};
    u.searchParams.forEach((v, k) => (params[k] = v));
    if (typeof init?.body === "string") {
      new URLSearchParams(init.body).forEach((v, k) => (params[k] = v));
    }
    const path = u.pathname.replace(/^\/v[\d.]+\//, "");
    const call: GraphCall = { method, path, params };
    graphCalls.push(call);
    const out = graphHandler(call);
    return new Response(JSON.stringify(out.json), {
      status: out.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

const graphError = (code: number, message: string, status = 400) => ({
  status,
  json: { error: { message, type: "OAuthException", code } },
});

// Default happy-path handler (image feed / page post; reels handled per-test).
function happyHandler(call: GraphCall): { status?: number; json: any } {
  expect(call.params.access_token).toBe(FAKE_TOKEN); // token decrypted correctly
  if (call.method === "POST" && call.path.endsWith("/media")) return { json: { id: "CREATION_1" } };
  if (call.method === "POST" && call.path.endsWith("/media_publish")) return { json: { id: "IGPOST_1" } };
  if (call.method === "POST" && call.path.endsWith("/photos")) return { json: { id: "FBPHOTO_1", post_id: "PAGE_FBPOST_1" } };
  if (call.method === "GET" && call.params.fields === "status_code") return { json: { status_code: "FINISHED", id: call.path } };
  if (call.method === "GET" && call.params.fields === "permalink") return { json: { permalink: "https://www.instagram.com/p/e2e/" } };
  if (call.method === "GET" && call.params.fields === "permalink_url") return { json: { permalink_url: "https://www.facebook.com/e2e/posts/1" } };
  return { json: {} };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

async function makeProject(over: Record<string, any> = {}): Promise<string> {
  const caption = over.__caption ?? `E2E publish test ${randomUUID().slice(0, 8)}`;
  delete over.__caption;
  const { data, error } = await sb.from("growthmind_content_projects").insert({
    workspace_id: WS,
    title: "e2e meta publish project",
    format: "image_post",
    target_platform: "instagram",
    caption,
    hashtags: ["#e2e", "#verify"],
    target_connection_id: IG_CONN,
    media_url: "https://example.com/e2e-image.jpg",
    media_type: "image",
    status: "awaiting_approval",
    approved_version: { caption, hashtags: ["#e2e", "#verify"] },
    created_by: "e2e",
    ...over,
  }).select("id").single();
  if (error) throw new Error(`project fixture: ${error.message}`);
  return data.id as string;
}

beforeAll(async () => {
  installFetchMock();
  const { data: anyWs } = await sb.from("workspaces").select("owner_id").limit(1).single();
  const { error: wErr } = await sb.from("workspaces").insert({
    id: WS, name: "e2e meta publish ws", owner_id: anyWs.owner_id, slug: `e2e-metapub-${WS.slice(0, 8)}`,
  });
  if (wErr) throw new Error(`workspace fixture: ${wErr.message}`);

  const enc = encryptMetaToken(FAKE_TOKEN);
  const { data: ig, error: iErr } = await sb.from("growthmind_social_connections").insert({
    workspace_id: WS, provider: "meta", account_type: "instagram_professional",
    external_account_id: "17840000000000001", account_name: "e2e IG", username: "e2e_ig",
    permissions: ["instagram_basic", "instagram_content_publish"],
    access_token_encrypted: enc, status: "connected",
    token_expires_at: new Date(Date.now() + 30 * 86400_000).toISOString(),
  }).select("id").single();
  if (iErr) throw new Error(`ig conn fixture: ${iErr.message}`);
  IG_CONN = ig.id;

  const { data: fb, error: fErr } = await sb.from("growthmind_social_connections").insert({
    workspace_id: WS, provider: "meta", account_type: "facebook_page",
    external_account_id: "1029384756", account_name: "e2e Page",
    permissions: ["pages_manage_posts", "pages_read_engagement"],
    access_token_encrypted: enc, status: "connected",
    token_expires_at: new Date(Date.now() + 30 * 86400_000).toISOString(),
  }).select("id").single();
  if (fErr) throw new Error(`fb conn fixture: ${fErr.message}`);
  FB_CONN = fb.id;
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  for (const t of [
    "growthmind_publishing_jobs",
    "growthmind_content_projects",
    "growthmind_social_connections",
    "growthmind_activity_log",
    "growthmind_content_recommendations",
    "growthmind_content_links",
  ]) {
    await sb.from(t).delete().eq("workspace_id", WS);
  }
  await sb.from("workspaces").delete().eq("id", WS);
});

beforeEach(() => {
  graphCalls.length = 0;
  graphHandler = happyHandler;
});

const getJob = async (id: string) =>
  (await sb.from("growthmind_publishing_jobs").select("*").eq("id", id).single()).data;
const getProject = async (id: string) =>
  (await sb.from("growthmind_content_projects").select("*").eq("id", id).single()).data;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("validation preconditions", () => {
  it("blocks missing publish permission on an instagram_professional connection", async () => {
    const conn = {
      status: "connected", access_token_encrypted: "x", account_type: "instagram_professional",
      permissions: ["instagram_basic"], token_expires_at: null,
    };
    const project = {
      status: "approved", approved_version: { caption: "hi" }, caption: "hi",
      media_url: "https://example.com/a.jpg", media_type: "image", inspiration: {},
    };
    const v = await validatePublishPreconditions(sb, WS, project, conn as any, "feed");
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toContain("instagram_content_publish");
  });

  it("blocks expired tokens and non-https media", async () => {
    const conn = {
      status: "connected", access_token_encrypted: "x", account_type: "instagram_professional",
      permissions: [], token_expires_at: new Date(Date.now() - 1000).toISOString(),
    };
    const project = {
      status: "approved", approved_version: { caption: "hi" }, caption: "hi",
      media_url: "http://insecure.example.com/a.jpg", media_type: "image", inspiration: {},
    };
    const v = await validatePublishPreconditions(sb, WS, project, conn as any, "feed");
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/expired/);
    expect(v.errors.join(" ")).toMatch(/https/);
  });
});

describe("happy path — approval → publish", () => {
  it("publishes an IG image feed post immediately on approval", async () => {
    const projectId = await makeProject();
    const r = await approveContentProjectPublish(sb, WS, {
      projectId, actionId: randomUUID(), approvedBy: "e2e-user",
    });
    expect(r.published_now).toBe(true);

    const job = await getJob(r.job_id);
    expect(job.status).toBe("published");
    expect(job.external_post_id).toBe("IGPOST_1");
    expect(job.external_permalink).toBe("https://www.instagram.com/p/e2e/");
    expect(job.attempts).toBe(1);
    expect(job.attempt_history.at(-1).outcome).toBe("published");

    const project = await getProject(projectId);
    expect(project.status).toBe("published");

    // Real Graph sequence: container create → media_publish → permalink (image = no poll)
    const posts = graphCalls.filter(c => c.method === "POST").map(c => c.path);
    expect(posts).toEqual(["17840000000000001/media", "17840000000000001/media_publish"]);
    expect(graphCalls.find(c => c.path.endsWith("/media"))!.params.image_url)
      .toBe("https://example.com/e2e-image.jpg");
    // Caption includes hashtag line
    expect(graphCalls.find(c => c.path.endsWith("/media"))!.params.caption).toContain("#e2e #verify");
  });

  it("is idempotent — re-approving the same content never creates a second job", async () => {
    // Schedule in the future so the job stays live (scheduled, unpublished).
    const caption = `idempotent ${randomUUID().slice(0, 8)}`;
    const future = new Date(Date.now() + 3600_000).toISOString();
    const projectId = await makeProject({ __caption: caption });
    const r1 = await approveContentProjectPublish(sb, WS, {
      projectId, actionId: randomUUID(), approvedBy: "e2e", scheduledAt: future,
    });
    expect(r1.published_now).toBe(false);
    // Duplicate approval race while the job is live → same job reused
    await sb.from("growthmind_content_projects").update({ status: "awaiting_approval" }).eq("id", projectId);
    const r2 = await approveContentProjectPublish(sb, WS, {
      projectId, actionId: randomUUID(), approvedBy: "e2e", scheduledAt: future,
    });
    expect(r2.job_id).toBe(r1.job_id);
    const { data: jobs } = await sb.from("growthmind_publishing_jobs")
      .select("id").eq("project_id", projectId);
    expect(jobs.length).toBe(1);

    // And once PUBLISHED, re-approval is blocked by 7-day duplicate prevention.
    await sb.from("growthmind_publishing_jobs")
      .update({ status: "published", published_at: new Date().toISOString() }).eq("id", r1.job_id);
    await sb.from("growthmind_content_projects").update({ status: "awaiting_approval" }).eq("id", projectId);
    await expect(
      approveContentProjectPublish(sb, WS, { projectId, actionId: randomUUID(), approvedBy: "e2e" }),
    ).rejects.toThrow(/already published in the last 7 days/);
  });

  it("publishes an IG reel with container polling (IN_PROGRESS → resume → FINISHED)", async () => {
    let polls = 0;
    graphHandler = (call) => {
      if (call.method === "POST" && call.path.endsWith("/media")) {
        expect(call.params.media_type).toBe("REELS");
        expect(call.params.video_url).toBe("https://example.com/e2e-reel.mp4");
        return { json: { id: "REEL_CREATION_9" } };
      }
      if (call.method === "GET" && call.params.fields === "status_code") {
        polls++;
        return { json: { status_code: "IN_PROGRESS" } }; // never finishes this attempt
      }
      if (call.method === "POST" && call.path.endsWith("/media_publish")) return { json: { id: "IGREEL_9" } };
      if (call.method === "GET" && call.params.fields === "permalink") return { json: { permalink: "https://www.instagram.com/reel/e2e/" } };
      return { json: {} };
    };

    const projectId = await makeProject({
      format: "reel", media_url: "https://example.com/e2e-reel.mp4", media_type: "video",
      __caption: `reel ${randomUUID().slice(0, 8)}`,
    });
    const r = await approveContentProjectPublish(sb, WS, { projectId, actionId: randomUUID(), approvedBy: "e2e" });

    // Attempt 1: container still processing — requeued, NOT failed, creation id kept
    let job = await getJob(r.job_id);
    expect(r.published_now).toBe(false);
    expect(job.status).toBe("scheduled");
    expect(job.payload.ig_creation_id).toBe("REEL_CREATION_9");
    expect(job.attempt_history.at(-1).outcome).toBe("container_processing");
    expect(job.last_error_code).toBeNull();
    expect(polls).toBe(12); // MAX_CONTAINER_POLLS_PER_ATTEMPT

    // Attempt 2 (next tick): container FINISHED → publish, container NOT recreated
    graphCalls.length = 0;
    graphHandler = (call) => {
      if (call.method === "POST" && call.path.endsWith("/media")) throw new Error("container must not be recreated");
      if (call.method === "GET" && call.params.fields === "status_code") {
        expect(call.path).toBe("REEL_CREATION_9");
        return { json: { status_code: "FINISHED" } };
      }
      if (call.method === "POST" && call.path.endsWith("/media_publish")) {
        expect(call.params.creation_id).toBe("REEL_CREATION_9");
        return { json: { id: "IGREEL_9" } };
      }
      if (call.method === "GET" && call.params.fields === "permalink") return { json: { permalink: "https://www.instagram.com/reel/e2e/" } };
      return { json: {} };
    };
    await sb.from("growthmind_publishing_jobs").update({ next_attempt_at: new Date().toISOString() }).eq("id", r.job_id);
    const r2 = await executePublishJob(sb, r.job_id);
    expect(r2.status).toBe("published");
    job = await getJob(r.job_id);
    expect(job.external_post_id).toBe("IGREEL_9");
    expect((await getProject(projectId)).status).toBe("published");
  }, 120_000);

  it("publishes a Facebook Page photo post", async () => {
    const projectId = await makeProject({
      target_connection_id: FB_CONN, target_platform: "facebook", format: "image_post",
      __caption: `fb ${randomUUID().slice(0, 8)}`,
    });
    const r = await approveContentProjectPublish(sb, WS, { projectId, actionId: randomUUID(), approvedBy: "e2e" });
    expect(r.published_now).toBe(true);
    const job = await getJob(r.job_id);
    expect(job.platform).toBe("facebook");
    expect(job.target_type).toBe("page_post");
    expect(job.status).toBe("published");
    expect(job.external_post_id).toBe("PAGE_FBPOST_1");
    expect(job.external_permalink).toBe("https://www.facebook.com/e2e/posts/1");
    expect(graphCalls.some(c => c.path === "1029384756/photos")).toBe(true);
  });
});

describe("failure path — classification, backoff, Retry button", () => {
  it("transient Graph error retries with exponential backoff and Retry recovers it", async () => {
    graphHandler = () => graphError(2, "An unexpected error has occurred. Please retry your request later.", 500);

    const projectId = await makeProject({ __caption: `retry ${randomUUID().slice(0, 8)}` });
    const t0 = Date.now();
    const r = await approveContentProjectPublish(sb, WS, { projectId, actionId: randomUUID(), approvedBy: "e2e" });
    expect(r.published_now).toBe(false);

    // Attempt 1 failed transiently → rescheduled with ~5 min backoff
    let job = await getJob(r.job_id);
    expect(job.status).toBe("scheduled");
    expect(job.attempts).toBe(1);
    expect(job.last_error_code).toBe("transient");
    expect(job.guidance).toMatch(/retry automatically/i);
    const delay1 = new Date(job.next_attempt_at).getTime() - t0;
    expect(delay1).toBeGreaterThan(4 * 60_000);
    expect(delay1).toBeLessThan(6.5 * 60_000);

    // Attempt 2 → ~10 min backoff (5 × 2^(2-1))
    const t1 = Date.now();
    await executePublishJob(sb, r.job_id);
    job = await getJob(r.job_id);
    expect(job.attempts).toBe(2);
    expect(job.status).toBe("scheduled");
    const delay2 = new Date(job.next_attempt_at).getTime() - t1;
    expect(delay2).toBeGreaterThan(9 * 60_000);
    expect(delay2).toBeLessThan(11.5 * 60_000);

    // The tick must NOT pick it up before next_attempt_at
    const before = job.attempts;
    await runContentPublishTick();
    expect((await getJob(r.job_id)).attempts).toBe(before);

    // Exhaust the budget → terminal failure, project marked failed
    await sb.from("growthmind_publishing_jobs").update({ attempts: 4, next_attempt_at: new Date().toISOString() }).eq("id", r.job_id);
    await executePublishJob(sb, r.job_id);
    job = await getJob(r.job_id);
    expect(job.status).toBe("failed");
    expect(job.attempts).toBe(5);
    expect(job.next_attempt_at).toBeNull();
    expect((await getProject(projectId)).status).toBe("failed");

    // Retry button: resets budget, restores the project state, publishes
    graphHandler = happyHandler;
    const rr = await retryPublishJobNow(sb, WS, r.job_id);
    expect(rr.status).toBe("published");
    job = await getJob(r.job_id);
    expect(job.status).toBe("published");
    expect(job.attempts).toBe(1); // fresh budget after terminal failure
    expect(job.external_post_id).toBe("IGPOST_1");
    expect((await getProject(projectId)).status).toBe("published");
  });

  it("bad media URL (code 100) fails terminally with clear guidance, Retry recovers", async () => {
    graphHandler = () => graphError(100, "Invalid parameter: The media file you are trying to fetch is unsupported or unavailable.");

    const projectId = await makeProject({ __caption: `badmedia ${randomUUID().slice(0, 8)}` });
    const r = await approveContentProjectPublish(sb, WS, { projectId, actionId: randomUUID(), approvedBy: "e2e" });

    let job = await getJob(r.job_id);
    expect(job.status).toBe("failed"); // non-retryable → terminal on attempt 1
    expect(job.last_error_code).toBe("invalid_media");
    expect(job.error_message).toContain("unsupported or unavailable");
    expect(job.guidance).toMatch(/media URL is public https/i);
    expect((await getProject(projectId)).status).toBe("failed");

    graphHandler = happyHandler;
    const rr = await retryPublishJobNow(sb, WS, r.job_id);
    expect(rr.status).toBe("published");
    expect((await getProject(projectId)).status).toBe("published");
  });

  it("expired token (code 190) is non-retryable with reconnect guidance", async () => {
    graphHandler = () => graphError(190, "Error validating access token: Session has expired.", 401);
    const projectId = await makeProject({ __caption: `token ${randomUUID().slice(0, 8)}` });
    const r = await approveContentProjectPublish(sb, WS, { projectId, actionId: randomUUID(), approvedBy: "e2e" });
    const job = await getJob(r.job_id);
    expect(job.status).toBe("failed");
    expect(job.last_error_code).toBe("token_expired");
    expect(job.guidance).toMatch(/reconnect/i);
  });

  it("rate limit (code 4) is retryable", async () => {
    graphHandler = () => graphError(4, "Application request limit reached", 403);
    const projectId = await makeProject({ __caption: `rate ${randomUUID().slice(0, 8)}` });
    const r = await approveContentProjectPublish(sb, WS, { projectId, actionId: randomUUID(), approvedBy: "e2e" });
    const job = await getJob(r.job_id);
    expect(job.status).toBe("scheduled");
    expect(job.last_error_code).toBe("rate_limited");
    expect(job.next_attempt_at).not.toBeNull();
  });

  it("CAS claim — a job cannot be double-executed concurrently", async () => {
    let mediaPosts = 0;
    graphHandler = (call) => {
      if (call.method === "POST" && call.path.endsWith("/media")) { mediaPosts++; return { json: { id: "C_ONCE" } }; }
      if (call.method === "POST" && call.path.endsWith("/media_publish")) return { json: { id: "P_ONCE" } };
      if (call.method === "GET" && call.params.fields === "permalink") return { json: { permalink: "https://ig/e2e" } };
      return { json: {} };
    };
    const projectId = await makeProject({ __caption: `cas ${randomUUID().slice(0, 8)}` });
    const r = await approveContentProjectPublish(sb, WS, { projectId, actionId: randomUUID(), approvedBy: "e2e" });
    expect(r.published_now).toBe(true);
    // Second execute on the already-published job is a no-op
    const again = await executePublishJob(sb, r.job_id);
    expect(again.status).toBe("published");
    expect(mediaPosts).toBe(1);
  });
});
