---
name: SystemMind Template Library & Parameters
description: Curated reusable workflow-template repository built on top of the #295 n8n discovery layer — classification, parameter extraction, lifecycle/trust, versioning.
---

# SystemMind Template Library

Additive layer on top of the n8n discovery tables. Turns discovered `systemmind_n8n_workflows`
rows into curated, parameterised, versioned deployment templates. Admin-only, workspace-isolated,
**never deploys anything** — templates are curated artifacts only.

## Data model
- Classification columns ADDED to `systemmind_n8n_workflows` (all nullable): `template_type`,
  `workflow_category`, `classification` (jsonb), `classified_at`, `classified_by`.
  **Why nullable + additive:** the #295 re-scan upsert only writes discovery columns, so
  classification survives re-scans. Never make these NOT NULL.
- New tables: `systemmind_workflow_templates` (the repository) + `systemmind_template_versions`
  (full-snapshot history). Migration is **manual-apply**: `supabase/migrations/SYSTEMMIND_TEMPLATE_LIBRARY_MIGRATION.sql`.

## Trust / security invariants (do not weaken)
- `is_trusted` is set true **only** in `approveTemplate`. It is the trust anchor for downstream
  deployment phases. `status` + `is_trusted` are excluded from the update whitelist (EDITABLE_FIELDS)
  and editing an approved template resets it to `draft`.
- RLS on both new tables is **SELECT-only** for `authenticated`; `authenticated` gets only a SELECT
  grant. ALL writes go through `supabaseAdmin` (service_role) inside admin-gated server fns.
  **Why:** members must not be able to forge `status`/`is_trusted` via direct PostgREST calls.
- Deployment-variable extraction **masks secrets** (partial first-3/last-4) — raw secret values are
  never stored on a template. Export strips ids/workspace/timestamps; import is zod-validated and
  forced to `draft`/untrusted with linked sources dropped.

## Code layout
- `systemmind-templates.server.ts` — classification (heuristic + AI), `extractParameters`,
  `buildStructure` (node identity only), CRUD + lifecycle (create/list/detail/update/clone/
  export/import/submit/approve/reject/archive/delete), `listWorkflowsForTemplates`.
- `systemmind-templates.functions.ts` — createServerFn wrappers, each `requireSupabaseAuth +
  requirePlatformAdmin`, workspace-scoped, server logic dynamic-imported.
- `systemmind-templates.schema.ts` — zod `importedTemplateSchema`.
- UI: `SystemMindTemplateLibraryPage.tsx` (Templates tab + Workflows/classification tab),
  route `systemmind.template-library.tsx` (admin beforeLoad), nav in SystemMindShell (Intelligence group).
