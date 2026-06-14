import type { KnowledgeProvider, KnowledgeDocument, KnowledgeQueryParams } from "../interface";

// TODO: implement — connect to Pinecone Vector Database
// Docs: https://docs.pinecone.io
export class PineconeAdapter implements KnowledgeProvider {
  readonly name = "pinecone";

  constructor(private readonly _config: { apiKey: string; indexName: string }) {}

  async query(_params: KnowledgeQueryParams): Promise<KnowledgeDocument[]> {
    throw new Error("Pinecone knowledge provider not yet implemented.");
  }

  async upsert(_documents: KnowledgeDocument[]): Promise<void> {
    throw new Error("Pinecone knowledge provider not yet implemented.");
  }

  async delete(_ids: string[]): Promise<void> {
    throw new Error("Pinecone knowledge provider not yet implemented.");
  }
}
