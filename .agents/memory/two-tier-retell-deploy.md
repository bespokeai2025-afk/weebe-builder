---
name: Two-tier Retell deploy model
description: How agents are built in one Retell workspace and deployed to per-client dedicated Retell workspaces.
---

## Rule
Builder (create/update agents) always uses the platform `RETELL_API_KEY` (env var).
Go Live (clone + phone ops) uses a per-client Retell API key stored server-side — the client never sees or enters any key.

**Why:** Each client gets a dedicated Retell workspace (sub-account) billed and isolated separately. Admin provisions it and stores the key; clients get a one-click deploy experience.

## How to apply
1. Admin approves a workspace_request → enters the client's dedicated Retell workspace API key.
2. Key is stored in `workspace_settings.retell_workspace_id` (repurposed column — holds a `key_...` string).
3. `cloneRetellAgentForDeploy` reads from workspace_settings when no explicit key is provided.
4. `retellFetchForAgent` (phone buy/attach/list/import) falls back to workspace_settings key via `workspaceId` param.
5. `DeployAgentDialog` sends no API key from the client; the workspace name comes from the approved workspace_request.

## Key files
- `src/lib/agents/workspace.functions.ts` — `decideWorkspaceRequest` stores retellApiKey in workspace_settings
- `src/lib/builder/retell.functions.ts` — `retellFetchForAgent` + `cloneRetellAgentForDeploy` auto-resolve key
- `src/components/agents/DeployAgentDialog.tsx` — no manual key input; workspace name shown from wsReq
- `src/routes/_authenticated/admin.users.tsx` — Workspace Requests section with Retell key approval UI
