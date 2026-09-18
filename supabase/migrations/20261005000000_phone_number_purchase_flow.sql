-- Twilio reseller model: purchase flow (plan step 5).
--
-- 1. Price snapshot columns on phone_numbers, captured once at purchase time
--    and never recomputed — a later markup-rule change must not silently
--    reprice an already-purchased number. Nullable: imported/BYOK numbers
--    have no WEBEE markup pricing associated with them.
--
-- 2. phone_number_purchase_locks: a server-side idempotency guard. A row is
--    inserted before calling Twilio's purchase API and deleted in a finally
--    block regardless of outcome; the primary key makes a second concurrent
--    request for the same (workspace, number) fail fast on insert, before
--    it ever reaches Twilio, rather than relying on a client-side disabled
--    button (which doesn't protect against two tabs or a retried request).

ALTER TABLE public.phone_numbers
  ADD COLUMN IF NOT EXISTS twilio_subaccount_sid TEXT,
  ADD COLUMN IF NOT EXISTS cost_usd_cents_monthly INTEGER,
  ADD COLUMN IF NOT EXISTS price_gbp_pence_monthly INTEGER;

CREATE TABLE IF NOT EXISTS public.phone_number_purchase_locks (
  workspace_id UUID NOT NULL,
  phone_number TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, phone_number)
);

ALTER TABLE public.phone_number_purchase_locks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.phone_number_purchase_locks FROM authenticated;

COMMENT ON TABLE public.phone_number_purchase_locks IS
  'Ephemeral purchase-in-flight marker, not a permanent record — inserted before a Twilio purchase call and deleted right after, success or failure. Service-role-only. See src/lib/telephony/phone-provisioning.functions.ts.';
