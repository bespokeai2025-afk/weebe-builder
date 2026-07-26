-- Universal Mind Intelligence Packet — additive, idempotent.
-- Adds packet storage + readiness state to the existing work-order/task
-- backbone (no new tables; no data rewrites; legacy rows keep NULLs).

ALTER TABLE public.hivemind_tasks
  ADD COLUMN IF NOT EXISTS intelligence_packet jsonb,
  ADD COLUMN IF NOT EXISTS readiness_state text,
  ADD COLUMN IF NOT EXISTS packet_version integer;

ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS intelligence_packet jsonb,
  ADD COLUMN IF NOT EXISTS readiness_state text,
  ADD COLUMN IF NOT EXISTS packet_version integer;

-- Readiness values are validated in code; constrain loosely but idempotently.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'hivemind_tasks_readiness_state_check'
  ) THEN
    ALTER TABLE public.hivemind_tasks
      ADD CONSTRAINT hivemind_tasks_readiness_state_check
      CHECK (readiness_state IS NULL OR readiness_state IN (
        'insufficient_context','target_resolution_required','integration_required',
        'evidence_gathering','investigation_required','proposal_incomplete',
        'ready_for_review','ready_for_analysis_approval','ready_for_content_approval',
        'ready_for_change_approval','ready_for_publication_approval',
        'ready_for_execution','blocked'
      ));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'work_orders_readiness_state_check'
  ) THEN
    ALTER TABLE public.work_orders
      ADD CONSTRAINT work_orders_readiness_state_check
      CHECK (readiness_state IS NULL OR readiness_state IN (
        'insufficient_context','target_resolution_required','integration_required',
        'evidence_gathering','investigation_required','proposal_incomplete',
        'ready_for_review','ready_for_analysis_approval','ready_for_content_approval',
        'ready_for_change_approval','ready_for_publication_approval',
        'ready_for_execution','blocked'
      ));
  END IF;
END $$;
