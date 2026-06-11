/**
 * Runtime Definition Contract — Zod Schema (ground truth)
 *
 * This file is the SINGLE SOURCE OF TRUTH for the AgentRuntimeDefinition shape.
 * All TypeScript types in this module are derived via z.infer — never written
 * by hand — so the runtime validator and the TypeScript compiler always agree.
 *
 * Rules enforced here:
 *   - Builder owns creation  →  schemas are exported for Builder-side .parse()
 *   - Runtime owns execution →  schemas are exported for Runtime-side .parse()
 *   - Runtime never generates prompts  →  compiledPrompt is required, non-empty string
 *   - Retell path untouched  →  RetellConfigSchema is additive; nothing here modifies Retell code
 *   - Providers interchangeable  →  runtimeConfig keys are all optional; provider enum is closed
 *
 * Versioning:
 *   Bump RUNTIME_SCHEMA_VERSION whenever any schema changes in a way that
 *   would cause a previously-valid export to fail validation.
 */

import { z } from "zod";

// ─── Version constants ────────────────────────────────────────────────────────

export const RUNTIME_VERSION = "1.0.0";
export const BUILDER_VERSION = "2.0.0";

/** All schema versions this build can validate (used by migrate.ts). */
export const SUPPORTED_RUNTIME_VERSIONS = ["1.0.0"] as const;
export type SupportedRuntimeVersion = (typeof SUPPORTED_RUNTIME_VERSIONS)[number];

// ─── Provider enum ────────────────────────────────────────────────────────────

export const DeploymentModeSchema = z.enum([
  "RETELL",
  "OPENAI_NATIVE",
  "CLAUDE_NATIVE",
  "GEMINI_NATIVE",
]);
export type DeploymentMode = z.infer<typeof DeploymentModeSchema>;

// ─── BuilderVariable ──────────────────────────────────────────────────────────

export const BuilderVariableSchema = z.object({
  name: z.string(),
  description: z.string(),
  type: z
    .enum(["string", "number", "boolean", "enum", "system-presets"])
    .optional(),
  defaultValue: z.string(),
  examples: z.array(z.string()).optional(),
});
export type BuilderVariable = z.infer<typeof BuilderVariableSchema>;

// ─── Model config ─────────────────────────────────────────────────────────────

export const RuntimeModelConfigSchema = z.object({
  /** Builder UI model ID, e.g. "gpt-4.1", "gpt-4.1-fast". */
  id: z.string().min(1),
  temperature: z.number().min(0).max(2),
  /** Only set for OPENAI_NATIVE provider. */
  openaiVoice: z.string().optional(),
  /** Only set for OPENAI_NATIVE provider. */
  openaiReasoningEffort: z.string().optional(),
});
export type RuntimeModelConfig = z.infer<typeof RuntimeModelConfigSchema>;

// ─── Workflow graph ───────────────────────────────────────────────────────────

/** All valid node kinds in the Builder conversation graph. */
export const NodeKindSchema = z.enum([
  "conversation",
  "function",
  "call_transfer",
  "press_digit",
  "logic_split",
  "agent_transfer",
  "sms",
  "extract_variable",
  "code",
  "ending",
  "note",
]);
export type NodeKind = z.infer<typeof NodeKindSchema>;

/** Transition edge within a single node's data. */
const NodeTransitionSchema = z.object({
  id: z.string(),
  condition: z.string(),
  target: z.string().nullable(),
});

/**
 * Builder node data (FlowNodeData shape).
 * Uses .passthrough() to preserve React Flow internal fields without
 * stripping them — round-trip fidelity is critical.
 */
export const WorkflowNodeDataSchema = z
  .object({
    kind: NodeKindSchema,
    label: z.string(),
    dialogue: z.string().default(""),
    isStart: z.boolean().optional(),
    startSpeaker: z.enum(["agent", "user"]).optional(),
    instructionType: z.enum(["prompt", "static_text"]).optional(),
    transitions: z.array(NodeTransitionSchema).optional(),
    isGlobalNode: z.boolean().optional(),
    toolId: z.string().optional(),
    speakDuringExecution: z.boolean().optional(),
    waitForResult: z.boolean().optional(),
    globalNodeSetting: z.record(z.unknown()).optional(),
  })
  .passthrough();
