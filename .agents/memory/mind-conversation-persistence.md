---
name: Mind conversation persistence
description: Server-side HiveMind/GrowthMind chat persistence — private per-user RLS, idempotent appends, offline cache rules
---

# Mind conversation persistence

- Tables `mind_conversations` + `mind_conversation_messages`; one ACTIVE conversation per (workspace, user, mind) enforced by partial unique index `uq_mconv_active`; getOrCreate handles 23505 by re-selecting.
- **RLS is per-USER ownership, not workspace-members**: these chats are private; policies require `user_id = auth.uid()` (messages via EXISTS on owning conversation). Migration 20260724120000 replaced the original members policies — don't "fix" it back to the members pattern.
- Idempotent appends via partial unique `(conversation_id, client_msg_id)`; server inserts row-by-row, 23505 = skip. Append server fn caps batches at 10 — the client hook `useMindConversation.persist()` must chunk (it does) or messages beyond 10 silently drop.
- Chat UI pattern (hivemind.chat.tsx, GrowthMindChat.tsx): seed once from server history (drop the never-persisted `"briefing"` message id), gate briefing generation on `historyLoaded && initialMessages.length === 0`, and don't latch the seeded flag while history is empty (cache-seeded messages arrive a render later). Mark persisted ids in a ref and UN-mark on persist failure so retries happen.
- **Offline cache must be user-scoped**: localStorage cache/seeded-flag keys include mind + workspaceId + USER id. A workspace-only key lets one user on a shared browser see — and auto-seed the server with — another user's history. Reset any seeded state when the key changes.
- **Why:** review rounds failed on exactly these: batch-cap data loss, workspace-wide RLS (intra-workspace privacy leak), duplicate active conversations under concurrent first loads, and a non-user-scoped offline cache.
- **How to apply:** wiring SystemMind/AccountsMind chats or the mobile API should reuse the same hook/server fns and honor these constraints.
