---
name: Platform Default KB layer
description: Two-tier KB architecture — platform_default (global, admin-managed) + workspace (per-customer). Retrieval merges both transparently.
---

## What it is
A global knowledge layer for WEBEE platform content (selling points, frameworks, playbooks) stored once and automatically available to every workspace's executives.

## DB schema changes (PLATFORM_KNOWLEDGE_MIGRATION.sql)
- `executive_knowledge_bases.scope TEXT DEFAULT 'workspace'` — new col; CHECK (platform_default | workspace)
- `workspace_id` made nullable on: executive_knowledge_bases, executive_documents, executive_document_chunks
- Unique partial index: `exec_kb_platform_slug_idx ON executive_knowledge_bases(slug) WHERE scope = 'platform_default'`
- Unique partial index: `exec_docs_platform_seed_key_idx ON executive_documents(seed_key) WHERE seed_key IS NOT NULL AND workspace_id IS NULL`
- New SELECT RLS policies for platform rows (any `auth.uid() IS NOT NULL`)
- 4 platform KB rows seeded in migration: `platform_hivemind`, `platform_growthmind`, `platform_systemmind`, `platform_shared` (workspace_id = NULL)
- `match_executive_document_chunks` RPC updated: `WHERE (c.workspace_id = p_workspace_id OR c.workspace_id IS NULL) AND c.knowledge_base_id = ANY(p_kb_ids)` — platform chunks now included when their kb_ids are in the list

**Why security is preserved:** KB ids are always server-resolved (never from client). The RPC is still SECURITY DEFINER / service_role-only.

## Key files
- `supabase/migrations/PLATFORM_KNOWLEDGE_MIGRATION.sql` — must be applied MANUALLY in Supabase SQL Editor
- `src/lib/executives/executive-knowledge.config.ts` — PLATFORM_EXECUTIVE_KBS[], PLATFORM_KB_ACCESS, getPlatformKbSlugs()
- `src/lib/executives/executive-knowledge.server.ts` — getPlatformKnowledgeBases() + updated retrieveExecutiveKnowledge()
- `src/lib/executives/platform-knowledge.server.ts` — admin CRUD server fns + stats fn
- `src/lib/executives/platform-knowledge-seed.server.ts` — 7 platform docs, idempotent via global seed_key
- `src/routes/_authenticated/admin.platform-knowledge.tsx` — /admin/platform-knowledge UI
- `src/components/knowledge-centre/KnowledgeCentreDashboard.tsx` — added read-only "Platform Knowledge — Provided by WEBEE" section

## Retrieval order (per spec)
1. Workspace executive KB (e.g. growthmind)
2. Workspace shared KB
3. Platform executive KB (e.g. platform_growthmind)
4. Platform shared KB

## Document processing null workspaceId
`indexUploadedDocument(sb, { documentId, workspaceId: null })` and `indexTextDocument(sb, { ..., workspaceId: null })` both now accept null. `loadDocument()` uses `.is("workspace_id", null)` when workspaceId is null.

**Why:** Platform docs have workspace_id = NULL in DB; the old `.eq("workspace_id", workspaceId)` would return no rows and throw "Document not found."

## Admin gate
All platform write operations use `assertPlatformAdmin(userId)` which checks `profiles.user_type = 'admin'`. Reads are open to any authenticated user.

## Graceful degradation
`getPlatformKnowledgeBases()` wraps in try/catch and returns [] if the migration hasn't been applied yet — so retrieval still works (with workspace-only results) before the SQL is applied.
