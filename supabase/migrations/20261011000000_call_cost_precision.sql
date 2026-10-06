-- Sub-cent precision for voice call cost.
--
-- Problem: `calls.cost_cents` is an INTEGER and the webhook processor writes it with
-- `Math.round(call_cost.combined_cost)` — discarding a value that arrives at 4 decimal places
-- (`NativeCallLifecycle.buildCall`). At the seeded blended engine rate of ~3.11 cents/minute:
--
--     5s  call = 0.259 cents -> stored 0   (-100%)
--    10s  call = 0.518 cents -> stored 1   (+93%)
--    45s  call = 2.331 cents -> stored 2   (-14%)
--
-- Test calls are short, so per-call cost was unusable for exactly the case it is most needed:
-- confirming what a call just cost, broken down by the providers it used.
--
-- Fix: keep `cost_cents` exactly as it is — rounded, INTEGER, written the same way — because a
-- long tail of reporting reads it (`analytics-hub`, `campaign-usage`, `report-writer`,
-- `accountsmind-config`) and changing its type or meaning would ripple through all of them.
-- Add a precise column alongside it. Cost surfaces prefer the precise column and fall back to
-- `cost_cents` for rows written before this migration.
--
-- Unit is deliberately the SAME as `cost_cents` (USD cents), just with decimals, so the two can
-- be compared without a conversion in the reader's head. NUMERIC, not a float: this is money.
--
-- Apply in Supabase SQL Editor.

ALTER TABLE calls
  ADD COLUMN IF NOT EXISTS cost_cents_precise NUMERIC(14, 6);

COMMENT ON COLUMN calls.cost_cents_precise IS
  'Engine cost in USD cents at full precision, priced against the providers the call actually used (see resolveVoiceCallCost). Excludes carrier minutes for real phone calls, which reconcile from the carrier invoice. `cost_cents` is this value rounded to a whole cent and is kept for existing reporting. Null for calls made before this column existed.';

-- Back-fill is deliberately NOT attempted. Rows written before this have only a rounded whole
-- cent and, for most of them, no recorded provider either — so any back-fill would be inventing
-- precision that was never measured. They keep `cost_cents` and read as estimates.
