---
name: Mind conversation persistence
description: Server-side HiveMind/GrowthMind chat persistence — schema, RLS, seeding/persist pattern in chat UIs
---

# Mind conversation persistence (Task: server-side chat history)

- Tables `mind_conversations` + `mind_conversation_messages`; one ACTIVE conversation per (workspace, user, mind) enforced by partial unique index `uq_mconv_active`; getOrCreate handles 23505 by re-selecting.
- **RLS is per-USER ownership, not workspace-members**: these chats are private; policies require `user_id = auth.uid()` (messages via EXISTS on owning conversation). Migration 20260724120000 replaced the original members policies — don't "fix" it back to the members pattern.
- Idempotent appends via partial unique `(conversation_id, client_msg_id)`; server inserts row-by-row, 23505 = skip. Append server fn caps batches at 10 — the client hook `useMindConversation.persist()` must chunk (it does) or messages beyond 10 silently drop.
- Chat UI pattern (hivemind.chat.tsx, GrowthMindChat.tsx): seed once from server history (drop the never-persisted `"briefing"` message id), gate briefing generation on `historyLoaded && initialMessages.length === 0`, mark persisted ids in a ref and UN-mark on persist failure so retries happen.
- **Why:** architect review failed the first cut on exactly these: slice(0,10) data loss, workspace-wide RLS (intra-workspace privacy leak), and duplicate active conversations under concurrent first loads.
- **How to apply:** wiring SystemMind/AccountsMind chats or the mobile API should reuse the same hook/server fns and honor these constraints.
