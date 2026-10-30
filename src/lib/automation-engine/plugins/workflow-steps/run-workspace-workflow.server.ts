/**
 * Run a Workflow Builder workflow on the automation engine.
 *
 * Replaces the old workflow engine's runner. Runs are recorded in automation_workflow_executions
 * (workflow_id = workspace_workflows.id) with every step, so the Workflow Builder's run history,
 * the WBAH executions and every other automation share one store, one retention job and one set of
 * error rules. The old workflow_runs table is no longer written.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { executeWorkflowWithPersistence } from "../../executor/execute-with-persistence";
import { ensureAutomationEngineBootstrapped } from "../../bootstrap";
import { stepListToAutomationDocument } from "./register-workflow-step-nodes";
import { notifyWorkflowError } from "./workflow-step-handlers.server";

export type WorkspaceWorkflowRunResult = {
  executionId: string;
  status: string;
  error: string | null;
};

export async function runWorkspaceWorkflow(input: {
  workspaceId: string;
  workflow: { id: string; name?: string | null; flow_definition: unknown };
  triggerType: string;
  triggerData?: Record<string, unknown>;
  leadId?: string;
  /** "manual" for a user's Run button, "production" for event triggers. */
  mode: "manual" | "production";
}): Promise<WorkspaceWorkflowRunResult> {
  ensureAutomationEngineBootstrapped();
  const name = input.workflow.name || "Workflow";
  const doc = stepListToAutomationDocument(input.workflow.flow_definition, name);
  const result = await executeWorkflowWithPersistence(doc, {
    workspaceId: input.workspaceId,
    workflowId: input.workflow.id,
    source: input.mode === "manual" ? "manual" : "queue",
    mode: input.mode,
    trigger: {
      trigger_type: input.triggerType,
      ...(input.triggerData ?? {}),
      _workflow: { workspaceId: input.workspaceId, leadId: input.leadId },
    },
    maxNodes: 60,
  });
  const error = result.status === "failed" ? (result.lastError ?? "Workflow failed") : null;
  if (error) {
    await notifyWorkflowError({
      workspaceId: input.workspaceId,
      workflowName: name,
      runId: result.executionId,
      errorMessage: error,
    }).catch(() => {});
  }
  return { executionId: result.executionId, status: result.status, error };
}

/**
 * Fire every ACTIVE "lead_added" workflow for a new lead (e.g. a webform submission). A workflow
 * whose trigger_config names a lead_source runs only for that source; a webform_name narrows it to
 * one form. Best-effort — never throws.
 */
export async function dispatchLeadAddedWorkflows(opts: {
  workspaceId: string;
  leadId: string;
  leadSource: "webform" | "crm" | "manual";
  webformName?: string;
  triggerData?: Record<string, unknown>;
}): Promise<void> {
  const sb = supabaseAdmin as any;
  try {
    const { data: wfs } = await sb
      .from("workspace_workflows")
      .select("id, name, flow_definition, trigger_config, status")
      .eq("workspace_id", opts.workspaceId)
      .eq("trigger_type", "lead_added")
      .eq("status", "active")
      .limit(20);
    for (const wf of (wfs ?? []) as Array<{
      id: string;
      name: string | null;
      flow_definition: unknown;
      trigger_config: Record<string, unknown> | null;
    }>) {
      const tc = wf.trigger_config ?? {};
      const wantSource = String(tc.lead_source ?? "").toLowerCase();
      if (wantSource && wantSource !== opts.leadSource) continue;
      const wantForm = String(tc.webform_name ?? "").trim().toLowerCase();
      if (wantForm && wantForm !== String(opts.webformName ?? "").trim().toLowerCase()) continue;
      try {
        await runWorkspaceWorkflow({
          workspaceId: opts.workspaceId,
          workflow: wf,
          triggerType: "lead_added",
          triggerData: {
            lead_source: opts.leadSource,
            webform_name: opts.webformName ?? null,
            ...(opts.triggerData ?? {}),
          },
          leadId: opts.leadId,
          mode: "production",
        });
      } catch (e) {
        console.error(`[workflow] lead_added run failed for ${wf.id}:`, (e as Error).message);
      }
    }
  } catch (e) {
    console.error("[workflow] dispatchLeadAddedWorkflows failed:", (e as Error).message);
  }
}
