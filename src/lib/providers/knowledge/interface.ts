export interface KnowledgeDocument {
  id: string;
  content: string;
  metadata?: Record<string, unknown>;
  score?: number;
}

export interface KnowledgeQueryParams {
  query: string;
  topK?: number;
  filter?: Record<string, unknown>;
}

export interface KnowledgeProvider {
  readonly name: string;
  query(params: KnowledgeQueryParams): Promise<KnowledgeDocument[]>;
  upsert?(documents: KnowledgeDocument[]): Promise<void>;
  delete?(ids: string[]): Promise<void>;
  healthCheck?(): Promise<boolean>;
}
