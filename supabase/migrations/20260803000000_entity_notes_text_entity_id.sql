-- entity_notes.entity_id was UUID-only, but many rows across the platform
-- (WBAH-derived leads/contacts/calls, CRM-only booked contacts, etc.) use
-- synthetic non-UUID string ids like "crm:07123456789" or "wbah:<id>".
-- Any note add/list/delete against one of those entities failed validation
-- (client) or the INSERT/SELECT itself (DB), so notes silently didn't work
-- anywhere those synthetic ids are used. Widen the column to TEXT so any
-- entity id — UUID or synthetic string — can carry notes.

ALTER TABLE public.entity_notes
  ALTER COLUMN entity_id TYPE TEXT USING entity_id::text;

-- Index already covers (workspace_id, entity_type, entity_id, created_at);
-- TEXT indexes fine with the existing btree, no rebuild needed beyond the
-- implicit one from the ALTER COLUMN TYPE.
