-- Campaign minute tracking: link standard calls to WEBEE campaigns.
-- Additive + idempotent. `campaign_id` stays NULL for calls that cannot be
-- confidently attributed (reported under "Unassigned Campaign").
ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS campaign_id uuid NULL REFERENCES public.campaigns(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_calls_ws_campaign_created
  ON public.calls (workspace_id, campaign_id, created_at DESC);

-- Duration-window aggregation support (paged fetches order by created_at
-- within a workspace; existing idx on (workspace_id, created_at) may already
-- exist — keep idempotent).
CREATE INDEX IF NOT EXISTS idx_calls_ws_created
  ON public.calls (workspace_id, created_at DESC);
