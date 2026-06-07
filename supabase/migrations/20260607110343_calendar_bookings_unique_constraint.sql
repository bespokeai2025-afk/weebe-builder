-- Replace the partial unique index on calendar_bookings with a proper unique
-- constraint so that ON CONFLICT (workspace_id, external_id) works correctly
-- in upsert operations. PostgreSQL unique constraints treat NULLs as distinct,
-- so multiple rows with NULL external_id are still allowed.

DROP INDEX IF EXISTS public.calendar_bookings_workspace_external_idx;

ALTER TABLE public.calendar_bookings
  ADD CONSTRAINT calendar_bookings_workspace_external_uniq
  UNIQUE (workspace_id, external_id);
