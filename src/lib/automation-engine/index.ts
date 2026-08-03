/**
 * Automation engine — public API (Phase 2: parse + registry + execute).
 */

export type {
  WorkflowDocument,
  WorkflowNode,
  WorkflowConnection,
  WorkflowSettings,
  RuntimeWorkflow,
  RuntimeNode,
  ConnectionEdge,
  ConnectionIndex,
  ParseWorkflowOutcome,
} from "./types/workflow.schema";

export type {
  ExecutionSnapshot,
  ExecutionStatus,
  WaitState,
} from "./types/execution.schema";

export type {
  NodeDefinition,
  NodeContext,
  NodeResult,
  NodeInput,
  NodeCategory,
} from "./types/node.types";

export type { ExpressionContext, ResolvedExpression } from "./types/expression.types";

export {
  WorkflowDocumentSchema,
  WorkflowNodeSchema,
  WorkflowConnectionSchema,
} from "./types/workflow.schema";

export {
  parseWorkflowDocument,
  parseWorkflowOrThrow,
  validateWorkflowDocument,
} from "./parser/parse-workflow";

export { buildAdjacency, getOutgoingEdges, getIncomingEdges } from "./parser/build-adjacency";
export { findEntryNodes, findEndNodes, isEntryNodeType } from "./parser/find-entry-nodes";

export {
  registerNode,
  registerNodes,
  getNodeDefinition,
  hasNodeType,
  listRegisteredNodeTypes,
  getNodeRegistrySnapshot,
  validateNodeConfig,
} from "./registry/node-registry";

export { registerCoreNodes, CORE_NODE_DEFINITIONS } from "./registry/register-core-nodes";
export { bootstrapAutomationEngine, ensureAutomationEngineBootstrapped } from "./bootstrap";
export { WorkflowParseError, formatZodWorkflowErrors } from "./errors/workflow-parse-error";

export { wbahPipelineToAutomationDocument, wbahGraphToAutomationDocument } from "./adapters/wbah-graph.adapter";

export {
  syncAutomationFromWbahPipeline,
  attachAutomationToWbahPipeline,
  type AutomationSyncResult,
} from "./sync-automation.server";

export {
  evaluateExpression,
  evaluateConditionExpression,
  resolveExpressionValue,
  resolveTemplate,
  resolveConfigRecord,
  buildNodeIdByLabelMap,
} from "./expressions/resolve-expression";

export { executeWorkflow, simulateWorkflow, executionSummary } from "./executor/workflow-executor";
export { executeWorkflowWithPersistence } from "./executor/execute-with-persistence";

export {
  runExecution,
  simulateExecution,
  executeWorkflowDocument,
  type RunExecutionRequest,
} from "./runtime/execution-runner";

export {
  ExecutionContext,
  type QueueItem,
} from "./runtime/execution-context";

export {
  executionEventBus,
  emitExecutionEvent,
  type ExecutionEvent,
  type ExecutionEventType,
  type ExecutionEventHandler,
} from "./runtime/execution-events";

export {
  resolveExecutionModeFlags,
  isTestExecution,
  type ExecutionMode,
  type ExecutionModeFlags,
} from "./runtime/execution-modes";

export {
  buildInitialQueue,
  resolveNextEdges,
  collectBranchSubgraph,
} from "./runtime/subgraph";

export {
  resumeExecution,
  resumeExecutionByWebhookToken,
  isDelayDue,
} from "./runtime/resume";

export {
  saveExecutionSnapshot,
  loadExecutionSnapshot,
  findExecutionByWaitToken,
  listWaitingExecutionsDue,
} from "./persistence/execution-snapshot.server";

export {
  createExecutionRun,
  appendExecutionStep,
  finalizeExecutionRun,
  createStepWriterHooks,
} from "./persistence/step-writer.server";

export {
  enqueueExecution,
  claimNextQueueItem,
  processQueueItem,
  drainExecutionQueue,
  loadWorkflowDocumentForExecution,
  type QueueRow,
} from "./queue/execution-queue.server";

export {
  persistWorkflowExecution,
  listAutomationExecutions,
  getAutomationExecutionWithSteps,
  getAutomationStepsForWbahJob,
  type AutomationExecutionRow,
  type AutomationExecutionStepRow,
  type AutomationExecutionSource,
} from "./persistence/execution-persistence.server";

export { recordAutomationTraceForWbahJob } from "./persistence/wbah-job-trace.server";

export {
  registerWbahNodes,
  WBAH_NODE_DEFINITIONS,
  WBAH_EXECUTOR_STEP_TO_NODE_TYPE,
} from "./plugins/wbah/register-wbah-nodes";

export {
  isWbahAutomationEngineEnabled,
  runWbahPostCallViaAutomationEngine,
} from "./plugins/wbah/wbah-automation-pipeline.server";

export type {
  WorkflowExecutionResult,
  NodeExecutionRecord,
  ExecuteWorkflowOptions,
} from "./executor/execution.types";

export { runNode, buildNodeInput } from "./runtime/node-runtime";
