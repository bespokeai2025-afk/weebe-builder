---
name: HiveMind chat-initiated work orders
description: Pattern for letting Mind chat create/approve work orders conversationally; resolver + proposal-card rules.
---

Chat tools (registered as hivemind.* writes in the growthmind-control tool registry) may CREATE work orders but never execute them — the created hivemind_task must land suggested/awaiting_approval, and the chat UI approves via the same approveAndRunTask/approveHiveMindAction server fns as the Action Centre, so chat, task and Action Centre stay one record.

**Why:** the milestone requirement is "linked action = same record everywhere" and proposal-only safety; a chat-specific execution path would bypass mode gates and approvals.

**How to apply:**
- Campaign/entity name resolution must normalise conversational phrasing (strip intent words like improve/optimise/analyse and trailing "campaign", punctuation) before exact→substring→token matching; ambiguous → return candidates and create NOTHING; not_found → return real candidates.
- The AI server fn surfaces created proposals to the client by collecting them from tool outcomes (workOrderProposals on the chat response), not by parsing the model text.
- Proposal-card polling: refetchInterval must keep polling for a bounded window (ref to approve timestamp) while an execution row hasn't appeared yet — the first refetch races execution-row creation and would otherwise stall on "Running…".
- E2E fixtures: follow the mind-tool-registry pattern (workspace + member + workspace_subscriptions with a growthmind-dept package + invalidateEntitlementsCache + non-observe hivemind_mode) and seed growthmind_gads_campaign_daily rows — that table is the ONLY source the resolver reads.
