/**
 * GrowthMind Phase 5 — data for the Command Centre and Performance Lab views.
 *
 * Command Centre: one honest picture of the whole content operation —
 * pipeline counts, pending approvals, attention items, learning proposals.
 * Performance Lab: per-post checkpointed snapshot series + categorised
 * metrics + attribution, plus the accept/reject learning queue.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function getAdmin(): Promise<any> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

export const getCommandCentreData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const workspaceId = context.workspaceId!;
    const admin = await getAdmin();
    const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const [trendsRes, projectsRes, jobsRes, approvalsRes, learningsRes, tasksRes, connsRes, snapsRes] = await Promise.all([
      admin.from("growthmind_trend_items")
        .select("status").eq("workspace_id", workspaceId).gte("updated_at", since30d).limit(1000),
      admin.from("growthmind_content_projects")
        .select("id, title, status, target_platform, updated_at")
        .eq("workspace_id", workspaceId).neq("status", "archived")
        .order("updated_at", { ascending: false }).limit(100),
      admin.from("growthmind_publishing_jobs")
        .select("id, status, platform, scheduled_at, published_at, external_permalink, error_message, project_id")
        .eq("workspace_id", workspaceId).gte("created_at", since30d)
        .order("created_at", { ascending: false }).limit(100),
      admin.from("hivemind_actions")
        .select("id, title, status, sensitive, created_at, action_payload")
        .eq("workspace_id", workspaceId)
        .eq("action_type", "growthmind_publish_content")
        .eq("status", "pending")
        .order("created_at", { ascending: false }).limit(20),
      admin.from("growthmind_learned_patterns")
        .select("id, pattern_kind, pattern_key, insight, status, created_at")
        .eq("workspace_id", workspaceId).eq("status", "proposed")
        .order("created_at", { ascending: false }).limit(20),
      admin.from("hivemind_tasks")
        .select("id, title, description, priority, status, trigger_type, created_at")
        .eq("workspace_id", workspaceId)
        .like("trigger_type", "growthmind_%")
        .neq("status", "completed")
        .order("created_at", { ascending: false }).limit(30),
      admin.from("growthmind_social_connections")
        .select("id, provider, account_type, account_name, username, status, token_expires_at")
        .eq("workspace_id", workspaceId).neq("status", "disconnected"),
      admin.from("growthmind_performance_snapshots")
        .select("publishing_job_id, captured_at, metrics")
        .eq("workspace_id", workspaceId)
        .order("captured_at", { ascending: false }).limit(60),
    ]);

    const trendCounts: Record<string, number> = {};
    for (const t of trendsRes.data ?? []) trendCounts[t.status] = (trendCounts[t.status] ?? 0) + 1;
    const projectCounts: Record<string, number> = {};
    for (const p of projectsRes.data ?? []) projectCounts[p.status] = (projectCounts[p.status] ?? 0) + 1;
    const jobCounts: Record<string, number> = {};
    for (const j of jobsRes.data ?? []) jobCounts[j.status] = (jobCounts[j.status] ?? 0) + 1;

    return {
      trendCounts,
      projectCounts,
      jobCounts,
      projects:        (projectsRes.data ?? []).slice(0, 12),
      recentJobs:      (jobsRes.data ?? []).slice(0, 12),
      pendingApprovals: approvalsRes.data ?? [],
      proposedLearnings: learningsRes.data ?? [],
      attentionTasks:  tasksRes.data ?? [],
      connections:     connsRes.data ?? [],
      recentSnapshots: (snapsRes.data ?? []).slice(0, 20),
    };
  });

export const getPerformanceLabData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const workspaceId = context.workspaceId!;
    const admin = await getAdmin();
    const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

    const [jobsRes, snapsRes, patternsRes] = await Promise.all([
      admin.from("growthmind_publishing_jobs")
        .select("id, platform, target_type, external_post_id, external_permalink, published_at, project_id")
        .eq("workspace_id", workspaceId).eq("status", "published")
        .gte("published_at", since)
        .order("published_at", { ascending: false }).limit(50),
      admin.from("growthmind_performance_snapshots")
        .select("publishing_job_id, captured_at, metrics")
        .eq("workspace_id", workspaceId)
        .gte("captured_at", since)
        .order("captured_at", { ascending: true }).limit(1000),
      admin.from("growthmind_learned_patterns")
        .select("*")
        .eq("workspace_id", workspaceId)
        .in("status", ["proposed", "accepted", "rejected"])
        .order("created_at", { ascending: false }).limit(100),
    ]);

    const jobs = jobsRes.data ?? [];
    const projectIds = [...new Set(jobs.map((j: any) => j.project_id).filter(Boolean))];
    let titles: Record<string, string> = {};
    if (projectIds.length > 0) {
      const { data: projs } = await admin.from("growthmind_content_projects")
        .select("id, title").eq("workspace_id", workspaceId).in("id", projectIds);
      for (const p of projs ?? []) titles[p.id] = p.title;
    }

    const snapsByJob: Record<string, any[]> = {};
    for (const s of snapsRes.data ?? []) {
      (snapsByJob[s.publishing_job_id] ??= []).push({ captured_at: s.captured_at, metrics: s.metrics });
    }

    return {
      posts: jobs.map((j: any) => ({
        ...j,
        title: (j.project_id && titles[j.project_id]) || null,
        snapshots: snapsByJob[j.id] ?? [],
      })),
      patterns: patternsRes.data ?? [],
    };
  });
