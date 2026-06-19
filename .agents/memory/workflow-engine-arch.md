---
name: Workflow Engine Architecture
description: Phase 18-19 Workflow Engine — tables, executor, visual builder, nav wiring
---

## Tables (WORKFLOW_ENGINE_MIGRATION.sql — must be applied manually)
- workflow_template_categories, workflow_templates, workflow_template_versions (platform)
- workspace_workflows, workflow_runs, workflow_run_events, workflow_schedules (per-tenant)
- 7 platform templates seeded; 8 categories seeded

## Key files
- `src/lib/workflow-engine/workflow-engine.functions.ts` — all server fns
- `src/lib/workflow-engine/workflow-executor.server.ts` — real step executor
- `src/components/workflow-engine/WorkflowBuilder.tsx` — visual @xyflow/react builder
- `src/components/workflow-engine/WorkflowEnginePage.tsx` — main workspace UI
- `src/components/workflow-engine/WorkflowTemplatesAdminPage.tsx` — admin template mgmt
- `src/components/hivemind/HiveMindWorkflowIntelligence.tsx` — HiveMind monitoring
- Routes: `/workflow-engine`, `/admin/workflow-templates`, `/hivemind/workflow-intelligence`

## Executor dispatches
- update_lead_status → leads table
- push_to_crm → dispatchCrmPostCall
- create_callback → entity_notes
- create_task → hivemind_tasks
- send_whatsapp → whatsapp_messages queue
- call_lead → leads.status = "pending_call"

**Why:** Phase 18-19 spec: no duplicate infrastructure, reuse existing WEBEE systems for all actions.

**How to apply:** Run WORKFLOW_ENGINE_MIGRATION.sql in Supabase SQL Editor before the engine is functional.
