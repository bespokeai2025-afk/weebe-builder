/**
 * Runtime Definition Contract — public re-export surface.
 *
 * All canonical types now derive from schema.ts (the ground truth).
 * This file re-exports them for backward compatibility and adds
 * the lightweight AgentRuntimeSummary shape (summary endpoint only).
 *
 * Consumers should import from "@/lib/runtime/schema" for the full schema
 * (Zod validators, z.infer types) or from this file for convenience re-exports.
 */

// ─── Re-export everything from schema (ground truth) ─────────────────────────

export {
  RUNTIME_VERSION,
  BUILDER_VERSION,
  SUPPORTED_RUNTIME_VERSIONS,
  DeploymentModeSchema,
  AgentRuntimeDefinitionSchema,
  RuntimeModelConfigSchema,
  RuntimeWorkflowSchema,
  RuntimeKnowledgeBaseSchema,
  RuntimeVoiceConfigSchema,
  RuntimeProviderConfigSchema,
  BuilderVariableSchema,
  WorkflowNodeSchema,
  WorkflowEdgeSchema,
  RetellToolSchema,
  validateRuntimeDefinition,
  parseRuntimeDefinition,
} from "./schema";

export type {
  DeploymentMode,
  AgentRuntimeDefinition,
  RuntimeModelConfig,
  RuntimeWorkflow,
  RuntimeKnowledgeBase,
  RuntimeVoiceConfig,
  RuntimeProviderConfig,
  RetellRuntimeConfig,
  OpenAIRuntimeConfig,
  BuilderVariable,
  WorkflowNode,
  WorkflowEdge,
  WorkflowNodeData,
  NodeKind,
  RetellTool,
  ValidationResult,
} from "./schema";

// ─── Summary (lightweight — summary endpoint only) ───────────────────────────

import type { AgentRuntimeDefinition, DeploymentMode } from "./schema";

/**
 * Lightweight summary returned by GET /api/runtime/agent/:id.
 * Does not include the full workflow graph, compiled prompt, or provider JSON.
 * Use GET /api/runtime/agent/:id/export for the complete definition.
 */
export interface AgentRuntimeSummary {
  runtimeVersion: string;
  builderVersion: string;
  exportedAt: string;
  agentId: string;
  agentName: string;
  retellAgentId: string | null;
  provider: DeploymentMode;
  model: { id: string; temperature: number };
  voiceId: string;
  language: string;
  hasRetellConfig: boolean;
  hasOpenAIConfig: boolean;
  variableCount: number;
  toolCount: number;
  knowledgeBaseIds: string[];
  updatedAt: string;
}

/** Summarise a full definition into its lightweight form. */
export function summariseDefinition(
  def: AgentRuntimeDefinition,
  updatedAt: string,
): AgentRuntimeSummary {
  return {
    runtimeVersion: def.runtimeVersion,
    builderVersion: def.builderVersion,
    exportedAt: def.exportedAt,
    agentId: def.agentId,
    agentName: def.agentName,
    retellAgentId: def.retellAgentId,
    provider: def.provider,
    model: { id: def.model.id, temperature: def.model.temperature },
    voiceId: def.voiceConfig.voiceId,
    language: def.voiceConfig.language,
    hasRetellConfig: Boolean(def.runtimeConfig.retell),
    hasOpenAIConfig: Boolean(def.runtimeConfig.openai),
    variableCount: def.variables.length,
    toolCount: def.tools.length,
    knowledgeBaseIds: def.knowledgeBase.ids,
    updatedAt,
  };
}
