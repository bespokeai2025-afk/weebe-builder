---
name: SystemMind n8n Discovery & Understanding
description: Read-only n8n workflow discovery + AI understanding layer under SystemMind (Deployment Architect evolution).
---

# SystemMind n8n Discovery & Understanding

Additive SystemMind feature: catalogs a workspace's n8n automation workflows and
generates AI "understanding" (business/technical summary, flow, deps, failure
points, tenant-specific vs reusable). Admin-only, workspace-isolated.

## Hard constraint — n8n is READ-ONLY
`src/lib/systemmind/n8n-client.server.ts` issues **only HTTP GET** via a single
`n8nGet` helper. There are deliberately NO create/edit/rename/activate/deactivate
helpers. **Never add a write verb to this client.** Auth header `X-N8N-API-KEY`;
list uses cursor pagination (`nextCursor`), capped at 1000 workflows / 50 pages.

**Why:** the whole feature is discovery-only; mutating a customer's live n8n
instance is out of bounds and could break production automations.

## Config
- Secret `N8N_API_KEY` (n8n public API key) — feature shows a graceful
  "not connected" state when absent (`isN8nConfigured()`).
- Env `N8N_API_BASE_URL` (shared), default `https://bespoke.app.n8n.cloud/api/v1`.
  Client appends `/api/v1` if only an origin is given.

## Storage + preserve-understanding rule
Table `systemmind_n8n_workflows`, upserted by `(workspace_id, n8n_workflow_id)`.
On re-scan, existing AI `understanding` is **preserved only when** the prior row
has understanding AND `n8n_updated_at` is unchanged; otherwise understanding/
confidence/ai_model/understood_at are **nulled** to flag re-analysis.

**Why:** re-scan must not throw away expensive AI work, but must re-flag changed
workflows so their understanding is regenerated.

## AI understanding
Generated **on-demand per workflow** (UI auto-triggers on first detail open),
NOT during scan — avoids server-fn timeouts on large instances. Prompt sends the
**compacted metadata** (`summariseForPrompt`), never the full `raw_snapshot`.
Grounded via exported `querySystemMindKnowledgeContext(workspaceId, query, apiKey)`.
JSON parse via fenced-strip + first-`{}` fallback; confidence clamped 0–100
(tolerates 0–1 scale). Model gpt-4o-mini; key = `process.env.OPENAI_API_KEY ?? settings.openai_api_key`.

## Known defense-in-depth gap
`raw_snapshot` stores the full n8n workflow definition, which can embed sensitive
parameter values (e.g. HTTP header auth). RLS SELECT grants any `workspace_members`
row (not admin-only), while the app layer is admin-gated. Matches the task's stated
"RLS via workspace_members" design; tightening SELECT to admins is a filed follow-up.

## Ops
Migration `supabase/migrations/SYSTEMMIND_N8N_DISCOVERY_MIGRATION.sql` must be
applied MANUALLY in the Supabase SQL editor (no Supabase DDL access in sandbox).
