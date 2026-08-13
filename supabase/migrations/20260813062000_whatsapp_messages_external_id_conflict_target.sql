-- Make (workspace_id, external_id) usable as an ON CONFLICT target.
--
-- The original index was partial:
--   CREATE UNIQUE INDEX ... ON whatsapp_messages(workspace_id, external_id)
--     WHERE external_id IS NOT NULL;
--
-- Postgres will not infer a partial index for `ON CONFLICT (workspace_id, external_id)` unless the
-- statement repeats the index predicate, which PostgREST/supabase-js never does. So every upsert
-- from the WATI inbox sync failed with:
--   "there is no unique or exclusion constraint matching the ON CONFLICT specification"
-- and, because the sync swallowed insert errors, inbound campaign replies silently never landed.
--
-- Dropping the predicate keeps the same guarantee: NULLs compare as distinct by default, so rows
-- without an external_id are still unconstrained, while non-null values stay unique per workspace.

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_messages_workspace_external_id_key
  ON public.whatsapp_messages (workspace_id, external_id);

DROP INDEX IF EXISTS public.whatsapp_messages_workspace_external_id_idx;
