// ── GrowthMind Content Projects — Studio handoff + approval workflow ─────────
// Turns an approved adaptation recommendation into a REAL Content Studio
// project (bidirectional links via growthmind_content_links + the project's
// recommendation_id), assists production (voiceover / media / subtitles), and
// runs the approval state machine. Approvals route through HiveMind actions
// (action_type "growthmind_publish_content") with autonomy-mode enforcement:
//   - rule-triggered flags ALWAYS force explicit human approval;
//   - only when no rule fires AND HiveMind operator mode explicitly permits
//     the "publishing" category may a publish auto-execute.
// All table writes use the service-role client (tables are SELECT-only for
// authenticated) — every query is workspace-scoped.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  canTransition,
  normalizeApprovalRules,
  evaluateApprovalRules,
  DEFAULT_APPROVAL_RULES,
  type ApprovalRuleConfig,
} from "./content-approval.shared";

type Sb = any;

async function getAdmin(): Promise<Sb> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

function nowIso() { return new Date().toISOString(); }

async function loadProject(admin: Sb, workspaceId: string, projectId: string) {
  const { data, error } = await admin
    .from("growthmind_content_projects")
    .select("*")
    .eq("id", projectId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Project not found");
  return data as Record<string, any>;
}

/** Guarded status transition — appends to status_history. Throws on illegal moves. */
export async function transitionProjectStatus(
  admin: Sb,
  workspaceId: string,
  projectId: string,
  to: string,
  by: string,
  note?: string,
  extra?: Record<string, any>,
): Promise<Record<string, any>> {
  const project = await loadProject(admin, workspaceId, projectId);
  if (project.status === to) return project;
  if (!canTransition(project.status, to)) {
    throw new Error(`Cannot move project from "${project.status}" to "${to}"`);
  }
  const history = Array.isArray(project.status_history) ? project.status_history : [];
  const { data, error } = await admin
    .from("growthmind_content_projects")
    .update({
      status: to,
      status_history: [...history, { from: project.status, to, at: nowIso(), by, note: note ?? null }].slice(-50),
      updated_at: nowIso(),
      ...(extra ?? {}),
    })
    .eq("id", projectId)
    .eq("workspace_id", workspaceId)
    .eq("status", project.status) // CAS — concurrent transition loses
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Project status changed concurrently — reload and retry");
  return data as Record<string, any>;
}

async function mirrorRecommendationStatus(admin: Sb, workspaceId: string, recommendationId: string | null, status: string) {
  if (!recommendationId) return;
  try {
    await admin
      .from("growthmind_content_recommendations")
      .update({ status, updated_at: nowIso() })
      .eq("id", recommendationId)
      .eq("workspace_id", workspaceId);
  } catch { /* best-effort mirror — project row is the source of truth */ }
}

// ── Approval rules (workspace_settings.growthmind_ci_limits.approval_rules) ──

export async function getWorkspaceApprovalRules(admin: Sb, workspaceId: string): Promise<ApprovalRuleConfig> {
  const { data, error } = await admin
    .from("workspace_settings")
    .select("growthmind_ci_limits")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  // Fail CLOSED: unreadable rules behave as the strict defaults.
  if (error) return DEFAULT_APPROVAL_RULES;
  return normalizeApprovalRules((data?.growthmind_ci_limits as any)?.approval_rules);
}

export const getContentApprovalRules = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = await getAdmin();
    const rules = await getWorkspaceApprovalRules(admin, context.workspaceId!);
    return { rules };
  });

const RulesInput = z.object({
  always_require_approval:   z.boolean(),
  claims_require_approval:   z.boolean(),
  pricing_require_approval:  z.boolean(),
  ai_media_require_approval: z.boolean(),
  restricted_terms:          z.array(z.string().min(1).max(100)).max(50),
});

