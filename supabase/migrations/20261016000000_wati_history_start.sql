-- BuzzChat "fresh start" after a WhatsApp number change.
--
-- When a workspace moves to a new WhatsApp number (new WhatsApp Business Account), messages sent
-- from the old number shouldn't decide who counts as "already messaged" for the new one. With
-- history_start_at set, only messages sent on or after it count; older campaigns and messages stay
-- in the database untouched and are hidden from the campaign list by default.
--
-- Additive. Apply in Supabase SQL Editor.

ALTER TABLE public.wati_connections
  ADD COLUMN IF NOT EXISTS history_start_at TIMESTAMPTZ;

COMMENT ON COLUMN public.wati_connections.history_start_at IS
  'Only WhatsApp messages sent at or after this time count as "already messaged" (set when the number changes). Null = all history counts.';
