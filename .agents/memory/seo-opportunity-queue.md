---
name: SEO Opportunity Queue
description: Durable rules for the ranked SEO queue's execution lifecycle and honesty guarantees
---

- Execute lifecycle: atomic open→executing CAS claim happens BEFORE the marketing action is created; the executor only runs claimed rows. **Why:** read-then-write allowed two concurrent users to double-create campaigns/sitemap submissions.
- Failed/rejected marketing actions must reconcile back to the opportunity (reopen with failure context) — refresh never re-proposes `executing` rows, so without reconciliation a failed action strands the item forever. **How to apply:** any new terminal action state needs a reconcile branch.
- Query-keyed opportunities route through the approval-first campaign pipeline; only URL-keyed changes become website handoff packages (a search query is not a deployable route). Package verify() confirms delivery only, never that the SEO change is live.
- The queue core is loaded from the vite-config plugin chain → must stay alias-free (no `@/` imports).
- Campaign-type mappings must match the `growthmind_seo_campaigns` CHECK constraint (a test asserts this — extend both together).
