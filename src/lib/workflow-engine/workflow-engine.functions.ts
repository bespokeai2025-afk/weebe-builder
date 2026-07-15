import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { executeWorkflowRun } from "@/lib/workflow-engine/workflow-executor.server";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface WorkflowTemplate {
  id:              string;
  category_id:     string | null;
  name:            string;
  description:     string | null;
  tags:            string[];
  trigger_type:    string;
  flow_definition: Record<string, unknown>;
  status:          "draft" | "published" | "archived";
  version:         number;
  created_at:      string;
  updated_at:      string;
  category?:       { name: string; icon: string | null } | null;
}

export interface WorkspaceWorkflow {
  id:               string;
  workspace_id:     string;
  template_id:      string | null;
  name:             string;
  description:      string | null;
  trigger_type:     string;
  trigger_config:   Record<string, unknown>;
  flow_definition:  Record<string, unknown>;
  status:           "active" | "inactive" | "paused" | "error";
  created_at:       string;
  updated_at:       string;
  run_count?:       number;
  last_run_at?:     string | null;
  // Build Workspace provenance (set when built/edited by SystemMind)
  source?:                  string | null;
  source_build_session_id?: string | null;
  source_build_version?:    number | null;
}

export interface WorkflowRun {
  id:           string;
  workspace_id: string;
  workflow_id:  string;
  trigger_type: string | null;
  status:       string;
  started_at:   string;
  completed_at: string | null;
  error:        string | null;
  summary:      Record<string, unknown>;
  workflow?:    { name: string } | null;
}

// ── Platform admin: template management ───────────────────────────────────────

export const listWorkflowTemplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as any;
    const { data, error } = await sb
      .from("workflow_templates")
      .select("*, category:workflow_template_categories(name, icon)")
      .order("status")
      .order("name");
    if (error) throw new Error(error.message);
    return (data ?? []) as WorkflowTemplate[];
  });

export const listWorkflowTemplateCategories = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as any;
    const { data, error } = await sb
      .from("workflow_template_categories")
      .select("*")
      .order("sort_order");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const saveWorkflowTemplate = createServerFn({ method: "POST" })
  .middleware([requirePlatformAdmin])
  .inputValidator((input) =>
    z.object({
      id:              z.string().optional(),
      category_id:     z.string().nullable().optional(),
      name:            z.string().min(1),
      description:     z.string().nullable().optional(),
      tags:            z.array(z.string()).optional(),
      trigger_type:    z.string().min(1),
      flow_definition: z.record(z.unknown()).optional(),
      status:          z.enum(["draft","published","archived"]).optional(),
    }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const sb = context.supabase as any;
    const now = new Date().toISOString();
    if (data.id) {
      const { error } = await sb.from("workflow_templates").update({
        category_id:     data.category_id ?? null,
        name:            data.name,
        description:     data.description ?? null,
        tags:            data.tags ?? [],
        trigger_type:    data.trigger_type,
        flow_definition: data.flow_definition ?? {},
        status:          data.status ?? "draft",
        updated_at:      now,
      }).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: row, error } = await sb.from("workflow_templates").insert({
      category_id:     data.category_id ?? null,
      name:            data.name,
      description:     data.description ?? null,
      tags:            data.tags ?? [],
      trigger_type:    data.trigger_type,
      flow_definition: data.flow_definition ?? {},
      status:          data.status ?? "draft",
    }).select("id").maybeSingle();
    if (error) throw new Error(error.message);
    return { id: row?.id as string };
  });

export const deleteWorkflowTemplate = createServerFn({ method: "POST" })
  .middleware([requirePlatformAdmin])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const sb = context.supabase as any;
    const { error } = await sb.from("workflow_templates").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── Workspace: workflow instances ─────────────────────────────────────────────

export const listWorkspaceWorkflows = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const { data, error } = await sb
      .from("workspace_workflows")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const ids = (data ?? []).map((w: any) => w.id);
    let runCounts: Record<string, number> = {};
    let lastRuns: Record<string, string | null> = {};
    if (ids.length > 0) {
      const { data: runs } = await sb
        .from("workflow_runs")
        .select("workflow_id, started_at")
        .in("workflow_id", ids)
        .order("started_at", { ascending: false });
      for (const r of (runs ?? []) as any[]) {
        runCounts[r.workflow_id] = (runCounts[r.workflow_id] ?? 0) + 1;
        if (!lastRuns[r.workflow_id]) lastRuns[r.workflow_id] = r.started_at;
      }
    }
    return (data ?? []).map((w: any) => ({
      ...w,
      run_count: runCounts[w.id] ?? 0,
      last_run_at: lastRuns[w.id] ?? null,
    })) as WorkspaceWorkflow[];
  });

export const createWorkspaceWorkflow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      template_id:     z.string().uuid().optional(),
      name:            z.string().min(1),
      description:     z.string().nullable().optional(),
      trigger_type:    z.string().min(1),
      trigger_config:  z.record(z.unknown()).optional(),
      flow_definition: z.record(z.unknown()).optional(),
    }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const { requireResourceCapacity } = await import("@/lib/packages/entitlements.server");
    await requireResourceCapacity(workspaceId, "workflows");

    let flowDefinition = data.flow_definition ?? {};
    let templateVersion: number | null = null;

    if (data.template_id && !data.flow_definition) {
      const { data: tmpl } = await sb
        .from("workflow_templates")
        .select("flow_definition, version")
        .eq("id", data.template_id)
        .maybeSingle();
      if (tmpl) {
        flowDefinition = tmpl.flow_definition;
        templateVersion = tmpl.version;
      }
    }

    const { data: row, error } = await sb.from("workspace_workflows").insert({
      workspace_id:     workspaceId,
      template_id:      data.template_id ?? null,
      template_version: templateVersion,
      name:             data.name,
      description:      data.description ?? null,
      trigger_type:     data.trigger_type,
      trigger_config:   data.trigger_config ?? {},
      flow_definition:  flowDefinition,
      status:           "inactive",
    }).select("id").maybeSingle();
    if (error) throw new Error(error.message);
    return { id: row?.id as string };
  });

