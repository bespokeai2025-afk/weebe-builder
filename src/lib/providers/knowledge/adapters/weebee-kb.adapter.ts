import type { KnowledgeProvider, KnowledgeDocument, KnowledgeQueryParams } from "../interface";

// Weebee's native executive knowledge store, backed by Supabase pgvector.
// Used by the AI executives (HiveMind / GrowthMind / SystemMind) for RAG over
// their private knowledge bases — entirely separate from the customer-facing
// Retell / HyperStream / agent KBs.
//
// The server-only core (`executive-knowledge.server.ts`) is dynamically imported
// inside each method so this adapter — and the factory that constructs it — stay
// safe to reference from client bundles.
export type WeebeeKBAdapterConfig = {
  workspaceId: string;
  mindType:    string;
};

export class WeebeeKBAdapter implements KnowledgeProvider {
  readonly name = "weebee_kb";
  private readonly workspaceId: string;
  private readonly mindType: string;

  constructor(config: WeebeeKBAdapterConfig) {
    this.workspaceId = config.workspaceId;
    this.mindType = config.mindType;
  }

  async query(params: KnowledgeQueryParams): Promise<KnowledgeDocument[]> {
    const { retrieveExecutiveKnowledge } = await import(
      "@/lib/executives/executive-knowledge.server"
    );
    const { chunks } = await retrieveExecutiveKnowledge({
      workspaceId: this.workspaceId,
      mindType: this.mindType,
      query: params.query,
      topK: params.topK,
    });
    return chunks.map((c) => ({
      id: c.chunkId,
      content: c.content,
      score: c.similarity,
      metadata: { ...c.metadata, documentId: c.documentId, knowledgeBaseId: c.kbId },
    }));
  }
}
