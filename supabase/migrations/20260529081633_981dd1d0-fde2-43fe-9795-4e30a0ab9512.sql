ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS admin_reviewed_at timestamptz;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS admin_reviewed_by uuid;