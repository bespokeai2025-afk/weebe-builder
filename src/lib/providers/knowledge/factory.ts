import type { KnowledgeProvider, KnowledgeQueryParams, KnowledgeDocument } from "./interface";
import { RetellKBAdapter } from "./adapters/retell-kb.adapter";
import { PineconeAdapter } from "./adapters/pinecone.adapter";
import { withProviderTracking } from "@/lib/providers/instrumentation";

export type KnowledgeProviderName = "retell_kb" | "weebee_kb" | "pinecone" | "openai_vs";

export type KnowledgeConfig =
  | { provider: "retell_kb" }
  | { provider: "weebee_kb" }
  | { provider: "pinecone"; apiKey: string; indexName: string }
  | { provider: "openai_vs"; apiKey: string; vectorStoreId: string };

/**
 * Create a KnowledgeProvider. When `workspaceId` is included in `config`,
 * every method call is automatically tracked in provider_usage.
 */
export function createKnowledgeProvider(
  config: KnowledgeConfig & { workspaceId?: string },
): KnowledgeProvider {
  let inner: KnowledgeProvider;
  switch (config.provider) {
    case "retell_kb":
      inner = new RetellKBAdapter();
      break;
    case "weebee_kb":
      inner = new RetellKBAdapter();
      break;
    case "pinecone":
      inner = new PineconeAdapter({ apiKey: config.apiKey, indexName: config.indexName });
      break;
    case "openai_vs":
      throw new Error("OpenAI Vector Store provider not yet implemented.");
    default:
      throw new Error(`Unknown knowledge provider: ${String((config as any).provider)}`);
  }

  if (!config.workspaceId) return inner;

  const { workspaceId, provider: providerName } = config;
  const track = <T>(fn: () => Promise<T>) =>
    withProviderTracking({ workspaceId, category: "knowledge", providerName }, fn);

  return {
    name: inner.name,
    query: (params: KnowledgeQueryParams): Promise<KnowledgeDocument[]> =>
      track(() => inner.query(params)),
    ...(inner.upsert
      ? { upsert: (docs: KnowledgeDocument[]) => track(() => inner.upsert!(docs)) }
      : {}),
    ...(inner.delete
      ? { delete: (ids: string[]) => track(() => inner.delete!(ids)) }
      : {}),
  };
}

/** @deprecated Use createKnowledgeProvider({ ..., workspaceId }) instead. */
export const createInstrumentedKnowledgeProvider = (
  config: KnowledgeConfig & { workspaceId: string },
): KnowledgeProvider => createKnowledgeProvider(config);
