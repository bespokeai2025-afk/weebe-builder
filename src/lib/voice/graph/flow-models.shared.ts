/**
 * Make a builder-exported flow's model choices match the native engine that will run it.
 *
 * The builder exports one graph for every runtime, so the flow-level `model_choice` is the Retell
 * "Model" setting — hidden in the builder when the agent runs on WEBEE Native. The native VM
 * preferred that flow-level model over the "Speech model" the builder does show, so changing the
 * visible setting did nothing, and picking Cerebras still sent an OpenAI model id to Cerebras.
 *
 * Here the engine's own speech model becomes the flow-level model, and any per-node override the
 * provider cannot serve is dropped (that node falls back to the speech model) rather than failing
 * the node's line mid-call.
 *
 * Relative imports only — reachable from vite.config.ts.
 */
import type { VoiceLlmProvider } from "../llm/gpt";
import { isModelServedByWebeeProvider } from "../webee-native.shared";
import type { ConversationFlow } from "./types";

export function alignFlowModelsToEngine(
  flow: ConversationFlow,
  speechModel: string,
  provider: VoiceLlmProvider,
): { flow: ConversationFlow; warnings: string[] } {
  const warnings: string[] = [];
  const nodes = (flow.nodes ?? []).map((node) => {
    const override = String(node.model_choice?.model ?? "").trim();
    if (!override || isModelServedByWebeeProvider(override, provider)) return node;
    warnings.push(
      `node "${node.name ?? node.id}" asks for model "${override}", which ${provider} cannot serve — using ${speechModel}`,
    );
    const { model_choice: _dropped, ...rest } = node;
    return rest as typeof node;
  });
  return {
    flow: {
      ...flow,
      nodes,
      model_choice: { ...(flow.model_choice ?? {}), model: speechModel },
    },
    warnings,
  };
}
