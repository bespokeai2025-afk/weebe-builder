-- ── Platform Default Knowledge Base System ───────────────────────────────────
-- Extends the executive knowledge system with a two-tier KB layer:
--   1. platform_default  — global, admin-managed, shared across ALL workspaces
--   2. workspace         — per-customer, existing behaviour (unchanged)
--
-- APPLY MANUALLY in Supabase SQL Editor. DDL cannot run from the JS client.
-- Run AFTER 20260707000000_executive_knowledge_system.sql.

-- ── 1. Add scope column ───────────────────────────────────────────────────────
ALTER TABLE public.executive_knowledge_bases
  ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'workspace'
  CHECK (scope IN ('platform_default', 'workspace'));

-- ── 2. Make workspace_id nullable on all four tables ──────────────────────────
-- executive_knowledge_bases: workspace_id = NULL for platform_default rows.
ALTER TABLE public.executive_knowledge_bases ALTER COLUMN workspace_id DROP NOT NULL;

-- executive_documents: NULL workspace_id for platform documents.
ALTER TABLE public.executive_documents ALTER COLUMN workspace_id DROP NOT NULL;

-- Drop the old FK constraint on executive_documents before making it nullable
-- (Postgres keeps NOT NULL enforcement separate from FK, but some builds enforce both)
-- The FK reference itself is fine with NULL values.

-- executive_document_chunks: NULL workspace_id for platform chunks.
ALTER TABLE public.executive_document_chunks ALTER COLUMN workspace_id DROP NOT NULL;

-- executive_knowledge_queries: always workspace-scoped — leave NOT NULL.

-- ── 3. Unique index: one row per platform KB slug globally ────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS exec_kb_platform_slug_idx
  ON public.executive_knowledge_bases(slug)
  WHERE scope = 'platform_default';

-- ── 4. Unique index: one seed document per platform seed_key globally ─────────
CREATE UNIQUE INDEX IF NOT EXISTS exec_docs_platform_seed_key_idx
  ON public.executive_documents(seed_key)
  WHERE seed_key IS NOT NULL AND workspace_id IS NULL;

-- ── 5. RLS – read access for platform_default rows ───────────────────────────
-- Any authenticated user may SELECT platform_default KB rows.
-- Writes go through supabaseAdmin (service_role bypasses RLS) — no INSERT/UPDATE/DELETE
-- policy is needed for platform rows.

-- executive_knowledge_bases: platform rows readable by all authenticated users.
DROP POLICY IF EXISTS "exec_kb_platform_sel" ON public.executive_knowledge_bases;
CREATE POLICY "exec_kb_platform_sel" ON public.executive_knowledge_bases
  FOR SELECT
  USING (scope = 'platform_default' AND auth.uid() IS NOT NULL);

-- executive_documents: platform rows (workspace_id IS NULL) readable by all.
DROP POLICY IF EXISTS "exec_docs_platform_sel" ON public.executive_documents;
CREATE POLICY "exec_docs_platform_sel" ON public.executive_documents
  FOR SELECT
  USING (workspace_id IS NULL AND auth.uid() IS NOT NULL);

-- executive_document_chunks: platform chunks readable by all authenticated.
-- (Chunks are primarily accessed via the SECURITY DEFINER RPC, not direct SELECT.)
DROP POLICY IF EXISTS "exec_chunks_platform_sel" ON public.executive_document_chunks;
CREATE POLICY "exec_chunks_platform_sel" ON public.executive_document_chunks
  FOR SELECT
  USING (workspace_id IS NULL AND auth.uid() IS NOT NULL);

-- ── 6. Seed the four platform KB rows ────────────────────────────────────────
-- workspace_id = NULL, scope = 'platform_default'.
-- ON CONFLICT DO NOTHING makes this idempotent.
INSERT INTO public.executive_knowledge_bases
  (workspace_id, slug, mind_type, name, description, is_shared, scope)
VALUES
  (NULL, 'platform_hivemind',
   'hivemind',
   'WEBEE HiveMind Knowledge',
   'Platform-wide business operations, decision-making and COO playbooks provided by WEBEE. Available to all workspaces automatically.',
   false, 'platform_default'),

  (NULL, 'platform_growthmind',
   'growthmind',
   'WEBEE GrowthMind Knowledge',
   'Platform-wide marketing frameworks, funnels, offers and CMO playbooks provided by WEBEE. Available to all workspaces automatically.',
   false, 'platform_default'),

  (NULL, 'platform_systemmind',
   'systemmind',
   'WEBEE SystemMind Knowledge',
   'Platform-wide technical frameworks, monitoring, reliability and CTO playbooks provided by WEBEE. Available to all workspaces automatically.',
   false, 'platform_default'),

  (NULL, 'platform_shared',
   'shared',
   'WEBEE Shared Knowledge',
   'Platform-wide shared knowledge available to all executives. Provided by WEBEE.',
   true,  'platform_default')
ON CONFLICT DO NOTHING;

-- ── 7. Update the match RPC to include platform chunks ───────────────────────
-- The original RPC filtered strictly by workspace_id.
-- Updated WHERE: (workspace_id = p_workspace_id OR workspace_id IS NULL)
--   → includes platform chunks (workspace_id IS NULL) when their KB ids are in p_knowledge_base_ids.
-- Security is preserved: kb ids are always resolved server-side; the RPC is still
-- SECURITY DEFINER / service_role-only so browsers cannot call it directly.

CREATE OR REPLACE FUNCTION public.match_executive_document_chunks(
  p_workspace_id        UUID,
  p_knowledge_base_ids  UUID[],
  p_query_embedding     vector(1536),
  p_match_count         INT DEFAULT 5
)
RETURNS TABLE (
  chunk_id           UUID,
  document_id        UUID,
  knowledge_base_id  UUID,
  content            TEXT,
  similarity         FLOAT,
  metadata           JSONB
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id                AS chunk_id,
    c.document_id       AS document_id,
    c.knowledge_base_id AS knowledge_base_id,
    c.content,
    1 - (c.embedding_vector <=> p_query_embedding) AS similarity,
    c.metadata
  FROM executive_document_chunks c
  WHERE
    -- Include workspace-scoped chunks for this workspace AND
    -- platform chunks (workspace_id IS NULL) whose KB is in the allowed set.
    (c.workspace_id = p_workspace_id OR c.workspace_id IS NULL)
    AND c.knowledge_base_id = ANY(p_knowledge_base_ids)
  ORDER BY c.embedding_vector <=> p_query_embedding
  LIMIT p_match_count;
$$;

-- Re-apply grants (CREATE OR REPLACE resets them).
REVOKE EXECUTE ON FUNCTION public.match_executive_document_chunks(UUID, UUID[], vector, INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.match_executive_document_chunks(UUID, UUID[], vector, INT) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.match_executive_document_chunks(UUID, UUID[], vector, INT) TO service_role;