export type WorkflowNodeData = z.infer<typeof WorkflowNodeDataSchema>;

/**
 * Builder workflow node (React Flow Node<FlowNodeData> shape).
 * Passthrough preserves width, height, selected, and other React Flow fields.
 */
export const WorkflowNodeSchema = z
  .object({
    id: z.string().min(1),
    position: z.object({ x: z.number(), y: z.number() }),
    data: WorkflowNodeDataSchema,
    type: z.string().optional(),
  })
  .passthrough();
export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>;

/**
 * Builder workflow edge (React Flow Edge shape).
 * Passthrough preserves label, style, animated, and other React Flow fields.
 */
export const WorkflowEdgeSchema = z
  .object({
    id: z.string().min(1),
    source: z.string().min(1),
    target: z.string().min(1),
    sourceHandle: z.string().nullable().optional(),
    targetHandle: z.string().nullable().optional(),
  })
  .passthrough();
export type WorkflowEdge = z.infer<typeof WorkflowEdgeSchema>;

export const RuntimeWorkflowSchema = z.object({
  nodes: z.array(WorkflowNodeSchema),
  edges: z.array(WorkflowEdgeSchema),
  startNodeId: z.string().nullable(),
  globalPrompt: z.string(),
  beginMessage: z.string(),
  startSpeaker: z.enum(["agent", "user"]),
});
export type RuntimeWorkflow = z.infer<typeof RuntimeWorkflowSchema>;

// ─── Tools ────────────────────────────────────────────────────────────────────

/**
 * Retell tool definition.
 * Tools sourced from rawConversationFlow.tools are raw Retell API shapes —
 * they vary by tool_type. Using passthrough keeps all fields without
 * requiring an exhaustive Retell tool catalogue here.
 *
 * Phase 4 will replace this with a discriminated union per tool_type.
 */
export const RetellToolSchema = z
  .object({
    name: z.string().optional(),
    description: z.string().optional(),
    type: z.string().optional(),
    tool_id: z.string().optional(),
    tool_type: z.string().optional(),
  })
  .passthrough();
export type RetellTool = z.infer<typeof RetellToolSchema>;

// ─── Knowledge base ───────────────────────────────────────────────────────────

export const RuntimeKnowledgeBaseSchema = z.object({
  ids: z.array(z.string()),
  config: z.object({
    topK: z.number().int().positive(),
    filterScore: z.number().min(0).max(1),
  }),
});
export type RuntimeKnowledgeBase = z.infer<typeof RuntimeKnowledgeBaseSchema>;

// ─── Voice config ─────────────────────────────────────────────────────────────

export const RuntimeVoiceConfigSchema = z.object({
  voiceId: z.string(),
  language: z.string(),
  speechLanguages: z.array(z.string()),
  voiceSpeed: z.number().positive(),
  voiceTemperature: z.number().min(0).max(2),
  volume: z.number().min(0).max(2),
  voiceEmotion: z.string().nullable(),
  enableBackchannel: z.boolean(),
  backchannelFrequency: z.number().min(0).max(1),
  backchannelWords: z.array(z.string()),
  ambientSound: z.string().nullable(),
  ambientSoundVolume: z.number().min(0).max(2),
  sttMode: z.string(),
  vocabSpecialization: z.string(),
  denoisingMode: z.string(),
  normalizeForSpeech: z.boolean(),
  startSpeaker: z.enum(["agent", "user"]),
  beginMessage: z.string(),
  beginAfterUserSilenceMs: z.number().int().min(0),
  endCallAfterSilenceMs: z.number().int().positive(),
  responsiveness: z.number().min(0).max(1),
  interruptionSensitivity: z.number().min(0).max(1),
  maxCallDurationMs: z.number().int().positive(),
  ringDurationMs: z.number().int().positive(),
  reminderTriggerMs: z.number().int().positive(),
  reminderMaxCount: z.number().int().min(0),
  boostedKeywords: z.array(z.string()),
  pronunciationDictionary: z.array(z.unknown()),
  enableDynamicVoiceSpeed: z.boolean(),
  enableDynamicResponsiveness: z.boolean(),
});
export type RuntimeVoiceConfig = z.infer<typeof RuntimeVoiceConfigSchema>;

