// ── SystemMind setup wizard — server function entry points ───────────────────
// Thin createServerFn wrappers. workspace_id/user_id come ONLY from the auth
// middleware context — never from client input.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function gate(context: any, mode: "view" | "edit") {
  const { requireSystemMindView, requireSystemMindEdit } = await import("@/lib/systemmind/systemmind-access.server");
  if (mode === "edit") await requireSystemMindEdit(context.workspaceId, context.userId);
  else await requireSystemMindView(context.workspaceId, context.userId);
}

async function noWbah(workspaceId: string) {
  const { assertNotWbahWorkspace } = await import("@/lib/wbah-exclusion.shared");
  assertNotWbahWorkspace(workspaceId);
}

// ── Wizard status ─────────────────────────────────────────────────────────────

export const getWizardStatusFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { agentId?: string | null; activationId?: string | null }) =>
    z.object({ agentId: z.string().uuid().nullish(), activationId: z.string().uuid().nullish() }).parse(i))
  .handler(async ({ data, context }) => {
    await gate(context, "view");
    await noWbah(context.workspaceId);
    const { computeWizardStatus } = await import("@/lib/systemmind/call-runtime/setup-wizard.server");
    return computeWizardStatus({
      workspaceId: context.workspaceId,
      agentId: data.agentId ?? null,
      activationId: data.activationId ?? null,
    });
  });

export const listWizardAgentsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await gate(context, "view");
    await noWbah(context.workspaceId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await (supabaseAdmin as any)
      .from("agents")
      .select("id, name, agent_type, status, retell_agent_id, settings")
      .eq("workspace_id", context.workspaceId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((a: any) => ({
      id: a.id,
      name: a.name,
      agentType: a.agent_type,
      status: a.status,
      deployed: Boolean((a.settings as any)?.deployedRetellAgentId ?? a.retell_agent_id),
    }));
  });

// ── Draft / versioning / activation lifecycle ────────────────────────────────

export const getOrCreateDraftActivationFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { agentId: string; name?: string }) =>
    z.object({ agentId: z.string().uuid(), name: z.string().max(200).optional() }).parse(i))
  .handler(async ({ data, context }) => {
    await gate(context, "edit");
    const { getOrCreateDraftActivationServer } = await import("@/lib/systemmind/call-runtime/setup-wizard.server");
    return getOrCreateDraftActivationServer({
      workspaceId: context.workspaceId,
      userId: context.userId ?? null,
      agentId: data.agentId,
      name: data.name,
    });
  });

export const listActivationVersionsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { agentId: string }) => z.object({ agentId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await gate(context, "view");
    await noWbah(context.workspaceId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await (supabaseAdmin as any)
      .from("systemmind_workflow_activations")
      .select("id, name, status, version_number, parent_activation_id, test_passed, last_test_at, admin_override, override_reason, activated_at, deactivated_at, health_status, created_at, config")
      .eq("workspace_id", context.workspaceId)
      .eq("agent_id", data.agentId)
      .order("version_number", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const runWorkflowTestsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { activationId: string }) => z.object({ activationId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await gate(context, "edit");
    const { runWorkflowTestsServer } = await import("@/lib/systemmind/call-runtime/setup-wizard.server");
    return runWorkflowTestsServer({
      workspaceId: context.workspaceId,
      userId: context.userId ?? null,
      activationId: data.activationId,
    });
  });

export const activateWorkflowFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { activationId: string; overrideReason?: string }) =>
    z.object({ activationId: z.string().uuid(), overrideReason: z.string().max(500).optional() }).parse(i))
  .handler(async ({ data, context }) => {
    await gate(context, "edit");
    const { activateWorkflowServer } = await import("@/lib/systemmind/call-runtime/setup-wizard.server");
    return activateWorkflowServer({
      workspaceId: context.workspaceId,
      userId: context.userId ?? null,
      activationId: data.activationId,
      adminOverride: data.overrideReason ? { reason: data.overrideReason } : undefined,
    });
  });

export const setWorkflowStateFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { activationId: string; action: "pause" | "resume" | "rollback" }) =>
    z.object({ activationId: z.string().uuid(), action: z.enum(["pause", "resume", "rollback"]) }).parse(i))
  .handler(async ({ data, context }) => {
    await gate(context, "edit");
    const { setWorkflowStateServer } = await import("@/lib/systemmind/call-runtime/setup-wizard.server");
    return setWorkflowStateServer({
      workspaceId: context.workspaceId,
      userId: context.userId ?? null,
      activationId: data.activationId,
      action: data.action,
    });
  });

export const getWorkflowHealthFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { activationId: string }) => z.object({ activationId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await gate(context, "view");
    await noWbah(context.workspaceId);
    const { getWorkflowHealthServer } = await import("@/lib/systemmind/call-runtime/setup-wizard.server");
    return getWorkflowHealthServer({ workspaceId: context.workspaceId, activationId: data.activationId });
  });

// ── Triggers CRUD (wizard step 10) ───────────────────────────────────────────

const TriggerInputSchema = z.object({
  id: z.string().uuid().nullish(),
  agentId: z.string().uuid(),
  activationId: z.string().uuid().nullish(),
  name: z.string().max(200).optional(),
  triggerType: z.enum([
    "manual", "crm_lead_created", "crm_lead_changed", "webee_lead_created",
    "webee_lead_status", "csv_upload", "webform", "scheduled", "delay_after_creation",
    "callback", "api_webhook",
  ]),
  enabled: z.boolean().optional(),
  conditions: z.record(z.string(), z.unknown()).optional(),
  callingWindow: z.record(z.string(), z.unknown()).optional(),
  maxAttempts: z.number().int().min(1).max(10).optional(),
  dailyCap: z.number().int().min(1).max(2000).optional(),
  retryConfig: z.record(z.string(), z.unknown()).optional(),
  dedupWindowMinutes: z.number().int().min(0).max(43200).optional(),
  schedule: z.record(z.string(), z.unknown()).optional(),
});

