import type { KnowledgeProvider, KnowledgeDocument, KnowledgeQueryParams } from "../interface";

// Retell's built-in knowledge base is managed via the Retell SDK/API.
// This adapter wraps it for the provider framework.
export class RetellKBAdapter implements KnowledgeProvider {
  readonly name = "retell_kb";

  async query(_params: KnowledgeQueryParams): Promise<KnowledgeDocument[]> {
    // Retell KB queries are handled automatically by the Retell voice agent at runtime.
    throw new Error("Retell KB queries are executed automatically by the Retell agent during calls — no direct query API needed.");
  }
}