export const setContentApprovalRules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: z.infer<typeof RulesInput>) => RulesInput.parse(i))
  .handler(async ({ data, context }) => {
    const workspaceId = context.workspaceId!;
    const userId = (context as any).userId as string;
    // Owner/admin only — approval rules are a safety control.
    const { data: member } = await (context.supabase as any)
      .from("workspace_members").select("role")
      .eq("workspace_id", workspaceId).eq("user_id", userId).maybeSingle();
    if (member?.role !== "owner" && member?.role !== "admin") {
      throw new Error("Only workspace owners and admins can change approval rules.");
    }
    const admin = await getAdmin();
    const { data: settings } = await admin
      .from("workspace_settings").select("growthmind_ci_limits")
      .eq("workspace_id", workspaceId).maybeSingle();
    const limits = { ...((settings?.growthmind_ci_limits as any) ?? {}), approval_rules: normalizeApprovalRules(data) };
    const { data: updated, error } = await admin
      .from("workspace_settings")
      .update({ growthmind_ci_limits: limits, updated_at: nowIso() })
      .eq("workspace_id", workspaceId)
      .select("workspace_id");
    if (error) throw new Error(error.message);
    if (!updated?.length) {
      const { error: insErr } = await admin
        .from("workspace_settings")
        .insert({ workspace_id: workspaceId, growthmind_ci_limits: limits });
      if (insErr) throw new Error(insErr.message);
    }
    return { ok: true };
  });

// ── Handoff: recommendation → Content Studio project ─────────────────────────

const CreateInput = z.object({ recommendationId: z.string().uuid() });

/**
 * Core handoff logic — shared by the server fn below and the GrowthMind chat
 * tool (which audits the run through the Mind tool registry).
 */
export async function createProjectFromRecommendationCore(
  admin: any,
  workspaceId: string,
  userId: string | null,
  recommendationId: string,
): Promise<{ projectId: string; existed: boolean }> {
  {
    const data = { recommendationId };

    const { data: rec, error } = await admin
      .from("growthmind_content_recommendations")
      .select("*")
      .eq("id", data.recommendationId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!rec) throw new Error("Recommendation not found");

    // One project per recommendation — if it already exists, return it
    // regardless of the recommendation's current status (idempotent open-existing).
    const { data: existing } = await admin
      .from("growthmind_content_projects")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("recommendation_id", rec.id)
      .limit(1);
    if (existing?.length) return { projectId: existing[0].id as string, existed: true };

    if (!["recommended", "analysed", "drafting"].includes(rec.status)) {
      throw new Error(`Recommendation is "${rec.status}" — only fresh recommendations can be sent to Content Studio.`);
    }
    const payload = (rec.payload ?? {}) as Record<string, any>;
    const brief   = (payload.brief ?? {}) as Record<string, any>;
    if (payload.compliance?.blocked === true) {
      throw new Error("This adaptation was blocked by compliance checks and cannot be produced.");
    }

    const shotList = Array.isArray(brief.shotList) ? brief.shotList : [];
    const requiredAssets = [
      ...(Array.isArray(brief.brollRequirements) ? brief.brollRequirements : []).map((d: any) => ({
        kind: "footage", description: String(d).slice(0, 500), fulfilled: false, asset_ref: null,
      })),
    ];

    const { data: row, error: insErr } = await admin
      .from("growthmind_content_projects")
      .insert({
        workspace_id:      workspaceId,
        recommendation_id: rec.id,
        trend_item_id:     rec.trend_item_id ?? payload.source?.trendItemId ?? null,
        anatomy_id:        payload.source?.anatomyId ?? null,
        title:             String(rec.title ?? brief.title ?? "Content project").slice(0, 300),
        format:            rec.format ?? "reel",
        target_platform:   rec.target_platform ?? (String(brief.platform ?? "").toLowerCase().includes("facebook") ? "facebook" : "instagram"),
        script:            typeof brief.script === "string" ? brief.script.slice(0, 20000) : null,
        scene_timeline:    shotList,
        voiceover_script:  typeof brief.script === "string" ? brief.script.slice(0, 20000) : null,
        subtitles:         typeof brief.subtitles === "string" ? brief.subtitles.slice(0, 2000) : null,
        caption:           typeof brief.caption === "string" ? brief.caption.slice(0, 2200) : null,
        cta:               typeof brief.cta === "string" ? brief.cta.slice(0, 300) : null,
        thumbnail_text:    typeof brief.thumbnailText === "string" ? brief.thumbnailText.slice(0, 300) : null,
        hashtags:          Array.isArray(brief.hashtags) ? brief.hashtags.slice(0, 30) : [],
        required_assets:   requiredAssets,
        inspiration: {
          source:        payload.source ?? null,
          hookOptions:   Array.isArray(brief.hookOptions) ? brief.hookOptions : [],
          onScreenText:  Array.isArray(brief.onScreenText) ? brief.onScreenText : [],
          audioDirection: brief.audioDirection ?? null,
          postingTime:   brief.postingTime ?? null,
          expectedOutcome: brief.expectedOutcome ?? null,
          riskNotes:     Array.isArray(brief.riskNotes) ? brief.riskNotes : [],
          originality:   payload.originality ?? null,
          compliance:    payload.compliance ?? null,
        },
        recommended_time:  typeof brief.postingTime === "string" ? brief.postingTime.slice(0, 300) : null,
        status:            "in_production",
        status_history:    [{ from: null, to: "in_production", at: nowIso(), by: userId, note: "Created from adaptation recommendation" }],
        created_by:        userId,
      })
      .select("id")
      .single();
    if (insErr) throw new Error(insErr.message);

    // Bidirectional link + recommendation status mirror.
    await admin.from("growthmind_content_links").insert({
      workspace_id:      workspaceId,
      recommendation_id: rec.id,
      studio_kind:       "content_studio",
      studio_ref_id:     row.id,
      status:            "in_progress",
      metadata:          { created_from: "adaptation_handoff" },
    });
    await mirrorRecommendationStatus(admin, workspaceId, rec.id, "in_content_studio");

    try {
      const { logGrowthMindActivity } = await import("@/lib/growthmind/growthmind.activity.server");
      await logGrowthMindActivity({
        workspaceId, actor: "user", actorUserId: userId, category: "content",
        action: "content_project.created",
        summary: `Content Studio project created from adaptation "${rec.title}"`,
        entityType: "growthmind_content_projects", entityId: row.id,
      });
    } catch { /* best-effort */ }

    return { projectId: row.id as string, existed: false };
  }
}

