-- Extend systemmind_build_sessions.source_page CHECK for WBAH workflow wizard + deployment orchestrator.
-- Idempotent: safe to re-run.

ALTER TABLE public.systemmind_build_sessions
  DROP CONSTRAINT IF EXISTS systemmind_build_sessions_source_page_check;

ALTER TABLE public.systemmind_build_sessions
  ADD CONSTRAINT systemmind_build_sessions_source_page_check
  CHECK (source_page IN (
    'agent_builder',
    'whatsapp_builder',
    'follow_up_centre',
    'workflows',
    'systemmind',
    'hivemind',
    'wbah_workflow_wizard',
    'deployment_orchestrator'
  ));
