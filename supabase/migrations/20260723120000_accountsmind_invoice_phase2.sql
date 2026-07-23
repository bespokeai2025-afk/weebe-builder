-- AccountsMind Invoices Phase 2: recurring schedules + import/email metadata.
-- Additive + idempotent. Server-write-only tables (RLS on, zero policies, REVOKE).

CREATE TABLE IF NOT EXISTS public.accountsmind_recurring_invoices (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          uuid NOT NULL,
  name                  text NOT NULL,
  day_of_month          integer NOT NULL DEFAULT 1 CHECK (day_of_month BETWEEN 1 AND 28),
  currency              text NOT NULL DEFAULT 'GBP',
  tax_mode              text NOT NULL DEFAULT 'exclusive' CHECK (tax_mode IN ('exclusive','inclusive')),
  items_json            jsonb NOT NULL DEFAULT '[]'::jsonb,
  payment_profile_id    uuid NULL,
  template_id           uuid NULL,
  payment_terms         text NOT NULL DEFAULT '',
  customer_notes        text NOT NULL DEFAULT '',
  due_days              integer NOT NULL DEFAULT 30 CHECK (due_days BETWEEN 0 AND 365),
  active                boolean NOT NULL DEFAULT true,
  last_generated_month  text NULL, -- 'YYYY-MM'
  created_by_user_id    uuid NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_am_recurring_ws ON public.accountsmind_recurring_invoices (workspace_id, active);

ALTER TABLE public.accountsmind_recurring_invoices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.accountsmind_recurring_invoices FROM anon, authenticated;

ALTER TABLE public.accountsmind_invoices
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'created',
  ADD COLUMN IF NOT EXISTS recurring_id uuid NULL,
  ADD COLUMN IF NOT EXISTS last_emailed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS last_emailed_to text NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'accountsmind_invoices_source_check'
  ) THEN
    ALTER TABLE public.accountsmind_invoices
      ADD CONSTRAINT accountsmind_invoices_source_check
      CHECK (source IN ('created','imported','recurring'));
  END IF;
END $$;
