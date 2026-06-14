---
name: Executive Knowledge System
description: Private RAG knowledge stores for HiveMind/GrowthMind/SystemMind executives, separate from customer-facing agent/call KBs.
---

- Separate executive RAG layer (real `weebee_kb` pgvector adapter) from customer-facing agent/Retell/HyperStream KBs — its own tables (`executive_knowledge_bases` / `_documents` / `_document_chunks` / `_queries`). Never touch agent-KB code; it's referenced only as a pattern.
- Access rules live in ONE config object (`EXECUTIVE_KNOWLEDGE_ACCESS` in `executive-knowledge.config.ts`); `mind_type` is open text → adding a new executive (SalesMind/FinanceMind/…) is a config edit, not a migration.
- Read scopes: HiveMind → HiveMind + Shared KBs **plus** GrowthMind/SystemMind executive *summaries*; GrowthMind → GrowthMind + Shared; SystemMind → SystemMind + Shared. GrowthMind and SystemMind never read each other directly — all cross-executive flow goes through HiveMind.

**Security — the non-obvious one:**
- `match_executive_document_chunks` RPC is `SECURITY DEFINER` (so supabase-js can use the `<=>` operator). It MUST be granted to `service_role` only and invoked with the service-role/admin client — never the user/`authenticated` client.
- **Why:** SECURITY DEFINER bypasses RLS, so the only authorization left is the EXECUTE grant + the server-supplied (auth-derived) `workspace_id`. Granting EXECUTE to `authenticated` lets any logged-in user call the RPC directly from the browser with another workspace's id/KB ids and read its private chunks.
- **How to apply:** any new SECURITY DEFINER retrieval RPC over workspace-scoped data → grant service_role only, call via admin client, pass trusted workspace_id.

**Seeding (`executive-knowledge-seed.server.ts`):**
- Idempotent via a stable `seed_key` + a unique partial index on `(workspace_id, seed_key)`. Skips already-indexed seeds, retries non-indexed ones, processes a `limit` per call; the dashboard self-drives it in a capped loop with a no-progress break so it never runs away.

- HiveMind has THREE RAG-grounded output paths that must stay in sync when changing grounding: chat handler, morning briefing (deterministic builder takes a `knowledgeNote` arg — easy to forget), and the voice-context handler.
- DDL can't be applied from the JS client here — the single timestamped migration must be applied MANUALLY in the Supabase SQL Editor; always call this out to the user at close.
