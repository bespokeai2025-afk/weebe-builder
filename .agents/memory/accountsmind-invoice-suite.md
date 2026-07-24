---
name: AccountsMind invoice suite (Phase 1 rebuild)
description: Design rules for the 6-tab invoice suite — lifecycle, audit-before-mutation, payments ledger, cents math, DB guardrails.
---

The AccountsMind Invoices page is a 6-tab suite (Dashboard / Create / Services / Templates /
Business / Settings) built on `invoice-suite.functions.ts` + pure shared totals engine
`invoice-totals.shared.ts`.

Rules future changes must keep:
- **Money is integer cents everywhere.** Totals recomputed server-side on save; document
  generation refuses if stored totals ≠ recomputed from `line_items_json` (re-save first).
- **Only drafts are editable/deletable.** Issued invoices go through the
  `STATUS_TRANSITIONS` graph (cancel/void/refund only, reason required, always audited).
  Legacy status `unpaid` is a valid alias of `ready`.
- **Audit-before-mutation for critical actions** (status change, payment, issuance):
  `writeAuditStrict()` inserts the audit row first and aborts the op if it fails. Best-effort
  `writeAudit()` (which must check `{error}` — supabase doesn't throw) is only for non-critical
  events.
- **Payments table is the authoritative ledger.** `amount_paid_cents` is recomputed from it;
  manual "mark paid" inserts a balancing `manual_mark_paid` payment row; payments capped at
  the outstanding balance and blocked on paid/refunded/cancelled/void/draft.
- **DB guardrails exist**: CHECK constraints on `accountsmind_invoices.status` and
  `accountsmind_invoice_payments.amount_cents > 0` (migration 20260723110000) — new statuses
  need a constraint update, not just a code change.
- Invoice numbers: insert-first + 23505 retry from `accountsmind_invoice_settings` (singleton
  id=1). Storage paths are per-invoice (`invoices/<ws>/<id>_<number>.<ext>`), regeneration
  replaces only that invoice's own file.
- Payment profiles are masked on list; reveal is a separate audited server fn; a `••••` value
  round-tripped on save means "unchanged" and must not overwrite the stored value.
- **Outstanding = total − paid − credited.** Credit notes/write-offs accumulate in
  `credited_cents`; every payment cap, mark-paid balancing row, KPI aggregate, and UI balance
  must subtract credits too. Fully settled (paid + credited ≥ total) → status `paid`.
- **Credit-note issuance uses compensating rollback**: insert CN row first, then update the
  invoice with an optimistic guard (`.eq status` + `.eq credited_cents` + `.select("id")`,
  check row count); on 0 rows delete the CN and audit the revert. Supabase has no transactions
  from JS, so this is the pattern for multi-row financial mutations.
- **CSV cells must neutralize formula injection**: prefix `'` on leading `=+-@\t\r` before
  quoting.
- PDF-overlay templates (`template_type='pdf_overlay'`, `fields_json` %-coords from top-left)
  render via pdf-lib only — DOCX generation is blocked for them.

**Why:** financial records — silent deletion/edit of issued invoices, float drift, or an audit
trail that lags reality are compliance failures.

**How to apply:** any Phase 2/3 work (PDF-overlay templates, email send, recurring invoices,
credit notes, CSV import) must route mutations through these same server fns / rules, not new
ad-hoc writes.