// ─── Provider-specific runtime config ────────────────────────────────────────

/**
 * Retell execution config.
 * agentJson is the push-ready Retell API payload from exportAgentJson().
 * Present for RETELL provider and as a reference for all other providers.
 */
export const RetellRuntimeConfigSchema = z.object({
  agentId: z.string().nullable(),
  webhookUrl: z.string(),
  agentJson: z.record(z.unknown()),
});
export type RetellRuntimeConfig = z.infer<typeof RetellRuntimeConfigSchema>;

/**
 * OpenAI Realtime execution config.
 * systemPrompt is ready for session.update({ instructions: systemPrompt }).
 */
export const OpenAIRuntimeConfigSchema = z.object({
  voice: z.string(),
  reasoningEffort: z.string(),
  systemPrompt: z.string(),
});
export type OpenAIRuntimeConfig = z.infer<typeof OpenAIRuntimeConfigSchema>;

export const RuntimeProviderConfigSchema = z.object({
  retell: RetellRuntimeConfigSchema.optional(),
  openai: OpenAIRuntimeConfigSchema.optional(),
});
export type RuntimeProviderConfig = z.infer<typeof RuntimeProviderConfigSchema>;

// ─── Full definition (ground truth) ──────────────────────────────────────────

export const AgentRuntimeDefinitionSchema = z.object({
  // Envelope
  runtimeVersion: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/, "runtimeVersion must be semver"),
  builderVersion: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/, "builderVersion must be semver"),
  exportedAt: z.string().datetime({ message: "exportedAt must be ISO 8601" }),

  // Identity
  agentId: z.string().uuid("agentId must be a UUID"),
  agentName: z.string().min(1, "agentName must not be empty"),
  retellAgentId: z.string().nullable(),

  // Runtime selector — consumers branch on this field only
  provider: DeploymentModeSchema,

  // Model
  model: RuntimeModelConfigSchema,

  // Prompt — Runtime reads, never generates
  compiledPrompt: z.string(),

  // Graph
  workflow: RuntimeWorkflowSchema,

  // Data
  variables: z.array(BuilderVariableSchema),
  tools: z.array(RetellToolSchema),
  knowledgeBase: RuntimeKnowledgeBaseSchema,
  voiceConfig: RuntimeVoiceConfigSchema,

  // Provider-specific execution data
  runtimeConfig: RuntimeProviderConfigSchema,
});

/** The canonical runtime definition type — always derived from the schema. */
export type AgentRuntimeDefinition = z.infer<typeof AgentRuntimeDefinitionSchema>;

// ─── Validation helpers ───────────────────────────────────────────────────────

export type ValidationResult =
  | { ok: true; data: AgentRuntimeDefinition }
  | { ok: false; errors: string[] };

/**
 * Safely validate a value as AgentRuntimeDefinition.
 * Returns a discriminated result so callers can handle errors without throwing.
 */
export function validateRuntimeDefinition(raw: unknown): ValidationResult {
  const result = AgentRuntimeDefinitionSchema.safeParse(raw);
  if (result.success) return { ok: true, data: result.data };
  return {
    ok: false,
    errors: result.error.errors.map(
      (e) => `${e.path.join(".")} — ${e.message}`,
    ),
  };
}

/**
 * Parse and throw on invalid input.
 * Use at Builder assembly time (production errors are programming bugs).
 */
export function parseRuntimeDefinition(raw: unknown): AgentRuntimeDefinition {
  return AgentRuntimeDefinitionSchema.parse(raw);
}
