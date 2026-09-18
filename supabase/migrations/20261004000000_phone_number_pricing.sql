-- Twilio reseller model: pricing + markup (WEBEE-UIUX-AUDIT.md Twilio
-- reseller initiative, plan step 4). Two tables:
--
--   twilio_number_price_cache — Twilio's own real cost per (country, number
--   type), fetched from Twilio's Pricing API. Global, not workspace-scoped:
--   the cost is the same for every workspace, so one cached row per
--   (iso_country, number_type) serves everyone and avoids hammering the
--   Pricing API on every search render.
--
--   phone_number_markup_rules — WEBEE's markup on top of that cost. A global
--   default row, with optional per-workspace overrides (e.g. a negotiated
--   enterprise rate).
--
-- Both are locked down to service_role only: Twilio's real cost and WEBEE's
-- markup are business-sensitive (they reveal profit margin) and must never
-- be directly readable by a workspace member — only the final marked-up
-- price a customer is charged is ever shown to them, computed server-side.

CREATE TABLE IF NOT EXISTS public.twilio_number_price_cache (
  iso_country       TEXT NOT NULL,
  number_type       TEXT NOT NULL,
  current_price_usd NUMERIC(10,4) NOT NULL,
  base_price_usd    NUMERIC(10,4) NOT NULL,
  price_unit        TEXT NOT NULL DEFAULT 'USD',
  fetched_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (iso_country, number_type)
);

ALTER TABLE public.twilio_number_price_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.twilio_number_price_cache FROM authenticated;

COMMENT ON TABLE public.twilio_number_price_cache IS
  'Cached Twilio Pricing API results, 24h TTL applied in application code. Service-role-only. See src/lib/telephony/twilio-pricing.server.ts.';

CREATE TABLE IF NOT EXISTS public.phone_number_markup_rules (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope              TEXT NOT NULL DEFAULT 'global',
  workspace_id       UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  markup_type        TEXT NOT NULL,
  markup_value       NUMERIC(10,4) NOT NULL,
  fx_rate_usd_to_gbp NUMERIC(10,6) NOT NULL,
  is_active          BOOLEAN NOT NULL DEFAULT true,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'phone_number_markup_rules_scope_ck') THEN
    ALTER TABLE public.phone_number_markup_rules
      ADD CONSTRAINT phone_number_markup_rules_scope_ck
      CHECK (scope IN ('global', 'workspace'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'phone_number_markup_rules_type_ck') THEN
    ALTER TABLE public.phone_number_markup_rules
      ADD CONSTRAINT phone_number_markup_rules_type_ck
      CHECK (markup_type IN ('fixed', 'percentage'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'phone_number_markup_rules_scope_workspace_ck') THEN
    ALTER TABLE public.phone_number_markup_rules
      ADD CONSTRAINT phone_number_markup_rules_scope_workspace_ck
      CHECK ((scope = 'global' AND workspace_id IS NULL) OR (scope = 'workspace' AND workspace_id IS NOT NULL));
  END IF;
END $$;

-- At most one active global rule, and at most one active rule per workspace.
CREATE UNIQUE INDEX IF NOT EXISTS phone_number_markup_rules_one_active_global
  ON public.phone_number_markup_rules ((true)) WHERE scope = 'global' AND is_active;
CREATE UNIQUE INDEX IF NOT EXISTS phone_number_markup_rules_one_active_per_workspace
  ON public.phone_number_markup_rules (workspace_id) WHERE scope = 'workspace' AND is_active;

ALTER TABLE public.phone_number_markup_rules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.phone_number_markup_rules FROM authenticated;

COMMENT ON TABLE public.phone_number_markup_rules IS
  'WEBEE markup on top of Twilio''s real number cost. Global default + optional per-workspace override. Service-role-only. See src/lib/telephony/twilio-pricing.server.ts.';
