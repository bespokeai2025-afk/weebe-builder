-- AccountsMind Invoices Phase 3: credit notes + PDF-overlay / visual template types.
-- Additive + idempotent. Server-write-only tables (RLS on, zero policies, REVOKE).

CREATE TABLE IF NOT EXISTS public.accountsmind_credit_notes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid NOT NULL,
  invoice_id          uuid NOT NULL,
  credit_note_number  text NOT NULL UNIQUE,
  amount_cents        bigint NOT NULL CHECK (amount_cents > 0),
  currency            text NOT NULL DEFAULT 'GBP',
  reason              text NOT NULL,
  kind                text NOT NULL DEFAULT 'credit_note' CHECK (kind IN ('credit_note','write_off')),
  status              text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','cancelled')),
  created_by_user_id  uuid NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_am_credit_notes_ws ON public.accountsmind_credit_notes (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_am_credit_notes_inv ON public.accountsmind_credit_notes (invoice_id);

ALTER TABLE public.accountsmind_credit_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.accountsmind_credit_notes FROM anon, authenticated;

-- Template types: docx (existing), pdf_overlay (background PDF + positioned fields),
-- visual (block layout built in WEBEE). fields_json holds overlay/visual layout.
ALTER TABLE public.accountsmind_invoice_templates
  ADD COLUMN IF NOT EXISTS template_type text NOT NULL DEFAULT 'docx',
  ADD COLUMN IF NOT EXISTS fields_json jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'accountsmind_invoice_templates_type_check'
  ) THEN
    ALTER TABLE public.accountsmind_invoice_templates
      ADD CONSTRAINT accountsmind_invoice_templates_type_check
      CHECK (template_type IN ('docx','pdf_overlay','visual'));
  END IF;
END $$;

-- Credited totals live on the invoice for cheap list reads.
ALTER TABLE public.accountsmind_invoices
  ADD COLUMN IF NOT EXISTS credited_cents bigint NOT NULL DEFAULT 0;
