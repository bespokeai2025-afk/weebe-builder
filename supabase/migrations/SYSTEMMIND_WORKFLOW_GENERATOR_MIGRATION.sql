-- ── SystemMind Workflow Generator — schema additions ──────────────────────────
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New query → Run).
-- Idempotent: safe to re-run.

-- 1. Add missing columns to systemmind_workflow_drafts
ALTER TABLE public.systemmind_workflow_drafts
  ADD COLUMN IF NOT EXISTS workflow_type              TEXT,
  ADD COLUMN IF NOT EXISTS required_integrations_json JSONB       NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS missing_capabilities_json  JSONB       NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS validation_results_json    JSONB       NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS created_by                 TEXT,
  ADD COLUMN IF NOT EXISTS updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- 2. Add UPDATE RLS policy (needed for status changes + edits)
DROP POLICY IF EXISTS "sm_wd_upd" ON public.systemmind_workflow_drafts;
CREATE POLICY "sm_wd_upd" ON public.systemmind_workflow_drafts
  FOR UPDATE USING (
    workspace_id IN (
      SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
    )
  );

-- 3. Grant UPDATE to authenticated
GRANT UPDATE ON public.systemmind_workflow_drafts TO authenticated;

-- 4. Trigger to keep updated_at in sync
CREATE OR REPLACE FUNCTION public.sm_wd_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sm_wd_updated_at ON public.systemmind_workflow_drafts;
CREATE TRIGGER sm_wd_updated_at
  BEFORE UPDATE ON public.systemmind_workflow_drafts
  FOR EACH ROW EXECUTE FUNCTION public.sm_wd_set_updated_at();
