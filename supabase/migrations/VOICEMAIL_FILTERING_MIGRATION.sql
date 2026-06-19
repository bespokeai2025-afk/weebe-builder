-- Voicemail Filtering Migration
-- Idempotently adds is_voicemail boolean column to public.calls and backfills.
-- Apply manually in Supabase SQL Editor.
DO $$
DECLARE
  _count integer;
BEGIN
  -- Add column only if it does not already exist (existing field is in_voicemail)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'calls'
      AND column_name  = 'is_voicemail'
  ) THEN
    ALTER TABLE public.calls ADD COLUMN is_voicemail boolean NOT NULL DEFAULT false;
    RAISE NOTICE '[voicemail] Added is_voicemail column to public.calls';
  ELSE
    RAISE NOTICE '[voicemail] is_voicemail column already exists, skipping ALTER';
  END IF;

  -- Backfill: set is_voicemail = true for all rows matching any voicemail signal
  UPDATE public.calls
  SET is_voicemail = true
  WHERE is_voicemail = false
    AND (
      in_voicemail = true
      OR call_status = 'voicemail'
      OR disconnection_reason ILIKE ANY(ARRAY['%voicemail%', '%answering machine%', '%leave a message%', '%mailbox%', '%beep%', '%not available%', '%automated message%'])
      OR call_outcome         ILIKE ANY(ARRAY['%voicemail%', '%answering machine%', '%leave a message%', '%mailbox%', '%beep%', '%not available%', '%automated message%'])
      OR call_summary         ILIKE ANY(ARRAY['%voicemail%', '%answering machine%', '%leave a message%', '%mailbox%', '%beep%', '%not available%', '%automated message%'])
      OR transcript           ILIKE ANY(ARRAY['%voicemail%', '%answering machine%', '%leave a message%', '%mailbox%', '%beep%', '%not available%', '%automated message%'])
    );

  GET DIAGNOSTICS _count = ROW_COUNT;
  RAISE NOTICE '[voicemail] Backfilled % voicemail rows', _count;
END $$;
