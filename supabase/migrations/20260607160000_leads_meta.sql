-- Add a flexible meta JSONB column to leads for storing custom post-call variable values
-- that don't map to a fixed column (via "Store in lead meta (custom)" mapping option).

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS meta JSONB NOT NULL DEFAULT '{}'::jsonb;
