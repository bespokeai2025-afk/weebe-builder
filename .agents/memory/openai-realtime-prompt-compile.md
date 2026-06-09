---
name: OpenAI Realtime needs a flattened flow prompt
description: Why HyperStream (OpenAI Realtime) agents must compile the conversation-flow graph into one instruction string, unlike Retell.
---

Retell consumes the builder's conversation flow as a structured graph (nodes + edges + transitions + global_prompt). OpenAI Realtime has NO conversation-flow concept — its `session.update` accepts only ONE free-text `instructions` string.

**Rule:** any OpenAI Realtime path (browser test call AND server session creation) must linearize the whole flow into a single prompt, not send a hardcoded/generic string and not just the start node's dialogue.

**Why:** sending a generic prompt (or only the start node) means the user's actual script — global prompt, greeting, every conversation step and its transitions — is silently dropped. The agent talks but ignores the flow. This was a real reported bug.

**How to apply:** compile global prompt + begin message + a BFS-ordered walk from the start node (follow `data.transitions` targets and graph edges) rendering each node's dialogue/action and its transition conditions. Nodes unreachable from start must go in a SEPARATE section (not numbered script steps) so the model doesn't execute orphans in order. Render every executable kind (conversation, function, transfers, sms, extract_variable, logic_split, press_digit, code, ending) — silently skipping a kind loses its transition logic. Keep both call sites (builder test call and the server session creator) using the same compiler so deployed and test behavior match.
