-- AccountsMind invoice status tracking (additive, idempotent).
ALTER TABLE public.accountsmind_invoices
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS due_date date,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS status_updated_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'accountsmind_invoices_status_check'
  ) THEN
    ALTER TABLE public.accountsmind_invoices
      ADD CONSTRAINT accountsmind_invoices_status_check
      CHECK (status IN ('unpaid', 'sent', 'paid', 'overdue', 'cancelled'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS accountsmind_invoices_status_idx
  ON public.accountsmind_invoices (status, created_at DESC);
CREATE INDEX IF NOT EXISTS accountsmind_invoices_ws_status_idx
  ON public.accountsmind_invoices (workspace_id, status);
