/**
 * Conversation graph VM — public surface.
 *
 * Relative imports only — this module is reachable from vite.config.ts.
 */

export { compileFlow, interpolate, nodeModel, type CompiledFlow } from "./flow";
export { loadFlowFromAgent, type LoadedFlow } from "./load";
export { createOpenAiVmLlm, type OpenAiVmLlmOptions } from "./llm";
export { selectDigitEdge, selectEdge, selectGlobalNode, type RouteContext } from "./router";
export { createVmHooks, type VmHooksOptions } from "./tools";
export { ConversationVm, createConversationVm } from "./vm";
export type {
  ConversationFlow,
  EndReason,
  FlowEdge,
  FlowInstruction,
  FlowNode,
  FlowNodeType,
  LlmMessage,
  ToolInvocation,
  ToolOutcome,
  VariableValue,
  VmDirective,
  VmHooks,
  VmInput,
  VmLlm,
  VmOptions,
} from "./types";
