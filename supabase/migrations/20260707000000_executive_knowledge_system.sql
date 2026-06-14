-- ── Executive Knowledge System ───────────────────────────────────────────────
-- Private RAG knowledge stores for the AI executives (HiveMind / GrowthMind /
-- SystemMind / Shared), fully separate from the customer-facing agent KBs
-- (Retell / HyperStream / Builder). All tables are workspace-scoped with RLS.
--
-- DDL cannot be run from the JS client in this environment — APPLY THIS FILE
-- MANUALLY in the Supabase SQL Editor.

-- 0. pgvector extension (idempotent)
CREATE EXTENSION IF NOT EXISTS vector;

-- 1. executive_knowledge_bases ────────────────────────────────────────────────
-- One row per (workspace, executive). `mind_type` is OPEN TEXT so new executives
-- (salesmind, financemind, …) can be added without a migration.
CREATE TABLE IF NOT EXISTS public.executive_knowledge_bases (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  slug          TEXT        NOT NULL,            -- hivemind | growthmind | systemmind | shared | …
  mind_type     TEXT        NOT NULL,            -- open text, mirrors slug for executive KBs
  name          TEXT        NOT NULL,
  description   TEXT,
  is_shared     BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, slug)
);

CREATE INDEX IF NOT EXISTS exec_kb_ws_idx ON public.executive_knowledge_bases(workspace_id);