export const createProjectFromRecommendation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: z.infer<typeof CreateInput>) => CreateInput.parse(i))
  .handler(async ({ data, context }) => {
    const workspaceId = context.workspaceId!;
    const userId = (context as any).userId as string;
    const admin = await getAdmin();
    return await createProjectFromRecommendationCore(admin, workspaceId, userId, data.recommendationId);
  });

// ── List / get ────────────────────────────────────────────────────────────────

export const listContentProjects = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = await getAdmin();
    const { data, error } = await admin
      .from("growthmind_content_projects")
      .select("id, title, format, target_platform, status, media_url, media_type, media_is_ai, thumbnail_url, recommendation_id, approval_flags, created_at, updated_at")
      .eq("workspace_id", context.workspaceId!)
      .neq("status", "archived")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return { projects: data ?? [] };
  });

const GetInput = z.object({ projectId: z.string().uuid() });

export const getContentProject = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: z.infer<typeof GetInput>) => GetInput.parse(i))
  .handler(async ({ data, context }) => {
    const workspaceId = context.workspaceId!;
    const admin = await getAdmin();
    const project = await loadProject(admin, workspaceId, data.projectId);

    const [recRes, jobsRes, connsRes, rules] = await Promise.all([
      project.recommendation_id
        ? admin.from("growthmind_content_recommendations")
            .select("id, title, status, risk_flags, scores, payload, trend_item_id")
            .eq("id", project.recommendation_id).eq("workspace_id", workspaceId).maybeSingle()
        : Promise.resolve({ data: null }),
      admin.from("growthmind_publishing_jobs")
        .select("id, platform, target_type, status, scheduled_at, attempts, max_attempts, next_attempt_at, external_post_id, external_permalink, error_message, last_error_code, guidance, attempt_history, published_at, created_at")
        .eq("workspace_id", workspaceId).eq("project_id", project.id)
        .order("created_at", { ascending: false }).limit(20),
      admin.from("growthmind_social_connections")
        .select("id, provider, account_type, account_name, username, status, token_expires_at, permissions")
        .eq("workspace_id", workspaceId).eq("status", "connected"),
      getWorkspaceApprovalRules(admin, workspaceId),
    ]);

    const evaluation = evaluateApprovalRules(rules, project as any);
    return {
      project,
      recommendation: recRes.data ?? null,
      jobs: jobsRes.data ?? [],
      connections: connsRes.data ?? [],
      rules,
      evaluation,
    };
  });

// ── Update (production fields) ────────────────────────────────────────────────

