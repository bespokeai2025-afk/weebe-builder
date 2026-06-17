---
name: Custom Agent Workflow Generator + Deployment Configurator
description: Builder "Custom" agent type with Option A (generate from description) and Option B (analyze script → deployment config). Admin change requests system.
---

# Custom Agent Architecture

## assertAdmin pattern
`assertAdmin` is a **private function per file** — it is NOT exported from any shared module. Each file that needs it must define its own copy:
```typescript
async function assertAdmin(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await (supabaseAdmin as any)
    .from("user_roles").select("role")
    .eq("user_id", userId).eq("role", "admin");
  if (!data || data.length === 0) throw new Error("Forbidden");
}
```
Extract `userId` from `supabase.auth.getUser()` before calling.

## Key files
- `src/lib/systemmind/custom-agent.functions.ts` — all 7 server fns
- `src/components/builder/CustomAgentPanel.tsx` — two-tab builder panel
- `src/routes/_authenticated/admin.change-requests.tsx` — admin page
- `supabase/migrations/20260717000003_custom_agent_configs.sql` — **must be applied manually**

## Tables (migration 20260717000003, manual apply)
- `custom_agent_configs` — stores Option B analysis output (12 sections JSONB) per agent
- `admin_change_requests` — billable capability gap requests from SystemMind

## Safety rules
- No automatic deployment; SystemMind creates drafts/configs only
- Never touch existing Retell/HyperStream/VoxStream deploy flows
- `agentType === "custom"` only affects Builder right panel, not Go Live pipeline

## Canvas import (Option A)
`importDraftToCanvas(draft)` uses `useBuilderStore.getState()` directly (not hook) to call `clearAll()`, `addNode(kind, pos)`, `updateNode(id, data)`, then `useBuilderStore.setState({ edges })`. Node type mapping: conversation→conversation, function→function, call_transfer→call_transfer, end/ending→ending, http/webhook→http_request, default→conversation.

**Why:** Builder canvas can't be set via a React hook during an async callback; must call `useBuilderStore.getState()` imperatively.
