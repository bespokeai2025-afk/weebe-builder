---
name: Service-role KB-context IDOR in GrowthMind studios
description: supabaseAdmin bypasses RLS, so client-supplied "specific KB" context reads must manually filter workspace_id or a foreign KB id leaks another tenant's documents.
---

GrowthMind Image Studio (`generateImageAsset` → `buildBusinessContext`) and Video Studio
(`resolveVideoKnowledgeContext`) accept a CLIENT-supplied `knowledgeContextId` and read its
documents using `supabaseAdmin` (service role, which bypasses Postgres RLS). Originally these
read documents by `knowledge_base_id` ONLY — no workspace check — so workspace A could pass
workspace B's KB UUID and pull B's document content into a generated asset (real cross-workspace
data leak / IDOR).

**Rule:** Any query that uses `supabaseAdmin` / the service-role client AND keys off a
client-supplied id MUST also `.eq("workspace_id", workspaceId)` (or otherwise prove the id
belongs to the caller's workspace). RLS does NOT protect service-role queries.

**Why:** the service role bypasses RLS, so the only tenant boundary left is the manual filter
in the query itself. A client-supplied KB/record id is an IDOR vector when the read is unscoped.

**How to apply:** `documents`, `executive_documents`, and `executive_knowledge_bases` all have
a `workspace_id` column, and the studio KB selectors (`listVideoKnowledgeBases`, etc.) only ever
offer workspace-owned KBs — so filtering retrieval by `workspace_id` is safe and non-breaking.
Watch for the same shape in any future `specific_kb` / knowledge-context retrieval path.