const UpdateInput = z.object({
  projectId:       z.string().uuid(),
  title:           z.string().min(1).max(300).optional(),
  script:          z.string().max(20000).nullable().optional(),
  voiceoverScript: z.string().max(20000).nullable().optional(),
  subtitles:       z.string().max(5000).nullable().optional(),
  caption:         z.string().max(2200).nullable().optional(),
  cta:             z.string().max(300).nullable().optional(),
  thumbnailText:   z.string().max(300).nullable().optional(),
  hashtags:        z.array(z.string().max(100)).max(30).optional(),
  targetPlatform:  z.enum(["instagram", "facebook"]).optional(),
  format:          z.enum(["reel", "image_post", "carousel", "story", "other"]).optional(),
  targetConnectionId: z.string().uuid().nullable().optional(),
});

export const updateContentProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: z.infer<typeof UpdateInput>) => UpdateInput.parse(i))
  .handler(async ({ data, context }) => {
    const workspaceId = context.workspaceId!;
    const userId = (context as any).userId as string;
    const admin = await getAdmin();
    const project = await loadProject(admin, workspaceId, data.projectId);

    if (["publishing", "published", "archived"].includes(project.status)) {
      throw new Error(`Project is ${project.status} and can no longer be edited.`);
    }

    const update: Record<string, any> = { updated_at: nowIso() };
    if (data.title !== undefined)           update.title = data.title;
    if (data.script !== undefined)          update.script = data.script;
    if (data.voiceoverScript !== undefined) update.voiceover_script = data.voiceoverScript;
    if (data.subtitles !== undefined)       update.subtitles = data.subtitles;
    if (data.caption !== undefined)         update.caption = data.caption;
    if (data.cta !== undefined)             update.cta = data.cta;
    if (data.thumbnailText !== undefined)   update.thumbnail_text = data.thumbnailText;
    if (data.hashtags !== undefined)        update.hashtags = data.hashtags;
    if (data.targetPlatform !== undefined)  update.target_platform = data.targetPlatform;
    if (data.format !== undefined)          update.format = data.format;
    if (data.targetConnectionId !== undefined) update.target_connection_id = data.targetConnectionId;

    const { error } = await admin
      .from("growthmind_content_projects")
      .update(update)
      .eq("id", project.id)
      .eq("workspace_id", workspaceId);
    if (error) throw new Error(error.message);

    // Editing content after approval voids the approved snapshot — back to
    // production so it must be re-approved before publishing.
    const contentEdited = ["title","script","voiceover_script","subtitles","caption","cta","thumbnail_text","hashtags"]
      .some(k => k in update);
    if (contentEdited && ["awaiting_approval", "approved", "scheduled", "changes_requested"].includes(project.status)) {
      await transitionProjectStatus(admin, workspaceId, project.id, "in_production", userId,
        "Content edited — approval reset", { approved_version: null, approved_at: null, approved_by: null, approval_action_id: null });
      await mirrorRecommendationStatus(admin, workspaceId, project.recommendation_id, "in_content_studio");
      // Cancel any not-yet-published jobs tied to the voided approval.
      await admin.from("growthmind_publishing_jobs")
        .update({ status: "cancelled", updated_at: nowIso() })
        .eq("workspace_id", workspaceId).eq("project_id", project.id)
        .in("status", ["draft", "validating", "awaiting_approval", "approved", "scheduled"]);
      return { ok: true, approvalReset: true };
    }
    return { ok: true, approvalReset: false };
  });

// ── Production assistance ─────────────────────────────────────────────────────

const MediaInput = z.object({
  projectId:    z.string().uuid(),
  mediaUrl:     z.string().url().max(2000).nullable(),
  mediaType:    z.enum(["video", "image"]).nullable(),
  mediaSource:  z.enum(["workspace_asset", "uploaded", "video_studio", "image_studio", "ai_generated", "stock"]).nullable(),
  isAi:         z.boolean().default(false),
  thumbnailUrl: z.string().url().max(2000).nullable().optional(),
});

