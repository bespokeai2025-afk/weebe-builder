-- Add 'actioned' to growthmind_trend_items status check — set when a user
-- creates content from a recommended trend, so the item is no longer
-- re-suggested (and never marked stale, which only touches discovered/screened).
ALTER TABLE public.growthmind_trend_items
  DROP CONSTRAINT IF EXISTS growthmind_trend_items_status_check;
ALTER TABLE public.growthmind_trend_items
  ADD CONSTRAINT growthmind_trend_items_status_check
  CHECK (status IN ('discovered','screened','analysed','recommended','dismissed','stale','archived','actioned'));
