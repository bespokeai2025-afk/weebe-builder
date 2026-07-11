# WEBEE / WeeBee

Multi-tenant AI OS for building, deploying and running AI voice/WhatsApp agents, plus three AI
"executives" — SystemMind (CTO), GrowthMind (CMO), HiveMind (COO) — that give customers
AI-driven technical, marketing and operational intelligence about their own workspace.

## Stack
- TanStack Start (SSR) + Vite + React Query, shadcn/ui
- External Supabase (PostgreSQL + pgvector + Auth + Storage) — **dev and prod share the same
  database**, so schema/data changes here are live for the deployed app at
  `https://webeereceptionist.com` immediately.
- Voice providers: Retell AI (OmniVoice), ElevenLabs (HyperStream), OpenAI Realtime (VoxStream).
  WhatsApp providers: Twilio, WATI, Meta.
- Executive knowledge system: per-workspace RAG KBs (`hivemind`/`growthmind`/`systemmind`/`shared`)
  plus a platform-wide layer (`platform_*` KBs, `scope = platform_default`, `workspace_id = NULL`)
  readable by every workspace automatically.

## User preferences

- **Teach SystemMind about completed system-functionality work.** Whenever a task successfully
  ships or changes real platform functionality (a feature, a data-model rule, a cross-cutting
  behavior — not a one-off bugfix or copy tweak), also write a short knowledge note into the
  platform-wide SystemMind knowledge base so every workspace's SystemMind (CTO) executive knows
  about it going forward. Use `recordSystemMindPlatformKnowledge()` in
  `src/lib/systemmind/systemmind-platform-knowledge.server.ts` (call it from server code), or the
  standalone equivalent `scripts/seed-systemmind-platform-knowledge.mjs` for a one-off/manual run.
  See `.agents/memory/systemmind-platform-knowledge-teaching.md` for the mechanism and when to use
  it vs. regular agent memory.
