/**
 * GrowthMind Phase 5 — chat tool actions.
 *
 * The GrowthMind AI assistant can take REAL actions (OpenAI function calling)
 * instead of only advising:
 *   Reads:  content pipeline, top trend recommendations, performance summary,
 *           learned patterns.
 *   Writes: send a recommendation to Content Studio; reschedule an
 *           ALREADY-APPROVED publishing job. Unapproved content can never be
 *           scheduled from chat — the tool reports honestly that approval is
 *           required. All writes are audited through the Mind tool registry.
 *
 * Failure honesty: every tool returns { ok, ... } or { ok:false, error } and
 * the model is instructed to report failures verbatim, never claim success.
 */

type Sb = any;

async function getAdmin(): Promise<Sb> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

const nowIso = () => new Date().toISOString();

// ── Tool schemas (OpenAI function-calling format) ─────────────────────────────

export const CHAT_TOOL_SCHEMAS = [
  {
    type: "function",
    function: {
      name: "get_content_pipeline",
      description: "Get the live GrowthMind content pipeline: trend recommendations, Content Studio projects by status, publishing jobs (scheduled/published/failed) and pending approvals.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_performance_summary",
      description: "Get checkpointed performance results for recently published posts: categorised metrics (attention/engagement/intent/conversion/revenue) and lead/booking attribution.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_learned_patterns",
      description: "Get the performance learnings GrowthMind has extracted (proposed and accepted patterns that steer future content scoring).",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "send_to_content_studio",
      description: "Send a trend/adaptation recommendation to Content Studio as a production project. Use the recommendation id from get_content_pipeline. This is a REAL write action.",
      parameters: {
        type: "object",
        properties: { recommendationId: { type: "string", description: "UUID of the growthmind content recommendation" } },
        required: ["recommendationId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reschedule_approved_publish",
      description: "Move the scheduled publish time of an ALREADY-APPROVED publishing job (status approved/scheduled). Cannot schedule unapproved content — approval must happen first in the HiveMind action centre. This is a REAL write action.",
      parameters: {
        type: "object",
        properties: {
          jobId:       { type: "string", description: "UUID of the publishing job (from get_content_pipeline)" },
          scheduledAt: { type: "string", description: "New publish time as an ISO 8601 datetime in the future" },
        },
        required: ["jobId", "scheduledAt"],
      },
    },
  },
] as const;

// ── Tool executor ─────────────────────────────────────────────────────────────

export async function executeChatTool(opts: {
  workspaceId: string;
  userId: string | null;
  name: string;
  args: Record<string, any>;
}): Promise<Record<string, unknown>> {
  const { workspaceId, userId, name, args } = opts;
  const admin = await getAdmin();

  try {
    switch (name) {
      case "get_content_pipeline": {
        const [recs, projects, jobs, approvals] = await Promise.all([
          admin.from("growthmind_content_recommendations")
            .select("id, title, status, format, target_platform, created_at")
            .eq("workspace_id", workspaceId)
            .in("status", ["recommended", "analysed", "drafting"])
            .order("created_at", { ascending: false }).limit(10),
          admin.from("growthmind_content_projects")
            .select("id, title, status, target_platform")
            .eq("workspace_id", workspaceId).neq("status", "archived")
            .order("updated_at", { ascending: false }).limit(15),
          admin.from("growthmind_publishing_jobs")
            .select("id, status, platform, scheduled_at, published_at, external_permalink, error_message, project_id")
            .eq("workspace_id", workspaceId)
            .order("created_at", { ascending: false }).limit(15),
          admin.from("hivemind_actions")
            .select("id, title, created_at")
            .eq("workspace_id", workspaceId)
            .eq("action_type", "growthmind_publish_content").eq("status", "pending")
            .limit(10),
        ]);
        return {
          ok: true,
          recommendations: recs.data ?? [],
          projects: projects.data ?? [],
          publishingJobs: jobs.data ?? [],
          pendingApprovals: approvals.data ?? [],
        };
      }

      case "get_performance_summary": {
        const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
        const { data: snaps, error } = await admin
          .from("growthmind_performance_snapshots")
          .select("publishing_job_id, captured_at, metrics")
          .eq("workspace_id", workspaceId)
          .gte("captured_at", since)
          .order("captured_at", { ascending: false }).limit(100);
        if (error) return { ok: false, error: error.message };
        // Latest snapshot per job, compact
        const seen = new Set<string>();
        const posts: any[] = [];
        for (const s of snaps ?? []) {
          if (seen.has(s.publishing_job_id)) continue;
          seen.add(s.publishing_job_id);
          const m = (s.metrics ?? {}) as any;
          posts.push({
            jobId: s.publishing_job_id,
            checkpoint: m.checkpoint,
            capturedAt: s.captured_at,
            categories: m.categories ?? {},
            attribution: m.attribution ?? {},
            captureError: m.capture_error ?? null,
          });
          if (posts.length >= 15) break;
        }
        return { ok: true, posts, note: posts.length === 0 ? "No performance snapshots yet — they appear automatically after content publishes." : undefined };
      }

      case "get_learned_patterns": {
        const { data, error } = await admin
          .from("growthmind_learned_patterns")
          .select("id, pattern_kind, pattern_key, insight, status, adjustment, sample_size, confidence")
          .eq("workspace_id", workspaceId)
          .in("status", ["proposed", "accepted"])
          .order("created_at", { ascending: false }).limit(30);
        if (error) return { ok: false, error: error.message };
        return { ok: true, patterns: data ?? [] };
      }

      case "send_to_content_studio": {
        const recommendationId = String(args.recommendationId ?? "");
        if (!/^[0-9a-f-]{36}$/i.test(recommendationId)) {
          return { ok: false, error: "recommendationId must be a valid UUID from get_content_pipeline." };
        }
        const { auditServerFnToolRun } = await import("@/lib/minds/tool-registry.server");
        return await auditServerFnToolRun(
          {
            workspaceId, userId, toolName: "growthmind.chat_send_to_content_studio",
            params: { recommendationId },
            affectedRecord: (r: any) => ({ type: "growthmind_content_projects", id: r?.projectId ?? null }),
            outcome: (r: any) => ({ ok: r?.ok !== false, error: r?.error }),
          },
          async () => {
            try {
              const { createProjectFromRecommendationCore } = await import("@/lib/growthmind/growthmind.content-projects");
              const result = await createProjectFromRecommendationCore(admin, workspaceId, userId, recommendationId);
              return { ok: true, ...result, next: "The project is now in Content Studio (in production). Media and caption must be finished, then it goes through approval before publishing." };
            } catch (e: any) {
              return { ok: false, error: String(e?.message ?? e) };
            }
          },
        );
      }

      case "reschedule_approved_publish": {
        const jobId = String(args.jobId ?? "");
        const scheduledAt = String(args.scheduledAt ?? "");
        if (!/^[0-9a-f-]{36}$/i.test(jobId)) return { ok: false, error: "jobId must be a valid UUID from get_content_pipeline." };
        const ts = new Date(scheduledAt);
        if (!Number.isFinite(ts.getTime())) return { ok: false, error: "scheduledAt is not a valid ISO datetime." };
        if (ts.getTime() < Date.now() + 60_000) return { ok: false, error: "scheduledAt must be in the future." };

        const { auditServerFnToolRun } = await import("@/lib/minds/tool-registry.server");
        return await auditServerFnToolRun(
          {
            workspaceId, userId, toolName: "growthmind.chat_reschedule_publish",
            params: { jobId, scheduledAt },
            affectedRecord: () => ({ type: "growthmind_publishing_jobs", id: jobId }),
            outcome: (r: any) => ({ ok: r?.ok !== false, error: r?.error }),
          },
          async () => {
            const { data: job, error } = await admin
              .from("growthmind_publishing_jobs")
              .select("id, status")
              .eq("id", jobId).eq("workspace_id", workspaceId).maybeSingle();
            if (error) return { ok: false, error: error.message };
            if (!job) return { ok: false, error: "Publishing job not found in this workspace." };
            if (!["approved", "scheduled"].includes(job.status)) {
              return {
                ok: false,
                error: `This job is "${job.status}" — only already-approved jobs can be rescheduled from chat. ${
                  job.status === "awaiting_approval"
                    ? "It still needs human approval in the HiveMind action centre first."
                    : job.status === "published"
                      ? "It has already been published."
                      : "Fix it from the Content Studio project page."
                }`,
              };
            }
            // CAS on current status so we never resurrect a job that moved on.
            const { data: updated, error: upErr } = await admin
              .from("growthmind_publishing_jobs")
              .update({ scheduled_at: ts.toISOString(), next_attempt_at: ts.toISOString(), updated_at: nowIso() })
              .eq("id", jobId).eq("workspace_id", workspaceId)
              .in("status", ["approved", "scheduled"])
              .select("id, scheduled_at");
            if (upErr) return { ok: false, error: upErr.message };
            if (!updated?.length) return { ok: false, error: "The job changed state while rescheduling — reload and try again." };
            return { ok: true, jobId, scheduledAt: updated[0].scheduled_at };
          },
        );
      }

      default:
        return { ok: false, error: `Unknown tool "${name}".` };
    }
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e).slice(0, 500) };
  }
}