export const saveCallTriggerFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: z.input<typeof TriggerInputSchema>) => TriggerInputSchema.parse(i))
  .handler(async ({ data, context }) => {
    await gate(context, "edit");
    await noWbah(context.workspaceId);
    const { saveCallTriggerServer } = await import("@/lib/systemmind/call-runtime/triggers.server");
    return saveCallTriggerServer({
      workspaceId: context.workspaceId,
      userId: context.userId ?? null,
      ...data,
      name: data.name ?? `${data.triggerType.replace(/_/g, " ")} trigger`,
    } as any);
  });

export const setTriggerEnabledFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string; enabled: boolean }) =>
    z.object({ id: z.string().uuid(), enabled: z.boolean() }).parse(i))
  .handler(async ({ data, context }) => {
    await gate(context, "edit");
    await noWbah(context.workspaceId);
    const { setTriggerEnabledServer } = await import("@/lib/systemmind/call-runtime/triggers.server");
    return setTriggerEnabledServer({ workspaceId: context.workspaceId, id: data.id, enabled: data.enabled });
  });

export const listCallTriggersFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { agentId: string }) => z.object({ agentId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await gate(context, "view");
    await noWbah(context.workspaceId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await (supabaseAdmin as any)
      .from("systemmind_call_triggers")
      .select("*")
      .eq("workspace_id", context.workspaceId)
      .eq("agent_id", data.agentId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

// ── Queue & execution timeline (visualisation drill-down) ────────────────────

export const listCallQueueFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { agentId?: string | null; status?: string | null }) =>
    z.object({ agentId: z.string().uuid().nullish(), status: z.string().max(40).nullish() }).parse(i))
  .handler(async ({ data, context }) => {
    await gate(context, "view");
    await noWbah(context.workspaceId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = (supabaseAdmin as any)
      .from("systemmind_call_queue")
      .select("*")
      .eq("workspace_id", context.workspaceId)
      .order("updated_at", { ascending: false })
      .limit(200);
    if (data.agentId) q = q.eq("agent_id", data.agentId);
    if (data.status) q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const controlQueueEntryFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string; action: "pause" | "resume" | "cancel" | "retry_now" }) =>
    z.object({ id: z.string().uuid(), action: z.enum(["pause", "resume", "cancel", "retry_now"]) }).parse(i))
  .handler(async ({ data, context }) => {
    await gate(context, "edit");
    await noWbah(context.workspaceId);
    const { controlQueueEntryServer } = await import("@/lib/systemmind/call-runtime/queue.server");
    return controlQueueEntryServer({ workspaceId: context.workspaceId, queueId: data.id, action: data.action });
  });

export const listWorkflowExecutionsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { agentId?: string | null; limit?: number }) =>
    z.object({ agentId: z.string().uuid().nullish(), limit: z.number().int().min(1).max(100).optional() }).parse(i))
  .handler(async ({ data, context }) => {
    await gate(context, "view");
    await noWbah(context.workspaceId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = (supabaseAdmin as any)
      .from("systemmind_workflow_executions")
      .select("*")
      .eq("workspace_id", context.workspaceId)
      .order("started_at", { ascending: false })
      .limit(data.limit ?? 30);
    if (data.agentId) q = q.eq("agent_id", data.agentId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const getExecutionTimelineFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { executionId: string }) => z.object({ executionId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await gate(context, "view");
    await noWbah(context.workspaceId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sb = supabaseAdmin as any;
    const [{ data: exec, error: e1 }, { data: steps, error: e2 }] = await Promise.all([
      sb.from("systemmind_workflow_executions").select("*")
        .eq("id", data.executionId).eq("workspace_id", context.workspaceId).maybeSingle(),
      sb.from("systemmind_execution_steps").select("*")
        .eq("execution_id", data.executionId).eq("workspace_id", context.workspaceId)
        .order("started_at", { ascending: true }),
    ]);
    if (e1) throw new Error(e1.message);
    if (e2) throw new Error(e2.message);
    if (!exec) throw new Error("execution_not_found");
    return { execution: exec, steps: steps ?? [] };
  });

export const listIntegrationErrorsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { agentId?: string | null } | undefined) =>
    z.object({ agentId: z.string().uuid().nullish() }).optional().parse(i ?? {}),
  )
  .handler(async ({ data, context }) => {
    await gate(context, "view");
    await noWbah(context.workspaceId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = (supabaseAdmin as any)
      .from("systemmind_integration_errors")
      .select("*")
      .eq("workspace_id", context.workspaceId)
      .in("status", ["pending", "retrying", "dead_letter"])
      .order("created_at", { ascending: false })
      .limit(100);
    if (data?.agentId) q = q.eq("agent_id", data.agentId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const retryIntegrationErrorFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string }) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await gate(context, "edit");
    await noWbah(context.workspaceId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sb = supabaseAdmin as any;
    // Reset for the retry sweep — verify ownership first.
    const { data: row } = await sb
      .from("systemmind_integration_errors")
      .select("id, status")
      .eq("id", data.id)
      .eq("workspace_id", context.workspaceId)
      .maybeSingle();
    if (!row) throw new Error("integration_error_not_found");
    const { error } = await sb
      .from("systemmind_integration_errors")
      .update({ status: "pending", next_retry_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