-- 2. executive_documents ──────────────────────────────────────────────────────
-- A source document (uploaded file or AI-seeded reference). `seed_key` lets the
-- starter-knowledge seeding routine stay idempotent (unique per workspace).
CREATE TABLE IF NOT EXISTS public.executive_documents (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  knowledge_base_id UUID        NOT NULL REFERENCES public.executive_knowledge_bases(id) ON DELETE CASCADE,
  source_type       TEXT        NOT NULL DEFAULT 'upload', -- upload | seed | text
  title             TEXT        NOT NULL,
  file_name         TEXT,
  mime_type         TEXT,
  file_size         BIGINT,
  storage_path      TEXT,
  content_hash      TEXT,
  seed_key          TEXT,                       -- non-null only for AI-seeded docs
  chunk_count       INTEGER     NOT NULL DEFAULT 0,
  embedding_status  TEXT        NOT NULL DEFAULT 'pending', -- pending|processing|indexed|failed
  error_message     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  indexed_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS exec_docs_ws_idx     ON public.executive_documents(workspace_id);
CREATE INDEX IF NOT EXISTS exec_docs_kb_idx     ON public.executive_documents(knowledge_base_id);
CREATE INDEX IF NOT EXISTS exec_docs_status_idx ON public.executive_documents(embedding_status);
-- Idempotent seeding: a given seed_key may exist at most once per workspace.
CREATE UNIQUE INDEX IF NOT EXISTS exec_docs_seed_key_idx
  ON public.executive_documents(workspace_id, seed_key)
  WHERE seed_key IS NOT NULL;

-- 3. executive_document_chunks ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.executive_document_chunks (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  document_id       UUID        NOT NULL REFERENCES public.executive_documents(id) ON DELETE CASCADE,
  knowledge_base_id UUID        NOT NULL REFERENCES public.executive_knowledge_bases(id) ON DELETE CASCADE,
  chunk_index       INTEGER     NOT NULL DEFAULT 0,
  content           TEXT        NOT NULL,
  token_count       INTEGER     NOT NULL DEFAULT 0,
  embedding_vector  vector(1536),
  metadata          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS exec_chunks_ws_idx  ON public.executive_document_chunks(workspace_id);
CREATE INDEX IF NOT EXISTS exec_chunks_doc_idx ON public.executive_document_chunks(document_id);
CREATE INDEX IF NOT EXISTS exec_chunks_kb_idx  ON public.executive_document_chunks(knowledge_base_id);
-- Approximate nearest-neighbour index (cosine). ivfflat is broadly supported and
-- fine for moderate volumes; lists=100 is a sensible default for these datasets.
CREATE INDEX IF NOT EXISTS exec_chunks_embedding_idx
  ON public.executive_document_chunks
  USING ivfflat (embedding_vector vector_cosine_ops) WITH (lists = 100);

-- 4. executive_knowledge_queries ──────────────────────────────────────────────
-- Retrieval log — powers the usage dashboard.
CREATE TABLE IF NOT EXISTS public.executive_knowledge_queries (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     UUID        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  mind_type        TEXT        NOT NULL,
  query            TEXT        NOT NULL,
  top_k            INTEGER     NOT NULL DEFAULT 5,
  matched_count    INTEGER     NOT NULL DEFAULT 0,
  matched_kb_slugs TEXT[]      NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS exec_queries_ws_idx   ON public.executive_knowledge_queries(workspace_id);
CREATE INDEX IF NOT EXISTS exec_queries_mind_idx ON public.executive_knowledge_queries(mind_type);
CREATE INDEX IF NOT EXISTS exec_queries_time_idx ON public.executive_knowledge_queries(created_at);

-- 5. Similarity search RPC ─────────────────────────────────────────────────────
-- supabase-js can't express the `<=>` operator directly, so retrieval goes
-- through this SECURITY DEFINER function. The server always passes an explicit
-- workspace_id + the set of readable KB ids (access rules enforced in app code),
-- so this only ever returns rows inside the requested scope.
CREATE OR REPLACE FUNCTION public.match_executive_document_chunks(
  p_workspace_id    UUID,
  p_knowledge_base_ids UUID[],
  p_query_embedding vector(1536),
  p_match_count     INT DEFAULT 5
)
RETURNS TABLE (
  chunk_id          UUID,
  document_id       UUID,
  knowledge_base_id UUID,
  content           TEXT,
  metadata          JSONB,
  similarity        FLOAT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id                                   AS chunk_id,
    c.document_id                          AS document_id,
    c.knowledge_base_id                    AS knowledge_base_id,
    c.content                              AS content,
    c.metadata                             AS metadata,
    1 - (c.embedding_vector <=> p_query_embedding) AS similarity
  FROM public.executive_document_chunks c
  WHERE c.workspace_id = p_workspace_id
    AND c.knowledge_base_id = ANY (p_knowledge_base_ids)
    AND c.embedding_vector IS NOT NULL
  ORDER BY c.embedding_vector <=> p_query_embedding
  LIMIT GREATEST(p_match_count, 1);
$$;

-- 6. RLS + grants ──────────────────────────────────────────────────────────────
ALTER TABLE public.executive_knowledge_bases   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.executive_documents         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.executive_document_chunks   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.executive_knowledge_queries ENABLE ROW LEVEL SECURITY;

-- executive_knowledge_bases
CREATE POLICY "exec_kb_sel" ON public.executive_knowledge_bases
  FOR SELECT USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
CREATE POLICY "exec_kb_ins" ON public.executive_knowledge_bases
  FOR INSERT WITH CHECK (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
CREATE POLICY "exec_kb_upd" ON public.executive_knowledge_bases
  FOR UPDATE USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
CREATE POLICY "exec_kb_del" ON public.executive_knowledge_bases
  FOR DELETE USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

-- executive_documents
CREATE POLICY "exec_docs_sel" ON public.executive_documents
  FOR SELECT USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
CREATE POLICY "exec_docs_ins" ON public.executive_documents
  FOR INSERT WITH CHECK (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
CREATE POLICY "exec_docs_upd" ON public.executive_documents
  FOR UPDATE USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
CREATE POLICY "exec_docs_del" ON public.executive_documents
  FOR DELETE USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

-- executive_document_chunks
CREATE POLICY "exec_chunks_sel" ON public.executive_document_chunks
  FOR SELECT USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
CREATE POLICY "exec_chunks_ins" ON public.executive_document_chunks
  FOR INSERT WITH CHECK (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
CREATE POLICY "exec_chunks_del" ON public.executive_document_chunks
  FOR DELETE USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

-- executive_knowledge_queries
CREATE POLICY "exec_queries_sel" ON public.executive_knowledge_queries
  FOR SELECT USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
CREATE POLICY "exec_queries_ins" ON public.executive_knowledge_queries
  FOR INSERT WITH CHECK (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.executive_knowledge_bases   TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.executive_documents         TO authenticated;
GRANT SELECT, INSERT, DELETE         ON public.executive_document_chunks   TO authenticated;
GRANT SELECT, INSERT                 ON public.executive_knowledge_queries TO authenticated;

GRANT ALL ON public.executive_knowledge_bases   TO service_role;
GRANT ALL ON public.executive_documents         TO service_role;
GRANT ALL ON public.executive_document_chunks   TO service_role;
GRANT ALL ON public.executive_knowledge_queries TO service_role;

-- The match RPC is SECURITY DEFINER (bypasses RLS). If end users could call it
-- directly they could pass another workspace's id + KB ids and read its private
-- chunks. Restrict EXECUTE to service_role only — all retrieval goes through
-- server functions that call it with the service-role key and a trusted,
-- auth-derived workspace_id.
REVOKE EXECUTE ON FUNCTION public.match_executive_document_chunks(UUID, UUID[], vector, INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.match_executive_document_chunks(UUID, UUID[], vector, INT) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.match_executive_document_chunks(UUID, UUID[], vector, INT) TO service_role;