export const updateWorkspaceWorkflow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      id:              z.string().uuid(),
      name:            z.string().min(1).optional(),
      description:     z.string().nullable().optional(),
      trigger_type:    z.string().optional(),
      trigger_config:  z.record(z.unknown()).optional(),
      flow_definition: z.record(z.unknown()).optional(),
      status:          z.enum(["active","inactive","paused","error"]).optional(),
    }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.name            !== undefined) patch.name            = data.name;
    if (data.description     !== undefined) patch.description     = data.description;
    if (data.trigger_type    !== undefined) patch.trigger_type    = data.trigger_type;
    if (data.trigger_config  !== undefined) patch.trigger_config  = data.trigger_config;
    if (data.flow_definition !== undefined) patch.flow_definition = data.flow_definition;
    if (data.status          !== undefined) patch.status          = data.status;
    const { error } = await sb.from("workspace_workflows")
      .update(patch)
      .eq("id", data.id)
      .eq("workspace_id", workspaceId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteWorkspaceWorkflow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const { error } = await sb.from("workspace_workflows")
      .delete()
      .eq("id", data.id)
      .eq("workspace_id", workspaceId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── Workflow Runs ──────────────────────────────────────────────────────────────

export const listWorkflowRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const { data, error } = await sb
      .from("workflow_runs")
      .select("*, workflow:workspace_workflows(name)")
      .eq("workspace_id", workspaceId)
      .order("started_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return (data ?? []) as WorkflowRun[];
  });

export const manualTriggerWorkflow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ workflow_id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { data: wf, error: wfErr } = await sb
      .from("workspace_workflows")
      .select("id, name, flow_definition, status")
      .eq("id", data.workflow_id)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (wfErr || !wf) throw new Error("Workflow not found");
    if (wf.status === "error") throw new Error("Workflow is in error state — fix it before triggering");

    const { data: run, error: runErr } = await sb.from("workflow_runs").insert({
      workspace_id: workspaceId,
      workflow_id:  data.workflow_id,
      trigger_type: "manual",
      trigger_data: { triggered_by: "user" },
      status:       "running",
    }).select("id").maybeSingle();
    if (runErr) throw new Error(runErr.message);

    const runId = run?.id as string;
    try {
      const results = await executeWorkflowRun(
        wf.flow_definition as Record<string, unknown>,
        {
          workspaceId,
          runId,
          triggerData: { triggered_by: "user", trigger_type: "manual" },
          leadId: (data as any).lead_id ?? undefined,
        },
      );
      const failed  = results.filter(r => r.status === "error");
      const success = results.filter(r => r.status === "ok");
      await sb.from("workflow_runs").update({
        status:       failed.length > 0 ? "failed" : "completed",
        completed_at: new Date().toISOString(),
        error:        failed[0]?.error ?? null,
        summary:      {
          steps_total:     results.length,
          steps_ok:        success.length,
          steps_failed:    failed.length,
          steps_skipped:   results.filter(r => r.status === "skipped").length,
          mode: "live",
        },
      }).eq("id", runId);
      if (failed.length > 0) {
        const { notifyWorkflowError } = await import("@/lib/workflow-engine/workflow-executor.server");
        await notifyWorkflowError({
          workspaceId,
          workflowName: wf.name ?? null,
          runId,
          errorMessage: failed[0]?.error ?? null,
        });
      }
    } catch (e: any) {
      await sb.from("workflow_runs").update({
        status:       "failed",
        completed_at: new Date().toISOString(),
        error:        e?.message ?? String(e),
      }).eq("id", runId);
      const { notifyWorkflowError } = await import("@/lib/workflow-engine/workflow-executor.server");
      await notifyWorkflowError({
        workspaceId,
        workflowName: wf.name ?? null,
        runId,
        errorMessage: e?.message ?? String(e),
      });
      throw e;
    }
    return { run_id: runId };
  });

// ── Stats ──────────────────────────────────────────────────────────────────────

export const getWorkflowEngineStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const [wfRes, runsRes, templatesRes] = await Promise.all([
      sb.from("workspace_workflows").select("status").eq("workspace_id", workspaceId),
      sb.from("workflow_runs").select("status").eq("workspace_id", workspaceId),
      sb.from("workflow_templates").select("id").eq("status", "published"),
    ]);

    const workflows: any[] = wfRes.data ?? [];
    const runs: any[] = runsRes.data ?? [];

    return {
      total_workflows:    workflows.length,
      active_workflows:   workflows.filter(w => w.status === "active").length,
      total_runs:         runs.length,
      successful_runs:    runs.filter(r => r.status === "completed").length,
      failed_runs:        runs.filter(r => r.status === "failed").length,
      published_templates: (templatesRes.data ?? []).length,
    };
  });
