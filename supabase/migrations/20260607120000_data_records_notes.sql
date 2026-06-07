-- Add notes column to data_records for importable free-text notes
ALTER TABLE public.data_records
  ADD COLUMN IF NOT EXISTS notes TEXT;
