ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS spend_limit_cents integer NOT NULL DEFAULT 500,
  ADD COLUMN IF NOT EXISTS spend_used_cents integer NOT NULL DEFAULT 0;

-- Admins need to read these via the admin client (service role bypasses RLS),
-- and the user themselves should be able to read their own usage.
-- Existing SELECT policies on profiles already cover both cases.