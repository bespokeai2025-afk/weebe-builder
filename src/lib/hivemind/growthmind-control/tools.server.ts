/**
 * HiveMind executive control tools over GrowthMind — SERVER ONLY.
 *
 * Every tool registers in the shared Mind tool registry ("registry" surface),
 * so executeMindTool() enforces membership, entitlements, the HiveMind mode
 * gate for Mind-initiated writes, sensitive-tool approval and the audit trail.
 *
 * Tools call the SAME GrowthMind service cores the UI uses — no duplicated
 * business logic, no optimistic success. All statuses come from real results.
 */
import { z } from "zod";
import { registerMindTool, type MindToolContext, type MindToolRunResult } from "@/lib/minds/tool-registry.server";
import type { MindToolCost } from "@/lib/minds/tool-registry.shared";
import type { ActionKey } from "@/lib/permissions/permissions.shared";

type Sb = any;

async function getAdmin(): Promise<Sb> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

const nowIso = () => new Date().toISOString();

interface ReadToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema?: z.ZodTypeAny;
  cost?: MindToolCost;
  run: (ctx: MindToolContext, input: any) => Promise<MindToolRunResult>;
}

function registerRead(def: ReadToolDef): void {
  registerMindTool({
    name: `hivemind.${def.name}`,
    mind: "hivemind",
    title: def.title,
    description: def.description,
    access: "read",
    surface: "registry",
    sensitive: false,
    idempotent: true,
    estimatedCost: def.cost ?? "none",
    platforms: ["web", "mobile", "api", "system"],
    inputSchema: def.inputSchema,
    run: def.run,
  });
}

interface WriteToolDef extends ReadToolDef {
  sensitive?: boolean;
  requiredActionKey?: ActionKey;
  idempotent?: boolean;
}

function registerWrite(def: WriteToolDef): void {
  registerMindTool({
    name: `hivemind.${def.name}`,
    mind: "hivemind",
    title: def.title,
    description: def.description,
    access: "write",
    surface: "registry",
    sensitive: def.sensitive === true,
    requiredActionKey: def.requiredActionKey,
    modeGateActionType: def.name,
    idempotent: def.idempotent === true,
    estimatedCost: def.cost ?? "low",
    platforms: ["web", "mobile", "api", "system"],
    inputSchema: def.inputSchema,
    run: def.run,
  });
}

// ═══════════════════════════ READ TOOLS ═════════════════════════════════════

registerRead({
  name: "get_growthmind_status",
  title: "GrowthMind status",
  description: "Full executive view of GrowthMind: connections, trend pipeline, content command centre, publishing, performance, AI costs, Business DNA and objectives.",
  run: async (ctx) => {
    const { buildGrowthMindExecutiveView } = await import("@/lib/hivemind/growthmind-control/executive-view.server");
    return { result: await buildGrowthMindExecutiveView(ctx.workspaceId) as any };
  },
});

registerRead({
  name: "get_growthmind_health",
  title: "GrowthMind operational health",
  description: "Deterministic health checks over the marketing department: publishing failures, paused switches, token expiry, discovery freshness, stale recommendations, DNA completeness and cost limits.",
  run: async (ctx) => {
    const { checkGrowthMindOperationalHealth } = await import("@/lib/hivemind/growthmind-control/executive-view.server");
    return { result: await checkGrowthMindOperationalHealth(ctx.workspaceId) as any };
  },
});

registerRead({
  name: "get_content_command_centre",
  title: "Content command centre",
  description: "Live content pipeline: recommendations, Content Studio projects by status, publishing jobs, projects awaiting approval and pending publish approvals.",
  run: async (ctx) => {
    const admin = await getAdmin();
    const [recs, projects, jobs, approvals] = await Promise.all([
      admin.from("growthmind_content_recommendations")
        .select("id, title, status, format, target_platform, created_at")
        .eq("workspace_id", ctx.workspaceId)
        .in("status", ["recommended", "analysed", "drafting", "in_content_studio", "awaiting_approval"])
        .order("created_at", { ascending: false }).limit(15),
      admin.from("growthmind_content_projects")
        .select("id, title, status, target_platform, updated_at, approval_action_id")
        .eq("workspace_id", ctx.workspaceId).neq("status", "archived")
        .order("updated_at", { ascending: false }).limit(20),
      admin.from("growthmind_publishing_jobs")
        .select("id, status, platform, scheduled_at, published_at, external_permalink, error_message, project_id")
        .eq("workspace_id", ctx.workspaceId)
        .order("created_at", { ascending: false }).limit(20),
      admin.from("hivemind_actions")
        .select("id, title, status, sensitive, created_at, action_payload")
        .eq("workspace_id", ctx.workspaceId)
        .eq("action_type", "growthmind_publish_content").eq("status", "pending")
        .limit(10),
    ]);
    return {
      result: {
        recommendations: recs.data ?? [],
        projects: projects.data ?? [],
        publishingJobs: jobs.data ?? [],
        pendingApprovals: (approvals.data ?? []).map((a: any) => ({
          id: a.id, title: a.title, sensitive: a.sensitive, createdAt: a.created_at,
          projectId: a.action_payload?.project_id ?? null,
        })),
      },
    };
  },
});

registerRead({
  name: "get_trend_opportunities",
  title: "Trend opportunities",
  description: "Recommended trend items and monitored sources — the raw material for content decisions.",
  run: async (ctx) => {
    const admin = await getAdmin();
    const [items, sources] = await Promise.all([
      admin.from("growthmind_trend_items")
        .select("id, title, platform, status, author_handle, url, scores, discovered_at")
        .eq("workspace_id", ctx.workspaceId)
        .in("status", ["recommended", "analysed", "screened"])
        .order("discovered_at", { ascending: false }).limit(25),
      admin.from("growthmind_monitored_sources")
        .select("id, source_kind, platform, value, label, status, priority")
        .eq("workspace_id", ctx.workspaceId)
        .order("priority", { ascending: false }).limit(50),
    ]);
    return { result: { trendItems: items.data ?? [], monitoredSources: sources.data ?? [] } };
  },
});

