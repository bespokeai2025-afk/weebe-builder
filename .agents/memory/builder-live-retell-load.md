---
name: Builder "load live Retell agent" feature
description: Rules for loading agents from a workspace's own Retell account into the builder
---

# Builder live-agent load (Import dialog)

- Workspaces with their own Retell key can pull their live agents straight into the builder from the Import dialog ("Load from your voice workspace").
- **Rule:** listing/fetching live agents must use ONLY the workspace's own key — never fall back to the shared platform key (it holds many tenants' agents; fail closed with a friendly error).
- **Rule:** after loading a live agent, `loadFlow` must pass `agentRowId: null`. `loadFlow` preserves the current row id when the field is undefined, so Save would silently overwrite whatever local agent was open before.
- Only conversation-flow agents are loadable (importAgentJson expects `{...agent, conversationFlow}`); non-flow agents are filtered out of the picker.
