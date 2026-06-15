import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// ── Scan agents → workflow library ────────────────────────────────────────────
export const scanAgentWorkflows = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const { scanAndStoreAgentWorkflows } = await import(
      "@/lib/systemmind/systemmind-workflow.server"
    );
    return scanAndStoreAgentWorkflows(workspaceId);
  });

// ── List workflow library ─────────────────────────────────────────────────────
export const getWorkflowLibrary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ category: z.string().optional() }).parse(input ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const sb = supabaseAdmin as any;
    let q = sb
      .from("systemmind_workflow_library")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("scanned_at", { ascending: false });
    if (data.category) q = q.eq("category", data.category);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

// ── Extract workflow patterns (AI) ────────────────────────────────────────────
export const extractWorkflowPatterns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ category: z.string().optional() }).parse(input ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const settings = (context as any).settings ?? {};
    const apiKey = process.env.OPENAI_API_KEY ?? settings.openai_api_key;
    if (!apiKey) throw new Error("OpenAI API key not configured.");
    const { extractAndStorePatterns } = await import(
      "@/lib/systemmind/systemmind-workflow.server"
    );
    return extractAndStorePatterns(workspaceId, data.category, apiKey);
  });

// ── List workflow patterns ─────────────────────────────────────────────────────
export const getWorkflowPatterns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ category: z.string().optional() }).parse(input ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const sb = supabaseAdmin as any;
    let q = sb
      .from("systemmind_workflow_patterns")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("generated_at", { ascending: false });
    if (data.category) q = q.eq("category", data.category);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

// ── Create AI workflow draft ───────────────────────────────────────────────────
export const createWorkflowDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        description: z.string().min(5).max(500),
        category: z.string().min(1),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const settings = (context as any).settings ?? {};
    const apiKey = process.env.OPENAI_API_KEY ?? settings.openai_api_key;
    if (!apiKey) throw new Error("OpenAI API key not configured.");
    const { generateWorkflowDraft } = await import(
      "@/lib/systemmind/systemmind-workflow.server"
    );
    return generateWorkflowDraft(workspaceId, data, apiKey);
  });

// ── List workflow drafts ───────────────────────────────────────────────────────
export const getWorkflowDrafts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const sb = supabaseAdmin as any;
    const { data: rows, error } = await sb
      .from("systemmind_workflow_drafts")
      .select(
        "id, title, description, category, status, nodes, edges, variables, tools, webhook_suggestions, kb_suggestions, follow_up_suggestions, created_at",
      )
      .eq("workspace_id", workspaceId)
      .eq("status", "draft")
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

// ── Delete a draft ─────────────────────────────────────────────────────────────
export const deleteWorkflowDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const sb = supabaseAdmin as any;
    const { error } = await sb
      .from("systemmind_workflow_drafts")
      .delete()
      .eq("id", data.id)
      .eq("workspace_id", workspaceId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── Inspect workflow for issues ────────────────────────────────────────────────
export const inspectWorkflowRepair = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ agentId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const settings = (context as any).settings ?? {};
    const apiKey = process.env.OPENAI_API_KEY ?? settings.openai_api_key ?? "";
    const { analyzeWorkflowRepair } = await import(
      "@/lib/systemmind/systemmind-workflow.server"
    );
    return analyzeWorkflowRepair(workspaceId, data.agentId, apiKey);
  });

// ── Seed default repair playbooks ─────────────────────────────────────────────
export const seedSystemMindPlaybooks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const { seedRepairPlaybooks } = await import(
      "@/lib/systemmind/systemmind-workflow.server"
    );
    return seedRepairPlaybooks(workspaceId);
  });

// ── Seed Architecture KB + Workflow KB starter documents ──────────────────────
export const seedSystemMindKbs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ limit: z.number().int().min(1).max(10).optional() }).parse(input ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const { seedSystemMindKnowledgeBases } = await import(
      "@/lib/systemmind/systemmind-kb-seed.server"
    );
    return seedSystemMindKnowledgeBases(workspaceId, data.limit ?? 4);
  });

// ── List/search repair playbooks ──────────────────────────────────────────────
export const getRepairPlaybooks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        category: z.string().optional(),
        riskLevel: z.string().optional(),
        search: z.string().optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const sb = supabaseAdmin as any;
    let q = sb
      .from("systemmind_repair_playbooks")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("category")
      .order("risk_level");
    if (data.category) q = q.eq("category", data.category);
    if (data.riskLevel) q = q.eq("risk_level", data.riskLevel);
    if (data.search) q = q.ilike("problem", `%${data.search}%`);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