registerRead({
  name: "get_trend_details",
  title: "Trend item details",
  description: "Full detail of one trend item including metrics, AI scores and status.",
  inputSchema: z.object({ trendItemId: z.string().uuid() }),
  run: async (ctx, input: { trendItemId: string }) => {
    const admin = await getAdmin();
    const { data, error } = await admin.from("growthmind_trend_items")
      .select("*").eq("id", input.trendItemId).eq("workspace_id", ctx.workspaceId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Trend item not found in this workspace.");
    return { result: { item: data }, affectedRecordType: "growthmind_trend_items", affectedRecordId: data.id };
  },
});

registerRead({
  name: "get_business_dna",
  title: "Business DNA",
  description: "The workspace Business DNA (commercial identity GrowthMind works from), its completion score and pending update proposals.",
  run: async (ctx) => {
    const admin = await getAdmin();
    const [{ data: row }, { data: proposals }] = await Promise.all([
      admin.from("growthmind_business_dna").select("*").eq("workspace_id", ctx.workspaceId).maybeSingle(),
      admin.from("growthmind_dna_proposals")
        .select("id, rationale, field_changes, status, created_at")
        .eq("workspace_id", ctx.workspaceId).eq("status", "proposed")
        .order("created_at", { ascending: false }).limit(10),
    ]);
    if (!row) return { result: { exists: false, pendingProposals: proposals ?? [] } };
    const { computeDnaCompletionScore, mapBusinessDnaRow } = await import("@/lib/growthmind/growthmind.business-dna");
    const dna = mapBusinessDnaRow(row);
    return { result: { exists: true, dna: dna as any, completion: computeDnaCompletionScore(dna) as any, pendingProposals: proposals ?? [] } };
  },
});

registerRead({
  name: "get_content_performance",
  title: "Content performance",
  description: "Checkpointed performance of recently published posts (latest snapshot per post) plus accepted/proposed learned patterns.",
  run: async (ctx) => {
    const admin = await getAdmin();
    const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const [snaps, patterns] = await Promise.all([
      admin.from("growthmind_performance_snapshots")
        .select("publishing_job_id, captured_at, metrics")
        .eq("workspace_id", ctx.workspaceId).gte("captured_at", since)
        .order("captured_at", { ascending: false }).limit(100),
      admin.from("growthmind_learned_patterns")
        .select("id, pattern_kind, pattern_key, insight, status, sample_size, confidence")
        .eq("workspace_id", ctx.workspaceId).in("status", ["proposed", "accepted"])
        .order("created_at", { ascending: false }).limit(20),
    ]);
    const seen = new Set<string>();
    const posts: any[] = [];
    for (const s of snaps.data ?? []) {
      if (seen.has(s.publishing_job_id)) continue;
      seen.add(s.publishing_job_id);
      const m = (s.metrics ?? {}) as any;
      posts.push({ jobId: s.publishing_job_id, checkpoint: m.checkpoint, capturedAt: s.captured_at, categories: m.categories ?? {}, attribution: m.attribution ?? {} });
      if (posts.length >= 15) break;
    }
    return { result: { posts, learnedPatterns: patterns.data ?? [] } };
  },
});

registerRead({
  name: "get_growthmind_costs",
  title: "GrowthMind AI costs",
  description: "AI generation spend for the last 30 days and month-to-date, by task type, against the monthly limit if one is set.",
  run: async (ctx) => {
    const { buildGrowthMindExecutiveView } = await import("@/lib/hivemind/growthmind-control/executive-view.server");
    const v = await buildGrowthMindExecutiveView(ctx.workspaceId);
    return { result: v.costs as any };
  },
});

registerRead({
  name: "get_publishing_failures",
  title: "Publishing failures",
  description: "Failed publishing jobs with their error messages, ready for retry decisions.",
  run: async (ctx) => {
    const admin = await getAdmin();
    const { data, error } = await admin.from("growthmind_publishing_jobs")
      .select("id, project_id, platform, status, error_message, attempt_count, scheduled_at, updated_at")
      .eq("workspace_id", ctx.workspaceId).eq("status", "failed")
      .order("updated_at", { ascending: false }).limit(20);
    if (error) throw new Error(error.message);
    return { result: { failedJobs: data ?? [] } };
  },
});

registerRead({
  name: "get_growthmind_objectives",
  title: "GrowthMind objectives",
  description: "Commercial objectives HiveMind has set for GrowthMind (active and paused).",
  run: async (ctx) => {
    const { listGrowthMindObjectives } = await import("@/lib/hivemind/growthmind-control/objectives.server");
    return { result: { objectives: await listGrowthMindObjectives(ctx.workspaceId) } };
  },
});

registerRead({
  name: "get_content_studio_project_status",
  title: "Content Studio project status",
  description: "Honest status of one Content Studio project: production state, media, approval state and its publishing jobs.",
  inputSchema: z.object({ projectId: z.string().uuid() }),
  run: async (ctx, input: { projectId: string }) => {
    const admin = await getAdmin();
    const [{ data: project, error }, { data: jobs }] = await Promise.all([
      admin.from("growthmind_content_projects")
        .select("id, title, status, target_platform, media_url, media_type, caption, approval_action_id, status_history, updated_at")
        .eq("id", input.projectId).eq("workspace_id", ctx.workspaceId).maybeSingle(),
      admin.from("growthmind_publishing_jobs")
        .select("id, status, platform, scheduled_at, published_at, error_message, external_permalink")
        .eq("workspace_id", ctx.workspaceId).eq("project_id", input.projectId)
        .order("created_at", { ascending: false }).limit(5),
    ]);
    if (error) throw new Error(error.message);
    if (!project) throw new Error("Project not found in this workspace.");
    return {
      result: {
        project: {
          ...project,
          status_history: Array.isArray(project.status_history) ? project.status_history.slice(-5) : [],
          hasMedia: !!project.media_url,
        },
        publishingJobs: jobs ?? [],
      },
      affectedRecordType: "growthmind_content_projects",
      affectedRecordId: project.id,
    };
  },
});

// ═══════════════════════════ WRITE TOOLS ════════════════════════════════════
// Trend curation — same core the Trend Feed UI uses.

async function trendAction(ctx: MindToolContext, id: string, action: string): Promise<MindToolRunResult> {
  const admin = await getAdmin();
  const { applyTrendItemActionCore } = await import("@/lib/growthmind/growthmind.trend-feed");
  const r = await applyTrendItemActionCore(admin, ctx.workspaceId, ctx.userId, { id, action } as any);
  return { result: r as any, affectedRecordType: "growthmind_trend_items", affectedRecordId: id };
}

registerWrite({
  name: "analyse_trend",
  title: "Analyse trend",
  description: "Run the full AI analysis on one trend item (DNA-gated scoring; logs its own AI cost). Result is 'recommended' or 'dismissed' based on the real score.",
  cost: "low",
  inputSchema: z.object({ trendItemId: z.string().uuid() }),
  run: (ctx, i: { trendItemId: string }) => trendAction(ctx, i.trendItemId, "analyse"),
});

registerWrite({
  name: "prioritise_trend",
  title: "Prioritise trend",
  description: "Mark a trend item as recommended so it is prioritised for content production.",
  inputSchema: z.object({ trendItemId: z.string().uuid() }),
  run: (ctx, i: { trendItemId: string }) => trendAction(ctx, i.trendItemId, "save"),
});

registerWrite({
  name: "reject_trend",
  title: "Reject trend",
  description: "Dismiss a trend item so it stops being suggested.",
  inputSchema: z.object({ trendItemId: z.string().uuid() }),
  run: (ctx, i: { trendItemId: string }) => trendAction(ctx, i.trendItemId, "ignore"),
});

registerWrite({
  name: "block_trend_source",
  title: "Block trend source",
  description: "Exclude the account behind a trend item from future discovery and dismiss the item.",
  inputSchema: z.object({ trendItemId: z.string().uuid() }),
  run: (ctx, i: { trendItemId: string }) => trendAction(ctx, i.trendItemId, "block_source"),
});

registerWrite({
  name: "approve_trend_for_adaptation",
  title: "Approve trend for adaptation",
  description: "Turn a RECOMMENDED trend item into a real Content Studio project (same handoff as the Trend Feed 'create content' button). Idempotent — returns the existing project if one was already created.",
  idempotent: true,
  inputSchema: z.object({ trendItemId: z.string().uuid() }),
  run: async (ctx, i: { trendItemId: string }) => {
    const admin = await getAdmin();
    const { createContentFromTrendCore } = await import("@/lib/growthmind/growthmind.trend-feed");
    const r = await createContentFromTrendCore(admin, ctx.workspaceId, ctx.userId, i.trendItemId);
    return { result: r as any, affectedRecordType: "growthmind_content_projects", affectedRecordId: r.projectId };
  },
});

// Monitoring management — growthmind_monitored_sources (server-write table).

const SOURCE_KINDS = ["competitor_direct", "competitor_indirect", "industry_creator", "aspirational_brand", "target_topic", "keyword", "hashtag", "excluded_account", "excluded_topic"] as const;

registerWrite({
  name: "add_monitored_source",
  title: "Add monitored source",
  description: "Add a competitor account, topic, keyword or hashtag to GrowthMind's trend monitoring. Duplicate values are treated as already-done.",
  idempotent: true,
  inputSchema: z.object({
    kind: z.enum(SOURCE_KINDS),
    value: z.string().min(1).max(300),
    platform: z.enum(["instagram", "facebook", "youtube", "tiktok", "web"]).optional(),
    label: z.string().max(300).optional(),
  }),
  run: async (ctx, i: { kind: string; value: string; platform?: string; label?: string }) => {
    const admin = await getAdmin();
    const { data, error } = await admin.from("growthmind_monitored_sources")
      .insert({
        workspace_id: ctx.workspaceId, source_kind: i.kind, platform: i.platform ?? null,
        value: i.value.replace(/^@/, "").trim(), label: i.label ?? null, added_by_user_id: ctx.userId,
      })
      .select("id").maybeSingle();
    if (error && error.code !== "23505") throw new Error(error.message);
    return {
      result: { added: !error, alreadyExisted: error?.code === "23505", id: data?.id ?? null },
      affectedRecordType: "growthmind_monitored_sources", affectedRecordId: data?.id ?? null,
    };
  },
});

registerWrite({
  name: "set_monitored_source_status",
  title: "Pause/resume/remove monitored source",
  description: "Pause, resume or remove one monitored source by id (from get_trend_opportunities).",
  inputSchema: z.object({
    sourceId: z.string().uuid(),
    action: z.enum(["pause", "resume", "remove"]),
  }),
  run: async (ctx, i: { sourceId: string; action: "pause" | "resume" | "remove" }) => {
    const admin = await getAdmin();
    if (i.action === "remove") {
      const { data, error } = await admin.from("growthmind_monitored_sources")
        .delete().eq("id", i.sourceId).eq("workspace_id", ctx.workspaceId).select("id");
      if (error) throw new Error(error.message);
      if (!data?.length) throw new Error("Source not found in this workspace.");
      return { result: { removed: true }, affectedRecordType: "growthmind_monitored_sources", affectedRecordId: i.sourceId };
    }
    const status = i.action === "pause" ? "paused" : "active";
    const { data, error } = await admin.from("growthmind_monitored_sources")
      .update({ status, updated_at: nowIso() })
      .eq("id", i.sourceId).eq("workspace_id", ctx.workspaceId).select("id, status").maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Source not found in this workspace.");
    return { result: { status: data.status }, affectedRecordType: "growthmind_monitored_sources", affectedRecordId: i.sourceId };
  },
});

// Content Studio — same cores the UI uses.

registerWrite({
  name: "create_content_studio_project",
  title: "Create Content Studio project",
  description: "Create a Content Studio project from an existing content recommendation (same handoff the GrowthMind UI uses). Idempotent per recommendation.",
  idempotent: true,
  inputSchema: z.object({ recommendationId: z.string().uuid() }),
  run: async (ctx, i: { recommendationId: string }) => {
    const admin = await getAdmin();
    const { createProjectFromRecommendationCore } = await import("@/lib/growthmind/growthmind.content-projects");
    const r = await createProjectFromRecommendationCore(admin, ctx.workspaceId, ctx.userId, i.recommendationId);
    return { result: r as any, affectedRecordType: "growthmind_content_projects", affectedRecordId: r.projectId };
  },
});

registerWrite({
  name: "request_content_changes",
  title: "Request content changes",
  description: "Send an awaiting-approval Content Studio project back for changes with directive feedback (rejects its pending publish approval).",
  inputSchema: z.object({ projectId: z.string().uuid(), instructions: z.string().min(3).max(2000) }),
  run: async (ctx, i: { projectId: string; instructions: string }) => {
    const admin = await getAdmin();
    const { data: project, error } = await admin.from("growthmind_content_projects")
      .select("id, status, approval_action_id, recommendation_id")
      .eq("id", i.projectId).eq("workspace_id", ctx.workspaceId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!project) throw new Error("Project not found in this workspace.");
    if (project.status !== "awaiting_approval") {
      throw new Error(`Project is "${project.status}" — change requests only apply to projects awaiting approval.`);
    }
    if (project.approval_action_id) {
      await admin.from("hivemind_actions")
        .update({ status: "rejected", error_message: `Changes requested: ${i.instructions}`.slice(0, 1000), updated_at: nowIso() })
        .eq("id", project.approval_action_id).eq("workspace_id", ctx.workspaceId).eq("status", "pending");
    }
    const { transitionProjectStatus } = await import("@/lib/growthmind/growthmind.content-projects");
    await transitionProjectStatus(admin, ctx.workspaceId, project.id, "changes_requested", ctx.userId, i.instructions,
      { approved_version: null, approval_action_id: null });
    return { result: { status: "changes_requested" }, affectedRecordType: "growthmind_content_projects", affectedRecordId: project.id };
  },
});

registerWrite({
  name: "approve_content",
  title: "Approve content for publishing",
  description: "SENSITIVE: approve an awaiting-approval Content Studio project so it publishes to the connected social account. Always requires explicit human approval.",
  sensitive: true,
  requiredActionKey: "campaign_activation",
  cost: "low",
  inputSchema: z.object({ projectId: z.string().uuid() }),
  run: async (ctx, i: { projectId: string }) => {
    const admin = await getAdmin();
    const { data: project, error } = await admin.from("growthmind_content_projects")
      .select("id, title, status, approval_action_id")
      .eq("id", i.projectId).eq("workspace_id", ctx.workspaceId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!project) throw new Error("Project not found in this workspace.");
    if (project.status !== "awaiting_approval" || !project.approval_action_id) {
      throw new Error(`Project is "${project.status}" — only awaiting-approval projects with a pending approval can be approved.`);
    }
    // Single-use CAS consume, mirroring approveHiveMindAction semantics.
    const { data: consumed, error: cErr } = await admin.from("hivemind_actions")
      .update({ status: "approved", approved_by: ctx.userId ?? "hivemind-tool", consumed_at: nowIso(), updated_at: nowIso() })
      .eq("id", project.approval_action_id).eq("workspace_id", ctx.workspaceId)
      .eq("status", "pending").is("consumed_at", null)
      .select("id");
    if (cErr) throw new Error(cErr.message);
    if (!consumed?.length) throw new Error("The approval was already consumed or is no longer pending.");

    const { approveContentProjectPublish } = await import("@/lib/growthmind/meta-content-publish.server");
    try {
      const result = await approveContentProjectPublish(admin, ctx.workspaceId, {
        projectId: project.id, actionId: project.approval_action_id, approvedBy: ctx.userId ?? "hivemind-tool",
      });
      await admin.from("hivemind_actions")
        .update({ status: "executed", executed_at: nowIso(), result, updated_at: nowIso() })
        .eq("id", project.approval_action_id).eq("workspace_id", ctx.workspaceId);
      return { result: result as any, affectedRecordType: "growthmind_content_projects", affectedRecordId: project.id };
    } catch (e: any) {
      await admin.from("hivemind_actions")
        .update({ status: "failed", error_message: String(e?.message ?? e).slice(0, 1000), updated_at: nowIso() })
        .eq("id", project.approval_action_id).eq("workspace_id", ctx.workspaceId);
      throw e;
    }
  },
});

registerWrite({
  name: "schedule_content",
  title: "Schedule approved content",
  description: "Set/move the publish time of an ALREADY-APPROVED publishing job. Unapproved content must be approved first.",
  inputSchema: z.object({ jobId: z.string().uuid(), scheduledAt: z.string().datetime() }),
  run: async (ctx, i: { jobId: string; scheduledAt: string }) => {
    const ts = new Date(i.scheduledAt);
    if (ts.getTime() < Date.now() + 60_000) throw new Error("scheduledAt must be in the future.");
    const admin = await getAdmin();
    const { data: updated, error } = await admin.from("growthmind_publishing_jobs")
      .update({ scheduled_at: ts.toISOString(), next_attempt_at: ts.toISOString(), status: "scheduled", updated_at: nowIso() })
      .eq("id", i.jobId).eq("workspace_id", ctx.workspaceId)
      .in("status", ["approved", "scheduled"])
      .select("id, scheduled_at, status");
    if (error) throw new Error(error.message);
    if (!updated?.length) {
      const { data: job } = await admin.from("growthmind_publishing_jobs")
        .select("status").eq("id", i.jobId).eq("workspace_id", ctx.workspaceId).maybeSingle();
      throw new Error(job
        ? `Job is "${job.status}" — only approved/scheduled jobs can be (re)scheduled. Unapproved content needs approval first.`
        : "Publishing job not found in this workspace.");
    }
    return { result: { scheduledAt: updated[0].scheduled_at, status: updated[0].status }, affectedRecordType: "growthmind_publishing_jobs", affectedRecordId: i.jobId };
  },
});

registerWrite({
  name: "cancel_scheduled_content",
  title: "Cancel scheduled content",
  description: "Cancel an approved/scheduled publishing job before it publishes.",
  inputSchema: z.object({ jobId: z.string().uuid(), reason: z.string().max(500).optional() }),
  run: async (ctx, i: { jobId: string; reason?: string }) => {
    const admin = await getAdmin();
    const { data: updated, error } = await admin.from("growthmind_publishing_jobs")
      .update({ status: "cancelled", error_message: i.reason ? `Cancelled by HiveMind: ${i.reason}`.slice(0, 500) : "Cancelled by HiveMind", updated_at: nowIso() })
      .eq("id", i.jobId).eq("workspace_id", ctx.workspaceId)
      .in("status", ["approved", "scheduled", "awaiting_approval", "draft", "validating"])
      .select("id");
    if (error) throw new Error(error.message);
    if (!updated?.length) throw new Error("Job not found or already published/terminal — nothing was cancelled.");
    return { result: { cancelled: true }, affectedRecordType: "growthmind_publishing_jobs", affectedRecordId: i.jobId };
  },
});

registerWrite({
  name: "retry_failed_publication",
  title: "Retry failed publication",
  description: "Retry one failed publishing job now (same retry the project page uses).",
  inputSchema: z.object({ jobId: z.string().uuid() }),
  run: async (ctx, i: { jobId: string }) => {
    const admin = await getAdmin();
    const { retryPublishJobNow } = await import("@/lib/growthmind/meta-content-publish.server");
    const r = await retryPublishJobNow(admin, ctx.workspaceId, i.jobId);
    return { result: r as any, affectedRecordType: "growthmind_publishing_jobs", affectedRecordId: i.jobId };
  },
});

// Emergency & resource controls — workspace_settings switches, honoured by the ticks.

async function setWorkspaceFlag(workspaceId: string, patch: Record<string, unknown>): Promise<void> {
  const admin = await getAdmin();
  const { data: existing, error } = await admin.from("workspace_settings")
    .select("workspace_id").eq("workspace_id", workspaceId).maybeSingle();
  if (error) throw new Error(error.message);
  if (existing) {
    const { error: uErr } = await admin.from("workspace_settings")
      .update({ ...patch, updated_at: nowIso() }).eq("workspace_id", workspaceId);
    if (uErr) throw new Error(uErr.message);
  } else {
    const { error: iErr } = await admin.from("workspace_settings")
      .insert({ workspace_id: workspaceId, ...patch });
    if (iErr) throw new Error(iErr.message);
  }
}

registerWrite({
  name: "pause_publishing",
  title: "Pause all publishing",
  description: "Emergency stop: pause ALL GrowthMind content publishing for this workspace. Scheduled jobs stay queued but will not execute until resumed.",
  idempotent: true,
  run: async (ctx) => {
    await setWorkspaceFlag(ctx.workspaceId, { growthmind_publishing_paused: true });
    return { result: { publishingPaused: true }, affectedRecordType: "workspace_settings", affectedRecordId: ctx.workspaceId };
  },
});

registerWrite({
  name: "resume_publishing",
  title: "Resume publishing",
  description: "Resume GrowthMind content publishing after a pause.",
  idempotent: true,
  requiredActionKey: "campaign_activation",
  run: async (ctx) => {
    await setWorkspaceFlag(ctx.workspaceId, { growthmind_publishing_paused: false });
    return { result: { publishingPaused: false }, affectedRecordType: "workspace_settings", affectedRecordId: ctx.workspaceId };
  },
});

registerWrite({
  name: "pause_growthmind_jobs",
  title: "Pause GrowthMind background jobs",
  description: "Pause GrowthMind background processing (trend discovery + CMO analysis) for this workspace.",
  idempotent: true,
  run: async (ctx) => {
    await setWorkspaceFlag(ctx.workspaceId, { growthmind_jobs_paused: true });
    return { result: { jobsPaused: true }, affectedRecordType: "workspace_settings", affectedRecordId: ctx.workspaceId };
  },
});

registerWrite({
  name: "resume_growthmind_jobs",
  title: "Resume GrowthMind background jobs",
  description: "Resume GrowthMind background processing after a pause.",
  idempotent: true,
  run: async (ctx) => {
    await setWorkspaceFlag(ctx.workspaceId, { growthmind_jobs_paused: false });
    return { result: { jobsPaused: false }, affectedRecordType: "workspace_settings", affectedRecordId: ctx.workspaceId };
  },
});

registerWrite({
  name: "update_growthmind_cost_limits",
  title: "Update GrowthMind cost limit",
  description: "SENSITIVE: set or clear the monthly AI-spend limit (USD) for GrowthMind in this workspace.",
  sensitive: true,
  requiredActionKey: "billing",
  inputSchema: z.object({ monthlyLimitUsd: z.number().min(0).max(1_000_000).nullable() }),
  run: async (ctx, i: { monthlyLimitUsd: number | null }) => {
    await setWorkspaceFlag(ctx.workspaceId, { growthmind_monthly_cost_limit_usd: i.monthlyLimitUsd });
    return { result: { monthlyLimitUsd: i.monthlyLimitUsd }, affectedRecordType: "workspace_settings", affectedRecordId: ctx.workspaceId };
  },
});

// Business DNA governance.

registerWrite({
  name: "resolve_dna_proposal",
  title: "Approve/reject Business DNA proposal",
  description: "SENSITIVE: approve (applies the change and snapshots a new DNA version) or reject a pending Business DNA update proposal.",
  sensitive: true,
  inputSchema: z.object({ proposalId: z.string().uuid(), decision: z.enum(["approve", "reject"]) }),
  run: async (ctx, i: { proposalId: string; decision: "approve" | "reject" }) => {
    const { resolveDnaProposalCore } = await import("@/lib/growthmind/growthmind.business-dna");
    const r = await resolveDnaProposalCore(ctx.workspaceId, ctx.userId, i);
    return { result: r as any, affectedRecordType: "growthmind_dna_proposals", affectedRecordId: i.proposalId };
  },
});

// Objectives + delegation.

registerWrite({
  name: "update_growthmind_objectives",
  title: "Set GrowthMind objective",
  description: "Create or update a commercial objective for GrowthMind (name, outcome, audience, platforms, dates, priority, budget, volume, approval requirements, success metrics).",
  inputSchema: z.lazy(() => {
    // String-literal import happens at run; schema is defined inline to stay client-safe.
    return z.object({
      id:                   z.string().uuid().optional(),
      name:                 z.string().min(3).max(300),
      businessOutcome:      z.string().max(2000).optional(),
      targetAudience:       z.string().max(2000).optional(),
      targetProduct:        z.string().max(1000).optional(),
      platforms:            z.array(z.string().max(50)).max(10).optional(),
      startDate:            z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      endDate:              z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      priority:             z.enum(["low", "medium", "high", "critical"]).optional(),
      budgetLimitUsd:       z.number().min(0).max(10_000_000).nullable().optional(),
      contentVolume:        z.number().int().min(0).max(10_000).nullable().optional(),
      approvalRequirements: z.string().max(2000).optional(),
      successMetrics:       z.array(z.string().max(300)).max(20).optional(),
    });
  }),
  run: async (ctx, input: any) => {
    const { saveGrowthMindObjective } = await import("@/lib/hivemind/growthmind-control/objectives.server");
    const r = await saveGrowthMindObjective(ctx.workspaceId, ctx.userId, input);
    return { result: r as any, affectedRecordType: "growthmind_objectives", affectedRecordId: r.id };
  },
});

registerWrite({
  name: "set_growthmind_objective_status",
  title: "Change objective status",
  description: "Pause, resume, complete or cancel a GrowthMind objective.",
  inputSchema: z.object({
    objectiveId: z.string().uuid(),
    status: z.enum(["active", "paused", "completed", "cancelled"]),
  }),
  run: async (ctx, i: { objectiveId: string; status: "active" | "paused" | "completed" | "cancelled" }) => {
    const { setGrowthMindObjectiveStatus } = await import("@/lib/hivemind/growthmind-control/objectives.server");
    await setGrowthMindObjectiveStatus(ctx.workspaceId, i.objectiveId, i.status);
    return { result: { status: i.status }, affectedRecordType: "growthmind_objectives", affectedRecordId: i.objectiveId };
  },
});

registerWrite({
  name: "create_growthmind_task",
  title: "Create marketing task",
  description: "Create a HiveMind task assigned to the marketing department (visible in the task centre; starts as 'suggested').",
  inputSchema: z.object({
    title: z.string().min(3).max(300),
    description: z.string().max(4000).optional(),
    priority: z.enum(["low", "medium", "high", "critical"]).optional(),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
  run: async (ctx, i: { title: string; description?: string; priority?: string; dueDate?: string }) => {
    const admin = await getAdmin();
    // Universal quality gate: a title+description directive is NOT a complete
    // proposal. It lands as a non-approvable investigation-state task — the
    // marketing Mind must resolve targets and gather evidence before anything
    // becomes approvable (no fake executable tasks from shallow directives).
    const { buildInvestigationPacket, prepareMindTaskInsert } =
      await import("@/lib/minds/intelligence-packet.server");
    const packet = buildInvestigationPacket({
      mind: "growthmind",
      objective: `${i.title}${i.description ? ` — ${i.description}` : ""}`.slice(0, 500),
      intentSource: "chat_tool:create_growthmind_task",
      instruction: i.title,
      missing: [
        "target resolution (which campaign/audience/asset this applies to)",
        "evidence retrieval",
        "diagnosis",
        "execution plan and approval scope",
      ],
    });
    const row = prepareMindTaskInsert({
      workspace_id: ctx.workspaceId,
      title: i.title,
      description: i.description ?? null,
      priority: i.priority ?? "medium",
      status: "suggested",
      assigned_to: "growthmind",
      due_date: i.dueDate ?? null,
      source: "hivemind_tool",
      trigger_type: "growthmind_directive",
      entity_type: "growthmind",
      metadata: { created_via: "hivemind.create_growthmind_task", created_by_user: ctx.userId },
    }, packet);
    const { data, error } = await admin.from("hivemind_tasks")
      .insert(row)
      .select("id").single();
    if (error) throw new Error(error.message);
    return { result: { taskId: data.id }, affectedRecordType: "hivemind_tasks", affectedRecordId: data.id };
  },
});

// ── Work-order backbone (chat-initiated executions) ──────────────────────────

registerWrite({
  name: "create_gads_analysis_work_order",
  title: "Create Google Ads analysis work order",
  description:
    "Create a work order with an executable GrowthMind task that analyses Google Ads performance and drafts change requests. " +
    "Use when the user asks to improve/optimise/analyse a Google Ads campaign or the account. " +
    "Pass campaignName when the user names a specific campaign — the tool resolves it against the real synced campaigns and focuses the analysis on it. " +
    "This is a PROPOSAL ONLY: nothing runs until the user clicks Approve & Run (shown in the chat and on the HiveMind Tasks page). " +
    "If the result is status:'ambiguous' or 'not_found', tell the user the candidate campaign names and ask them to pick one. " +
    "On success, explain the exact scope (campaign, lookback window, the 6 analysis steps, that changes are drafted as change requests only and NO live ad changes are made) and tell the user to press Approve & Run.",
  idempotent: false,
  inputSchema: z.object({
    campaignName: z.string().max(300).optional(),
    days: z.number().int().min(7).max(90).optional(),
    objective: z.string().max(2000).optional(),
  }),
  run: async (ctx, i: { campaignName?: string; days?: number; objective?: string }) => {
    // Resolve the named campaign against REAL synced campaign data.
    let focus: { campaignId: string; campaignName: string } | null = null;
    let candidates: Array<{ campaignId: string; name: string; status: string | null }> = [];
    if (i.campaignName?.trim()) {
      const { getGadsLiveCampaignSummary } = await import("@/lib/growthmind/gads-live-core.server");
      const summary = await getGadsLiveCampaignSummary(ctx.workspaceId, 90);
      const all = summary?.campaigns ?? [];
      if (!all.length) {
        return {
          result: {
            status: "not_found",
            error: "No synced Google Ads campaigns found for this workspace. Connect Google Ads in GrowthMind → Ads (or wait for the next sync), then try again.",
          },
        };
      }
      // Normalise a conversational phrase ("Improve the Search for US and
      // Reception campaign") down to the campaign-name part before matching.
      const INTENT_WORDS = new Set([
        "improve", "improving", "optimise", "optimize", "optimising", "optimizing",
        "analyse", "analyze", "review", "fix", "boost", "grow", "check",
        "campaign", "campaigns", "ads", "ad", "please", "my", "our", "the", "this", "that",
      ]);
      const norm = (s: string) => s.toLowerCase().replace(/["'’.,!?()]/g, "").replace(/\s+/g, " ").trim();
      const q = norm(i.campaignName);
      const qTokens = q.split(" ").filter((t) => t && !INTENT_WORDS.has(t));
      const exact = all.filter((c) => norm(c.name) === q);
      const partial = exact.length ? exact : all.filter((c) => {
        const n = norm(c.name);
        return n.includes(q) || q.includes(n) ||
          (qTokens.length > 0 && qTokens.every((t) => n.includes(t)));
      });
      if (partial.length === 1) {
        focus = { campaignId: partial[0].campaignId, campaignName: partial[0].name };
      } else if (partial.length > 1) {
        return {
          result: {
            status: "ambiguous",
            candidates: partial.slice(0, 8).map((c) => ({ campaignId: c.campaignId, name: c.name, status: c.status })),
          },
        };
      } else {
        candidates = all.slice(0, 10).map((c) => ({ campaignId: c.campaignId, name: c.name, status: c.status }));
        return { result: { status: "not_found", candidates } };
      }
    }

    const { createGadsAnalysisWorkOrderCore } = await import("@/lib/hivemind/work-orders.server");
    const { workOrder, task } = await createGadsAnalysisWorkOrderCore(
      ctx.sb, ctx.workspaceId, ctx.userId,
      {
        days: i.days ?? 30,
        objective: i.objective,
        focusCampaignId: focus?.campaignId ?? null,
        focusCampaignName: focus?.campaignName ?? null,
        source: "hivemind_chat",
      },
    );
    return {
      result: {
        status: "created",
        workOrderId: workOrder.id,
        taskId: task.id,
        taskTitle: task.title,
        focusCampaign: focus,
        days: (task.input_spec?.days as number) ?? 30,
        executionState: task.execution_status,
        readinessState: task.readiness_state ?? null,
        objective: (task.intelligence_packet?.objective as string) ?? workOrder.objective ?? null,
        approvalScopeSummary: (task.intelligence_packet?.approval_scope?.summary as string) ?? null,
        scope: {
          steps: [
            "Resolve connected Google Ads account",
            "Refresh campaign data from Google Ads",
            "Analyse campaigns, keywords and spend",
            "Compile analysis report",
            "Propose change-request action for approval",
            "Apply changes to Google Ads (external write — always blocked; GrowthMind is advisory-only)",
          ],
          external_writes: "never — change requests are internal drafts only",
        },
        next_step: "User must press Approve & Run (shown in this chat and on the HiveMind Tasks page).",
      },
      affectedRecordType: "work_orders",
      affectedRecordId: workOrder.id,
    };
  },
});

registerRead({
  name: "get_work_order_status",
  title: "Work order / execution status",
  description:
    "Get the REAL current state of a work order or executable task: task execution status, live step progress, linked approval action and its status, and the result summary. " +
    "Use this before answering any question about whether an analysis/work order ran, is running, is blocked or is waiting for an approval. Pass taskId or workOrderId; omit both for the most recent work orders.",
  inputSchema: z.object({
    taskId: z.string().uuid().optional(),
    workOrderId: z.string().uuid().optional(),
  }),
  run: async (ctx, i: { taskId?: string; workOrderId?: string }) => {
    const admin = await getAdmin();
    let tasksQ = admin.from("hivemind_tasks")
      .select("id, title, status, task_category, execution_status, active_execution_id, work_order_id, result_summary, created_at")
      .eq("workspace_id", ctx.workspaceId)
      .order("created_at", { ascending: false });
    if (i.taskId) tasksQ = tasksQ.eq("id", i.taskId);
    else if (i.workOrderId) tasksQ = tasksQ.eq("work_order_id", i.workOrderId);
    else tasksQ = tasksQ.not("work_order_id", "is", null).limit(5);
    const { data: tasks, error: te } = await tasksQ.limit(10);
    if (te) throw new Error(te.message);
    const out: any[] = [];
    for (const t of tasks ?? []) {
      const [{ data: execs }, { data: actions }] = await Promise.all([
        admin.from("mind_task_executions")
          .select("id, status, steps, blocked_reason, error_message, linked_action_id, result, started_at, finished_at")
          .eq("workspace_id", ctx.workspaceId).eq("task_id", t.id)
          .order("created_at", { ascending: false }).limit(1),
        admin.from("hivemind_actions")
          .select("id, title, status, action_type, executed_at, error_message")
          .eq("workspace_id", ctx.workspaceId).eq("task_id", t.id)
          .order("created_at", { ascending: false }).limit(3),
      ]);
      const latest = execs?.[0] ?? null;
      out.push({
        taskId: t.id, title: t.title, taskStatus: t.status,
        executionStatus: t.execution_status,
        workOrderId: t.work_order_id,
        resultSummary: t.result_summary,
        latestExecution: latest ? {
          id: latest.id, status: latest.status,
          steps: (latest.steps ?? []).map((s: any) => ({ label: s.label, status: s.status, detail: s.detail ?? null })),
          blockedReason: latest.blocked_reason, errorMessage: latest.error_message,
        } : null,
        linkedActions: (actions ?? []).map((a: any) => ({
          id: a.id, title: a.title, status: a.status, actionType: a.action_type,
          executedAt: a.executed_at, errorMessage: a.error_message,
        })),
      });
    }
    return { result: { workOrderTasks: out } };
  },
});

// ── Channel work orders (Task #488: sales/CRM & comms depth) ─────────────────
// Each tool creates a work order with SPLIT approval-stage tasks through the
// intelligence-packet quality gate. Proposals only — nothing sends/launches
// until every stage (including the blocked Send/Launch stage) is approved.

const audienceFilterSchema = z.object({
  pipelineStage: z.string().max(100).optional(),
  status: z.string().max(100).optional(),
  qualificationStatus: z.string().max(100).optional(),
  maxLeads: z.number().int().min(1).max(5000).optional(),
}).optional();

registerWrite({
  name: "create_sales_pipeline_work_order",
  title: "Create sales pipeline review work order",
  description:
    "Analyse the REAL sales pipeline (stage counts, stalled leads, never-contacted, duplicates, missing contact info) and create an evidence-backed review work order with record-tied proposed actions. " +
    "Use when the user asks to review/improve/clean the pipeline or sales process. PROPOSAL ONLY — no stage moves, no contacting. " +
    "On success, summarise the real findings (stalled counts, defects) and tell the user the review awaits their approval on the HiveMind Tasks page.",
  idempotent: false,
  inputSchema: z.object({
    objective: z.string().max(2000).optional(),
    stalledAfterDays: z.number().int().min(3).max(90).optional(),
  }),
  run: async (ctx, i: { objective?: string; stalledAfterDays?: number }) => {
    const { createSalesPipelineWorkOrderCore } = await import("@/lib/hivemind/channel-work-orders.server");
    const { workOrder, tasks, analysis } = await createSalesPipelineWorkOrderCore(
      ctx.sb, ctx.workspaceId, ctx.userId,
      { objective: i.objective, stalledAfterDays: i.stalledAfterDays, source: "hivemind_tool" },
    );
    const t = tasks[0];
    return {
      result: {
        status: "created",
        workOrderId: workOrder.id,
        taskId: t.id,
        taskTitle: t.title,
        readinessState: t.readiness_state ?? null,
        objective: workOrder.objective ?? null,
        approvalScopeSummary: (t.intelligence_packet?.approval_scope?.summary as string) ?? null,
        findings: {
          totalLeads: analysis.totalLeads,
          stalled: analysis.stalled.length,
          neverContacted: analysis.neverContacted,
          duplicatePhones: analysis.duplicatePhones,
          missingContactInfo: analysis.missingContactInfo,
          conversionPct: analysis.conversionPct,
        },
        next_step: "Review awaits approval on the HiveMind Tasks page. Nothing changes and no lead is contacted by this approval.",
      },
      affectedRecordType: "work_orders",
      affectedRecordId: workOrder.id,
    };
  },
});

registerWrite({
  name: "create_followup_sequence_work_order",
  title: "Create follow-up sequence work order",
  description:
    "Propose a multi-touch follow-up sequence (call/email/whatsapp/sms) for a lead segment with consent, opt-out, suppression and duplicate filtering applied to the REAL audience. " +
    "Creates split approval tasks: Audience, Sequence, Schedule, and a BLOCKED Send stage. Use when the user asks to follow up with / chase / re-engage leads. " +
    "PROPOSAL ONLY — no lead is contacted until every stage is approved. Report the real eligible-audience numbers and exclusions.",
  idempotent: false,
  inputSchema: z.object({
    channels: z.array(z.enum(["call", "email", "whatsapp", "sms"])).min(1).max(4).optional(),
    touches: z.number().int().min(1).max(8).optional(),
    audience: audienceFilterSchema,
    objective: z.string().max(2000).optional(),
  }),
  run: async (ctx, i: any) => {
    const { createFollowUpSequenceWorkOrderCore } = await import("@/lib/hivemind/channel-work-orders.server");
    const { workOrder, tasks, audienceSummary } = await createFollowUpSequenceWorkOrderCore(
      ctx.sb, ctx.workspaceId, ctx.userId,
      { channels: i.channels, touches: i.touches, audience: i.audience, objective: i.objective, source: "hivemind_tool" },
    );
    const first = tasks[0];
    return {
      result: {
        status: "created",
        workOrderId: workOrder.id,
        taskId: first.id,
        taskTitle: first.title,
        readinessState: first.readiness_state ?? null,
        objective: workOrder.objective ?? null,
        approvalScopeSummary: (first.intelligence_packet?.approval_scope?.summary as string) ?? null,
        audienceSummary,
        stages: tasks.map((t: any) => ({
          taskId: t.id, title: t.title,
          stage: t.metadata?.approval_stage_label ?? null,
          readinessState: t.readiness_state ?? null,
        })),
        next_step: "Each stage needs its own approval; the Send stage stays blocked until Audience, Sequence and Schedule are approved.",
      },
      affectedRecordType: "work_orders",
      affectedRecordId: workOrder.id,
    };
  },
});

registerWrite({
  name: "create_whatsapp_campaign_work_order",
  title: "Create WhatsApp campaign work order",
  description:
    "Propose a WhatsApp template campaign: resolves the REAL opted-in audience, connected provider (WATI) and synced approved templates, then creates split approval tasks (Audience, Template, Schedule, blocked Send). " +
    "Use when the user asks to message leads on WhatsApp. Only explicitly opted-in leads are ever included. " +
    "If the provider is not connected, the work order is created in Integration Required state — say so honestly. PROPOSAL ONLY.",
  idempotent: false,
  inputSchema: z.object({
    templateName: z.string().max(200).optional(),
    audience: audienceFilterSchema,
    objective: z.string().max(2000).optional(),
  }),
  run: async (ctx, i: any) => {
    const { createWhatsAppCampaignWorkOrderCore } = await import("@/lib/hivemind/channel-work-orders.server");
    const { workOrder, tasks, providerConnected, audienceSummary } = await createWhatsAppCampaignWorkOrderCore(
      ctx.sb, ctx.workspaceId, ctx.userId,
      { templateName: i.templateName, audience: i.audience, objective: i.objective, source: "hivemind_tool" },
    );
    const first = tasks[0];
    return {
      result: {
        status: "created",
        workOrderId: workOrder.id,
        taskId: first.id,
        taskTitle: first.title,
        readinessState: first.readiness_state ?? null,
        objective: workOrder.objective ?? null,
        approvalScopeSummary: (first.intelligence_packet?.approval_scope?.summary as string) ?? null,
        providerConnected,
        audienceSummary,
        stages: tasks.map((t: any) => ({
          taskId: t.id, title: t.title,
          stage: t.metadata?.approval_stage_label ?? null,
          readinessState: t.readiness_state ?? null,
        })),
        next_step: providerConnected
          ? "Each stage needs its own approval; the Send stage stays blocked until the earlier stages are approved."
          : "BLOCKED: connect a WhatsApp provider (WATI) first — every stage is in Integration Required state.",
      },
      affectedRecordType: "work_orders",
      affectedRecordId: workOrder.id,
    };
  },
});

registerWrite({
  name: "create_email_campaign_work_order",
  title: "Create email campaign work order",
  description:
    "Propose an email campaign: resolves the REAL eligible audience (suppression list enforced), sender-domain deliverability health and existing HexMail sequences, then creates split approval tasks (Audience, Copy, Sequence, Schedule, blocked Send). " +
    "Use when the user asks to email leads / run an email campaign. If no verified sender domain exists, the work order is created in Integration Required state — say so honestly. PROPOSAL ONLY.",
  idempotent: false,
  inputSchema: z.object({
    audience: audienceFilterSchema,
    objective: z.string().max(2000).optional(),
  }),
  run: async (ctx, i: any) => {
    const { createEmailCampaignWorkOrderCore } = await import("@/lib/hivemind/channel-work-orders.server");
    const { workOrder, tasks, deliverability, audienceSummary } = await createEmailCampaignWorkOrderCore(
      ctx.sb, ctx.workspaceId, ctx.userId,
      { audience: i.audience, objective: i.objective, source: "hivemind_tool" },
    );
    const first = tasks[0];
    return {
      result: {
        status: "created",
        workOrderId: workOrder.id,
        taskId: first.id,
        taskTitle: first.title,
        readinessState: first.readiness_state ?? null,
        objective: workOrder.objective ?? null,
        approvalScopeSummary: (first.intelligence_packet?.approval_scope?.summary as string) ?? null,
        deliverability,
        audienceSummary,
        stages: tasks.map((t: any) => ({
          taskId: t.id, title: t.title,
          stage: t.metadata?.approval_stage_label ?? null,
          readinessState: t.readiness_state ?? null,
        })),
        next_step: deliverability
          ? "Each stage needs its own approval; the Send stage stays blocked until the earlier stages are approved and the send gate passes."
          : "BLOCKED: add a verified sender domain in HexMail → Deliverability first — every stage is in Integration Required state.",
      },
      affectedRecordType: "work_orders",
      affectedRecordId: workOrder.id,
    };
  },
});

registerWrite({
  name: "create_call_campaign_work_order",
  title: "Create AI call campaign work order",
  description:
    "Propose an AI call campaign: resolves the REAL callable audience (Do-Not-Call excluded), the named agent against workspace agents, and creates split approval tasks (Audience, Agent & Script, Schedule, Volume, blocked Launch). " +
    "Pass agentName when the user names an agent; if the result is status 'ambiguous' or 'not_found', list the candidate agent names and ask the user to pick one. PROPOSAL ONLY — no calls until every stage is approved.",
  idempotent: false,
  inputSchema: z.object({
    agentName: z.string().max(200).optional(),
    audience: audienceFilterSchema,
    dailyVolume: z.number().int().min(1).max(500).optional(),
    objective: z.string().max(2000).optional(),
  }),
  run: async (ctx, i: any) => {
    const { createCallCampaignWorkOrderCore } = await import("@/lib/hivemind/channel-work-orders.server");
    const r = await createCallCampaignWorkOrderCore(
      ctx.sb, ctx.workspaceId, ctx.userId,
      { agentName: i.agentName, audience: i.audience, dailyVolume: i.dailyVolume, objective: i.objective, source: "hivemind_tool" },
    );
    if (r.agentStatus === "ambiguous" || r.agentStatus === "not_found") {
      return {
        result: {
          status: r.agentStatus,
          candidates: r.agentCandidates.map((a) => ({ id: a.id, name: a.name, deployed: a.deployed })),
        },
      };
    }
    const first = r.tasks[0];
    return {
      result: {
        status: "created",
        workOrderId: r.workOrder.id,
        taskId: first.id,
        taskTitle: first.title,
        readinessState: first.readiness_state ?? null,
        objective: r.workOrder.objective ?? null,
        approvalScopeSummary: (first.intelligence_packet?.approval_scope?.summary as string) ?? null,
        agent: r.agent,
        audienceSummary: r.audienceSummary,
        stages: r.tasks.map((t: any) => ({
          taskId: t.id, title: t.title,
          stage: t.metadata?.approval_stage_label ?? null,
          readinessState: t.readiness_state ?? null,
        })),
        next_step: "Each stage needs its own approval; the Launch stage stays blocked until the earlier stages are approved and the agent is deployed.",
      },
      affectedRecordType: "work_orders",
      affectedRecordId: r.workOrder.id,
    };
  },
});
