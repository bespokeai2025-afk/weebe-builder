// ── SystemMind CTO Dashboard — createServerFn wrappers ────────────────────────
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function apiKey(context: any): string {
  const settings = (context as any).settings ?? {};
  const key = process.env.OPENAI_API_KEY ?? settings.openai_api_key;
  if (!key) throw new Error("OpenAI API key not configured. Add it in Settings → Integrations.");
  return key;
}

// ── Issues ────────────────────────────────────────────────────────────────────
export const getSystemMindIssues = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const { getSystemMindIssuesServer } = await import("./systemmind-cto.server");
    return getSystemMindIssuesServer(workspaceId);
  });

// ── Providers ─────────────────────────────────────────────────────────────────
export const getSystemMindProviders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const { getSystemMindProvidersServer } = await import("./systemmind-cto.server");
    return getSystemMindProvidersServer(workspaceId);
  });

// ── Recommendations ───────────────────────────────────────────────────────────
export const listSystemMindRecommendations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const { listSystemMindRecommendationsServer } = await import("./systemmind-cto.server");
    return listSystemMindRecommendationsServer(workspaceId);
  });

export const generateSystemMindRecommendations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({}).parse(input ?? {}))
  .handler(async ({ context }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const key = apiKey(context);
    const { generateSystemMindRecommendationsServer } = await import("./systemmind-cto.server");
    return generateSystemMindRecommendationsServer(workspaceId, key);
  });

export const dismissSystemMindRecommendation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string() }).parse(input))
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const { dismissSystemMindRecommendationServer } = await import("./systemmind-cto.server");
    await dismissSystemMindRecommendationServer(workspaceId, data.id);
    return { ok: true };
  });

// ── Audits ────────────────────────────────────────────────────────────────────
export const listSystemMindAudits = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const { listSystemMindAuditsServer } = await import("./systemmind-cto.server");
    return listSystemMindAuditsServer(workspaceId);
  });

export const runSystemMindAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({}).parse(input ?? {}))
  .handler(async ({ context }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const key = apiKey(context);
    const { runSystemMindAuditServer } = await import("./systemmind-cto.server");
    const auditId = await runSystemMindAuditServer(workspaceId, key);
    return { auditId };
  });

// ── Fix Plans ─────────────────────────────────────────────────────────────────
export const listSystemMindFixPlans = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const { listSystemMindFixPlansServer } = await import("./systemmind-cto.server");
    return listSystemMindFixPlansServer(workspaceId);
  });

export const generateSystemMindFixPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ title: z.string(), detail: z.string(), sourceType: z.string().optional(), sourceId: z.string().optional() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const key = apiKey(context);
    const { generateSystemMindFixPlanServer } = await import("./systemmind-cto.server");
    return generateSystemMindFixPlanServer(workspaceId, data, key);
  });

export const updateFixPlanStep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ planId: z.string(), stepIdx: z.number(), done: z.boolean() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const { updateFixPlanStepServer } = await import("./systemmind-cto.server");
    await updateFixPlanStepServer(workspaceId, data.planId, data.stepIdx, data.done);
    return { ok: true };
  });

// ── Tasks ─────────────────────────────────────────────────────────────────────
export const listSystemMindTasks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const { listSystemMindTasksServer } = await import("./systemmind-cto.server");
    return listSystemMindTasksServer(workspaceId);
  });

export const createSystemMindTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      title: z.string(),
      description: z.string().optional(),
      priority: z.string().optional(),
      status: z.string().optional(),
      due_at: z.string().nullable().optional(),
      tags: z.array(z.string()).optional(),
    }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const { createSystemMindTaskServer } = await import("./systemmind-cto.server");
    return createSystemMindTaskServer(workspaceId, data);
  });

export const updateSystemMindTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      id: z.string(),
      title: z.string().optional(),
      description: z.string().optional(),
      priority: z.string().optional(),
      status: z.string().optional(),
      due_at: z.string().nullable().optional(),
      tags: z.array(z.string()).optional(),
    }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const { id, ...patch } = data;
    const { updateSystemMindTaskServer } = await import("./systemmind-cto.server");
    await updateSystemMindTaskServer(workspaceId, id, patch);
    return { ok: true };
  });

export const deleteSystemMindTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string() }).parse(input))
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const { deleteSystemMindTaskServer } = await import("./systemmind-cto.server");
    await deleteSystemMindTaskServer(workspaceId, data.id);
    return { ok: true };
  });

// ── Reports ───────────────────────────────────────────────────────────────────
export const listSystemMindReports = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const { listSystemMindReportsServer } = await import("./systemmind-cto.server");
    return listSystemMindReportsServer(workspaceId);
  });

export const getSystemMindReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string() }).parse(input))
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const { getSystemMindReportServer } = await import("./systemmind-cto.server");
    return getSystemMindReportServer(workspaceId, data.id);
  });

export const generateSystemMindReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({}).parse(input ?? {}))
  .handler(async ({ context }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const key = apiKey(context);
    const { generateSystemMindReportServer } = await import("./systemmind-cto.server");
    return generateSystemMindReportServer(workspaceId, key);
  });

// ── Architecture ──────────────────────────────────────────────────────────────
export const getArchitectureLayers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const { getArchitectureLayersServer } = await import("./systemmind-cto.server");
    return getArchitectureLayersServer(workspaceId);
  });

// ── CTO Settings ──────────────────────────────────────────────────────────────
export const getSystemMindCTOSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const { getSystemMindCTOSettingsServer } = await import("./systemmind-cto.server");
    return getSystemMindCTOSettingsServer(workspaceId);
  });

export const saveSystemMindCTOSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      persona: z.enum(["professional", "concise", "friendly"]).optional(),
      morningBriefing: z.boolean().optional(),
      autoScanInterval: z.enum(["off", "daily", "weekly"]).optional(),
      errorRateThreshold: z.number().optional(),
      costDailyThreshold: z.number().optional(),
      defaultAiModel: z.enum(["gpt-4o-mini", "gpt-4o", "gpt-3.5-turbo"]).optional(),
      notificationsEnabled: z.boolean().optional(),
      providerPriority: z.array(z.string()).optional(),
    }).parse(input ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const { saveSystemMindCTOSettingsServer } = await import("./systemmind-cto.server");
    await saveSystemMindCTOSettingsServer(workspaceId, data);
    return { ok: true };
  });
