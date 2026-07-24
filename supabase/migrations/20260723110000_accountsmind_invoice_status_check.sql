-- DB-level guardrail: invoice lifecycle status must be one of the known values.
-- App code enforces the transition graph; this prevents any nonconforming
-- write path (service-role scripts, future code) from persisting invalid states.
-- NOTE: a stale pre-suite constraint with the same name existed on the live DB
-- (whitelist: unpaid/sent/paid/overdue/cancelled only) — so this must DROP and
-- recreate, not skip on name-exists.
ALTER TABLE public.accountsmind_invoices
  DROP CONSTRAINT IF EXISTS accountsmind_invoices_status_check;
ALTER TABLE public.accountsmind_invoices
  ADD CONSTRAINT accountsmind_invoices_status_check
  CHECK (status IN (
    'draft','ready','unpaid','sent','viewed','partially_paid',
    'paid','overdue','cancelled','void','refunded'
  ));

-- Payments must be positive amounts.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'accountsmind_invoice_payments_amount_check'
  ) THEN
    ALTER TABLE public.accountsmind_invoice_payments
      ADD CONSTRAINT accountsmind_invoice_payments_amount_check
      CHECK (amount_cents > 0);
  END IF;
END $$;