// ── List agents for the repair picker ─────────────────────────────────────────
export const getSystemMindAgentList = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const sb = supabaseAdmin as any;
    const { data, error } = await sb
      .from("agents")
      .select("id, name, agent_type, voice_provider")
      .eq("workspace_id", workspaceId)
      .order("name");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

// ── Workflow Intelligence: score + health + complexity ─────────────────────────
export const getWorkflowIntelligence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const { getWorkflowIntelligenceServer } = await import(
      "@/lib/systemmind/systemmind-workflow-intelligence.server"
    );
    return getWorkflowIntelligenceServer(workspaceId);
  });

// ── Clone workflow to draft ────────────────────────────────────────────────────
export const cloneWorkflowToDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ agentId: z.string().uuid(), newTitle: z.string().optional() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const { cloneWorkflowToDraftServer } = await import(
      "@/lib/systemmind/systemmind-workflow-intelligence.server"
    );
    return cloneWorkflowToDraftServer(workspaceId, data.agentId, data.newTitle ?? "");
  });

// ── Compare two workflows (AI) ─────────────────────────────────────────────────
export const compareWorkflows = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ agentIdA: z.string().uuid(), agentIdB: z.string().uuid() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const settings = (context as any).settings ?? {};
    const apiKey = process.env.OPENAI_API_KEY ?? settings.openai_api_key;
    if (!apiKey) throw new Error("OpenAI API key not configured.");
    const { compareWorkflowsServer } = await import(
      "@/lib/systemmind/systemmind-workflow-intelligence.server"
    );
    return compareWorkflowsServer(workspaceId, data.agentIdA, data.agentIdB, apiKey);
  });

// ── Generate from example template ────────────────────────────────────────────
export const generateFromExample = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        exampleKey: z.string().min(1),
        customDesc: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const settings = (context as any).settings ?? {};
    const apiKey = process.env.OPENAI_API_KEY ?? settings.openai_api_key;
    if (!apiKey) throw new Error("OpenAI API key not configured.");
    const { generateFromExampleServer } = await import(
      "@/lib/systemmind/systemmind-workflow-intelligence.server"
    );
    return generateFromExampleServer(workspaceId, data.exampleKey, data.customDesc ?? "", apiKey);
  });

// ── Workflow success rates: calls with call_status='completed' / total ─────────
export const getWorkflowSuccessRates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const { getWorkflowSuccessRatesServer } = await import(
      "@/lib/systemmind/systemmind-workflow-intelligence.server"
    );
    return getWorkflowSuccessRatesServer(workspaceId);
  });

// ── Preview or apply a safe auto-fix to flow_data ─────────────────────────────
export const previewAndApplyWorkflowFix = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        agentId: z.string().uuid(),
        issue: z.object({
          type: z.string(),
          nodeId: z.string().optional(),
          edgeId: z.string().optional(),
          problem: z.string(),
          impact: z.string(),
          suggestedFix: z.string(),
          confidence: z.number(),
          riskLevel: z.enum(["low", "medium", "high", "critical"]),
          rollbackPlan: z.string(),
        }),
        dryRun: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const { applyWorkflowFix } = await import(
      "@/lib/systemmind/systemmind-workflow.server"
    );
    return applyWorkflowFix(workspaceId, data.agentId, data.issue as any, data.dryRun);
  });

// ── Submit repair plan to HiveMind event log ──────────────────────────────────
export const submitRepairPlanToHiveMind = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        agentName: z.string(),
        summary: z.string(),
        issueCount: z.number(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    try {
      const { insertExecutiveEvent } = await import(
        "@/lib/executives/executive-bridge.server"
      );
      await insertExecutiveEvent(supabaseAdmin as any, workspaceId, {
        source: "systemmind",
        event_type: "workflow_repair_plan",
        summary: `SystemMind repair plan for "${data.agentName}": ${data.issueCount} issue(s) detected. ${data.summary.slice(0, 300)}`,
        severity: data.issueCount > 0 ? "warning" : "info",
      });
    } catch { /* graceful */ }
    return { ok: true };
  });
