-- Industry-aware AccountsMind: record each workspace's industry.
-- Applied 2026-07-15 via Supabase Management API (additive + idempotent).
ALTER TABLE public.workspace_settings ADD COLUMN IF NOT EXISTS industry text;
