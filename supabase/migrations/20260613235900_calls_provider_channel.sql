-- Add provider and channel_type columns to calls table
ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS provider TEXT,
  ADD COLUMN IF NOT EXISTS channel_type TEXT;
