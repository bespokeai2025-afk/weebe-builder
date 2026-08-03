/**
 * Generate canonical automation JSON from a WBAH pipeline and validate it.
 */
import type { WbahPostCallWorkflowConfig } from "@/lib/wbah/workflow/wbah-workflow-steps.shared";
import type { WorkflowDocument } from "./types/workflow.schema";
import { wbahPipelineToAutomationDocument } from "./adapters/wbah-graph.adapter";
import { parseWorkflowDocument } from "./parser/parse-workflow";
import { ensureAutomationEngineBootstrapped } from "./bootstrap";

export type AutomationSyncResult = {
  document: WorkflowDocument;
  validation: { valid: boolean; errors: string[] };
  validatedAt: string;
};

export function syncAutomationFromWbahPipeline(
  pipeline: WbahPostCallWorkflowConfig,
  opts?: { workflowId?: string },
): AutomationSyncResult {
  ensureAutomationEngineBootstrapped();
  const document = wbahPipelineToAutomationDocument(pipeline, opts);
  const parsed = parseWorkflowDocument(document);
  const validatedAt = new Date().toISOString();
  return {
    document,
    validation: parsed.ok
      ? { valid: true, errors: [] }
      : { valid: false, errors: parsed.errors },
    validatedAt,
  };
}

export function attachAutomationToWbahPipeline(
  pipeline: WbahPostCallWorkflowConfig,
  opts?: { workflowId?: string },
): WbahPostCallWorkflowConfig {
  const sync = syncAutomationFromWbahPipeline(pipeline, opts);
  return {
    ...pipeline,
    automation: sync.document as unknown as Record<string, unknown>,
    automation_validation: {
      valid: sync.validation.valid,
      errors: sync.validation.errors,
      validated_at: sync.validatedAt,
    },
  };
}
