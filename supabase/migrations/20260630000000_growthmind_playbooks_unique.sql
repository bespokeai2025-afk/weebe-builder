-- Add unique constraint on (workspace_id, industry) so activatePlaybook can upsert
-- instead of always inserting a new row.
--
-- The prior behaviour inserted a fresh row on every activation, so duplicate
-- (workspace_id, industry) pairs may already exist. Deduplicate first by
-- deleting all but the most-recently activated row per pair.

DELETE FROM growthmind_playbooks
WHERE id NOT IN (
  SELECT DISTINCT ON (workspace_id, industry) id
  FROM growthmind_playbooks
  ORDER BY workspace_id, industry, activated_at DESC, created_at DESC
);

ALTER TABLE growthmind_playbooks
  ADD CONSTRAINT uq_growthmind_playbooks_workspace_industry
  UNIQUE (workspace_id, industry);
