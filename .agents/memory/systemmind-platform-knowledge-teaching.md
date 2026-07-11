---
name: Teaching SystemMind about completed feature work
description: How to write a platform-wide knowledge note so SystemMind (CTO executive) knows about a shipped feature/behavior, and when to do it vs. regular agent memory.
---

Per explicit user instruction: whenever a task successfully ships or changes real platform
functionality (a feature, a data-model rule, a cross-cutting behavior), also record it in the
**platform-wide SystemMind knowledge base** — not just in this agent's own `.agents/memory/`.
Agent memory is for *this agent's* future sessions; the SystemMind platform KB is for the
in-app AI executive that customers and other in-product flows actually query
(`querySystemMindKnowledgeContext` / `retrieveExecutiveKnowledge`), so it needs to reflect the
platform's real, current behavior.

**Why:** the two knowledge stores serve different consumers (agent-session memory vs. an
in-product RAG-backed AI advisor) and neither substitutes for the other. Without an explicit
write, SystemMind's knowledge only grows via its own generic AI-generated starter topics —
completed, specific engineering work never reaches it otherwise.

**How to apply:**
- Use `recordSystemMindPlatformKnowledge({ seedKey, title, content })` in
  `src/lib/systemmind/systemmind-platform-knowledge.server.ts` from server code. It writes into
  the `platform_systemmind` knowledge base (`executive_knowledge_bases.scope = 'platform_default'`,
  `workspace_id = NULL`), which every workspace's SystemMind reads automatically alongside its own
  workspace KB — no per-workspace seeding needed.
- For a one-off/manual run (e.g. from this agent, outside the app's server runtime), use
  `node scripts/seed-systemmind-platform-knowledge.mjs <entries.json>` — a standalone duplicate of
  the same chunk/embed/store logic (written standalone because `tsx` can't resolve this project's
  `@/` path aliases outside the Vite pipeline). Requires `SUPABASE_URL`/`VITE_SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY` in the shell env (not the code_execution sandbox).
- Reuse a stable `seedKey` (e.g. `feature:<slug>`) so re-running an entry **updates** it in place
  instead of duplicating — there's a DB unique index on `(seed_key)` for platform docs.
- This is distinct from `systemmind-kb-seed.server.ts` (generic AI-generated starter docs) and
  `systemmind-workflow.server.ts` repair playbooks (structured bug-fix procedures) — use the
  platform-knowledge writer specifically for "here's a real feature/behavior that now exists".
- Skip this for trivial changes (copy tweaks, styling, one-off bugfixes with no lasting behavioral
  rule) — reserve it for things a future SystemMind answer should actually know about.