export const setProjectMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: z.infer<typeof MediaInput>) => MediaInput.parse(i))
  .handler(async ({ data, context }) => {
    const workspaceId = context.workspaceId!;
    const userId = (context as any).userId as string;
    const admin = await getAdmin();
    const project = await loadProject(admin, workspaceId, data.projectId);
    if (["publishing", "published", "archived"].includes(project.status)) {
      throw new Error(`Project is ${project.status} and can no longer be edited.`);
    }
    // AI media must be honestly labelled: sources that imply generation force the flag.
    const isAi = data.isAi || data.mediaSource === "ai_generated";
    const { error } = await admin
      .from("growthmind_content_projects")
      .update({
        media_url: data.mediaUrl, media_type: data.mediaType, media_source: data.mediaSource,
        media_is_ai: isAi,
        ...(data.thumbnailUrl !== undefined ? { thumbnail_url: data.thumbnailUrl } : {}),
        updated_at: nowIso(),
      })
      .eq("id", project.id).eq("workspace_id", workspaceId);
    if (error) throw new Error(error.message);
    if (["awaiting_approval", "approved", "scheduled", "changes_requested"].includes(project.status)) {
      await transitionProjectStatus(admin, workspaceId, project.id, "in_production", userId,
        "Media changed — approval reset", { approved_version: null, approved_at: null, approved_by: null, approval_action_id: null });
    }
    return { ok: true };
  });

const VoiceoverInput = z.object({
  projectId: z.string().uuid(),
  voiceId:   z.string().min(1).max(100).default("21m00Tcm4TlvDq8ikWAM"),
  text:      z.string().min(1).max(5000).optional(),
});

