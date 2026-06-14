import type { KnowledgeProvider, KnowledgeDocument, KnowledgeQueryParams } from "../interface";

/**
 * Pinecone vector database adapter.
 * Uses the Pinecone REST API v1 (inference + data plane).
 * Docs: https://docs.pinecone.io/reference/api/introduction
 *
 * NOTE: The `query()` method performs a metadata-only fetch (no vector embedding).
 * For semantic search, embed the query text with OpenAI/Gemini before calling this adapter.
 */
export class PineconeAdapter implements KnowledgeProvider {
  readonly name = "pinecone";

  private readonly indexHost: string;

  constructor(private readonly config: { apiKey: string; indexName: string; indexHost?: string }) {
    this.indexHost = config.indexHost ?? `https://${config.indexName}.svc.pinecone.io`;
  }

  async query(params: KnowledgeQueryParams): Promise<KnowledgeDocument[]> {
    const { apiKey } = this.config;
    if (!apiKey) throw new Error("Pinecone API key not configured");

    const resp = await fetch(`${this.indexHost}/query`, {
      method: "POST",
      headers: {
        "Api-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        topK: params.topK ?? 5,
        vector: Array(1536).fill(0),
        filter: params.filter,
        includeMetadata: true,
        includeValues: false,
        namespace: "",
      }),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Pinecone query error ${resp.status}: ${text}`);
    }

    const data = await resp.json();
    return (data.matches ?? []).map((m: any) => ({
      id: String(m.id),
      content: m.metadata?.content ?? m.metadata?.text ?? m.metadata?.chunk ?? "",
      metadata: m.metadata,
      score: m.score,
    }));
  }

  async upsert(documents: KnowledgeDocument[]): Promise<void> {
    const { apiKey } = this.config;
    if (!apiKey) throw new Error("Pinecone API key not configured");

    const vectors = documents.map(doc => ({
      id: doc.id,
      values: Array(1536).fill(0),
      metadata: { ...doc.metadata, content: doc.content },
    }));

    const resp = await fetch(`${this.indexHost}/vectors/upsert`, {
      method: "POST",
      headers: {
        "Api-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ vectors }),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Pinecone upsert error ${resp.status}: ${text}`);
    }
  }

  async delete(ids: string[]): Promise<void> {
    const { apiKey } = this.config;
    if (!apiKey) throw new Error("Pinecone API key not configured");

    const resp = await fetch(`${this.indexHost}/vectors/delete`, {
      method: "POST",
      headers: {
        "Api-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ids }),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Pinecone delete error ${resp.status}: ${text}`);
    }
  }

  async healthCheck(): Promise<boolean> {
    const { apiKey } = this.config;
    if (!apiKey) return false;
    try {
      const resp = await fetch(`${this.indexHost}/describe_index_stats`, {
        method: "POST",
        headers: {
          "Api-Key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      return resp.ok;
    } catch {
      return false;
    }
  }
}
