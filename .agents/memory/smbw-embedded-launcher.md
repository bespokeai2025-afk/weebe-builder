---
name: SystemMind Build embedded launcher pattern
description: Rules for the Builder prompt dock → Build Workspace drawer handoff (session reuse, state resets, one-shot prompt latch)
---

The Agent Builder embeds the SystemMind Build Workspace via a launcher hook
(prompt dock + right-side drawer) instead of navigation. Three invariants keep it
correct:

1. **Reset transient state when the target changes.** The launcher holds
   `sessionId`/`initialPrompt` locally; on `agentRowId` change all of it (and the
   drawer open state) must be cleared, or agent A's session receives agent B's
   prompts. **Why:** local session state outlives the agent selection.

2. **Never create before the sessions list has loaded.** Reuse is decided by
   finding the newest non-archived session with a matching `target_agent_id` in
   the `["smbw-sessions"]` query; launching while that query is pending creates
   duplicate sessions. Gate launch/submit on the query settling.

3. **One-shot prompt latch must reset on null.** The drawer's session view
   auto-sends `initialPrompt` once, then calls `onInitialPromptConsumed` (parent
   sets it null). The sent-latch must reset when the prompt becomes null so the
   next handed-off prompt also auto-sends — a never-resetting boolean silently
   drops all prompts after the first while the view stays mounted.

**How to apply:** reuse this pattern for any future "embed a session-based
workspace inside another page" feature (drawer + launcher hook + prompt handoff).