export const generateProjectVoiceover = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: z.infer<typeof VoiceoverInput>) => VoiceoverInput.parse(i))
  .handler(async ({ data, context }) => {
    const workspaceId = context.workspaceId!;
    const admin = await getAdmin();
    const project = await loadProject(admin, workspaceId, data.projectId);
    if (["publishing", "published", "archived"].includes(project.status)) {
      throw new Error(`Project is ${project.status} and can no longer be edited.`);
    }
    const text = (data.text ?? project.voiceover_script ?? project.script ?? "").trim();
    if (!text) throw new Error("No voiceover script — write one first.");

    const { data: wsRow } = await admin
      .from("workspaces").select("settings")
      .eq("id", workspaceId).maybeSingle();
    const elKey = process.env.ELEVENLABS_API_KEY ?? (wsRow?.settings as any)?.elevenlabs_api_key;
    if (!elKey) throw new Error("No ElevenLabs API key configured — add one in settings to generate voiceovers.");

    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(data.voiceId)}`, {
      method: "POST",
      headers: { "xi-api-key": elKey, "Content-Type": "application/json" },
      body: JSON.stringify({ text: text.slice(0, 5000), model_id: "eleven_multilingual_v2" }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Voiceover generation failed (${res.status}): ${body.slice(0, 300)}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const audioUrl = `data:audio/mpeg;base64,${buf.toString("base64")}`;

    const { error } = await admin
      .from("growthmind_content_projects")
      .update({ voiceover_url: audioUrl, voiceover_is_ai: true, updated_at: nowIso() })
      .eq("id", project.id).eq("workspace_id", workspaceId);
    if (error) throw new Error(error.message);
    return { ok: true, audioUrl, aiLabelled: true };
  });

// ── Approval workflow ─────────────────────────────────────────────────────────

const SubmitInput = z.object({
  projectId:    z.string().uuid(),
  connectionId: z.string().uuid().optional(),
  scheduledAt:  z.string().datetime().optional(),
});

export const submitProjectForApproval = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: z.infer<typeof SubmitInput>) => SubmitInput.parse(i))
  .handler(async ({ data, context }) => {
    const workspaceId = context.workspaceId!;
    const userId = (context as any).userId as string;
    const sb = context.supabase as any;
    const admin = await getAdmin();
    const project = await loadProject(admin, workspaceId, data.projectId);

    if (!["in_production", "awaiting_assets", "changes_requested"].includes(project.status)) {
      throw new Error(`Project is "${project.status}" — only in-production projects can be submitted.`);
    }
    if (!project.media_url) {
      await transitionProjectStatus(admin, workspaceId, project.id, "awaiting_assets", userId, "No media attached yet");
      throw new Error("Attach the final media (video or image) before submitting for approval.");
    }
    if (!project.caption?.trim()) throw new Error("Write a caption before submitting for approval.");

    const connectionId = data.connectionId ?? project.target_connection_id;
    if (!connectionId) throw new Error("Choose the social account to publish to first.");
    const { data: conn } = await admin
      .from("growthmind_social_connections")
      .select("id, status, account_type, account_name")
      .eq("id", connectionId).eq("workspace_id", workspaceId).maybeSingle();
    if (!conn || conn.status !== "connected") throw new Error("The selected social account is not connected.");

    const rules = await getWorkspaceApprovalRules(admin, workspaceId);
    const evaluation = evaluateApprovalRules(rules, project as any);

    // Frozen snapshot of what is being approved.
    const approvedVersion = {
      title: project.title, caption: project.caption, script: project.script,
      voiceover_script: project.voiceover_script, subtitles: project.subtitles,
      cta: project.cta, hashtags: project.hashtags, media_url: project.media_url,
      media_type: project.media_type, media_is_ai: project.media_is_ai,
      voiceover_is_ai: project.voiceover_is_ai, thumbnail_url: project.thumbnail_url,
      snapshotAt: nowIso(),
    };

    const targetType = project.format === "reel" ? "reel"
      : project.format === "story" ? "story"
      : conn.account_type === "facebook_page" ? "page_post" : "feed";

    // HiveMind action routing the approval decision.
    const { assertProposalAllowed } = await import("@/lib/hivemind/mode-gate.server");
    await assertProposalAllowed(sb, workspaceId);

    const forced = evaluation.requiresApproval;
    const { data: action, error: aErr } = await admin
      .from("hivemind_actions")
      .insert({
        workspace_id: workspaceId,
        title:        `Publish "${project.title}" to ${conn.account_name ?? conn.account_type}`,
        description:  forced
          ? `Approval required by workspace rules: ${evaluation.flags.join(", ")}`
          : "Publish approval for GrowthMind content project.",
        action_type:    "growthmind_publish_content",
        action_payload: {
          project_id: project.id,
          connection_id: connectionId,
          target_type: targetType,
          scheduled_at: data.scheduledAt ?? null,
          approval_flags: evaluation.flags,
          source_recommendation_id: project.recommendation_id ?? null,
        },
        proposed_by: "growthmind",
        status:      "pending",
        sensitive:   forced,
        sensitive_category: forced ? "client_communication" : null,
        source_recommendation_id: project.recommendation_id ?? null,
      })
      .select("*")
      .single();
    if (aErr) throw new Error(aErr.message);

    await transitionProjectStatus(admin, workspaceId, project.id, "awaiting_approval", userId,
      forced ? `Rules triggered: ${evaluation.flags.join(", ")}` : "Submitted for approval", {
        approval_flags: evaluation.flags,
        approved_version: approvedVersion,
        approval_action_id: action.id,
        target_connection_id: connectionId,
      });
    await mirrorRecommendationStatus(admin, workspaceId, project.recommendation_id, "awaiting_approval");

    // Autonomy enforcement: auto-execution is ONLY possible when no rule
    // fired AND HiveMind operator mode explicitly permits "publishing".
    let autoExecuted = false;
    if (!forced) {
      try {
        const { getHiveMindModeConfig, assertExecutionAllowed } = await import("@/lib/hivemind/mode-gate.server");
        const cfg = await getHiveMindModeConfig(sb, workspaceId);
        assertExecutionAllowed(cfg, "growthmind_publish_content", { explicitApproval: false });

        // CAS consume mirroring approveHiveMindAction's single-use semantics.
        const { data: consumed } = await admin
          .from("hivemind_actions")
          .update({ status: "approved", approved_by: "growthmind-auto", consumed_at: nowIso(), updated_at: nowIso() })
          .eq("id", action.id).eq("workspace_id", workspaceId)
          .eq("status", "pending").is("consumed_at", null)
          .select("id");
        if (consumed?.length) {
          const { approveContentProjectPublish } = await import("@/lib/growthmind/meta-content-publish.server");
          const result = await approveContentProjectPublish(admin, workspaceId, {
            projectId: project.id, actionId: action.id, approvedBy: "growthmind-auto",
          });
          await admin.from("hivemind_actions")
            .update({ status: "executed", executed_at: nowIso(), result, updated_at: nowIso() })
            .eq("id", action.id).eq("workspace_id", workspaceId);
          autoExecuted = true;
        }
      } catch {
        // Mode gate said no — the action stays pending for a human. Expected path.
      }
    }

    return {
      ok: true,
      actionId: action.id as string,
      requiresApproval: forced || !autoExecuted,
      approvalFlags: evaluation.flags,
      autoExecuted,
    };
  });

const DecisionInput = z.object({
  projectId: z.string().uuid(),
  note:      z.string().max(2000).optional(),
});

/** Reject / request changes from the project page — mirrors the HiveMind reject. */
export const requestProjectChanges = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: z.infer<typeof DecisionInput>) => DecisionInput.parse(i))
  .handler(async ({ data, context }) => {
    const workspaceId = context.workspaceId!;
    const userId = (context as any).userId as string;
    const admin = await getAdmin();
    const project = await loadProject(admin, workspaceId, data.projectId);
    if (project.status !== "awaiting_approval") throw new Error("Project is not awaiting approval.");

    if (project.approval_action_id) {
      await admin.from("hivemind_actions")
        .update({ status: "rejected", error_message: data.note ? `Changes requested: ${data.note}` : "Changes requested", updated_at: nowIso() })
        .eq("id", project.approval_action_id).eq("workspace_id", workspaceId)
        .eq("status", "pending");
    }
    await transitionProjectStatus(admin, workspaceId, project.id, "changes_requested", userId, data.note ?? "Changes requested",
      { approved_version: null, approval_action_id: null });
    await mirrorRecommendationStatus(admin, workspaceId, project.recommendation_id, "changes_requested");
    return { ok: true };
  });

/** Bring a failed project back to production so content/media can be fixed and re-submitted. */
export const returnProjectToProduction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: z.infer<typeof GetInput>) => GetInput.parse(i))
  .handler(async ({ data, context }) => {
    const workspaceId = context.workspaceId!;
    const userId = (context as any).userId as string;
    const admin = await getAdmin();
    const project = await loadProject(admin, workspaceId, data.projectId);
    if (project.status !== "failed") throw new Error("Only failed projects can be returned to production.");
    await transitionProjectStatus(admin, workspaceId, project.id, "in_production", userId,
      "Returned to production after publish failure", { approved_version: null, approval_action_id: null });
    // Cancel any lingering non-terminal jobs — a fresh approval will create a new one.
    await admin.from("growthmind_publishing_jobs")
      .update({ status: "cancelled", updated_at: nowIso() })
      .eq("workspace_id", workspaceId).eq("project_id", project.id)
      .in("status", ["draft", "validating", "awaiting_approval", "approved", "scheduled"]);
    await mirrorRecommendationStatus(admin, workspaceId, project.recommendation_id, "in_content_studio");
    return { ok: true };
  });

export const archiveContentProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: z.infer<typeof GetInput>) => GetInput.parse(i))
  .handler(async ({ data, context }) => {
    const workspaceId = context.workspaceId!;
    const userId = (context as any).userId as string;
    const admin = await getAdmin();
    const project = await loadProject(admin, workspaceId, data.projectId);
    if (project.status === "publishing") throw new Error("Cannot archive while publishing is in flight.");
    await transitionProjectStatus(admin, workspaceId, project.id, "archived", userId);
    await admin.from("growthmind_publishing_jobs")
      .update({ status: "cancelled", updated_at: nowIso() })
      .eq("workspace_id", workspaceId).eq("project_id", project.id)
      .in("status", ["draft", "validating", "awaiting_approval", "approved", "scheduled"]);
    await admin.from("growthmind_content_links")
      .update({ status: "abandoned", updated_at: nowIso() })
      .eq("workspace_id", workspaceId).eq("studio_kind", "content_studio").eq("studio_ref_id", project.id);
    return { ok: true };
  });

const RetryInput = z.object({ jobId: z.string().uuid() });

/** Retry a failed publishing job immediately (resets backoff, keeps idempotency key). */
export const retryProjectPublishJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: z.infer<typeof RetryInput>) => RetryInput.parse(i))
  .handler(async ({ data, context }) => {
    const workspaceId = context.workspaceId!;
    const admin = await getAdmin();
    const { retryPublishJobNow } = await import("@/lib/growthmind/meta-content-publish.server");
    return await retryPublishJobNow(admin, workspaceId, data.jobId);
  });
