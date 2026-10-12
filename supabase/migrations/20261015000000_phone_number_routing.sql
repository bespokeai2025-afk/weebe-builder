-- Retell-style per-number call routing for numbers the WEBEE engine answers.
--
-- Retell lets each phone number carry its own inbound and outbound agents (with weights for A/B
-- tests), an inbound webhook, allowed countries in each direction and a fallback number. The
-- builder showed these controls but could not save any of them. All columns are optional and
-- default to "no change in behaviour": with them empty, a number routes to `agent_id` as before.
--
-- Additive only. Apply in Supabase SQL Editor.

ALTER TABLE public.phone_numbers
  -- [{ "agent_id": "<agents.id>", "weight": 0.5 }, …] — weighted pick per call. Empty → agent_id.
  ADD COLUMN IF NOT EXISTS inbound_agents JSONB,
  ADD COLUMN IF NOT EXISTS outbound_agents JSONB,
  -- Called before an inbound call connects; may reject it, swap the agent or add dynamic variables.
  ADD COLUMN IF NOT EXISTS inbound_webhook_url TEXT,
  -- Dialled when no agent can take an inbound call (none assigned, or the voice engine failed).
  ADD COLUMN IF NOT EXISTS fallback_number TEXT,
  -- ISO 3166-1 alpha-2. Empty or null means no restriction.
  ADD COLUMN IF NOT EXISTS allowed_inbound_countries TEXT[],
  ADD COLUMN IF NOT EXISTS allowed_outbound_countries TEXT[];

COMMENT ON COLUMN public.phone_numbers.inbound_agents IS
  'Weighted inbound agents [{agent_id, weight}] (Retell A/B). Null/empty → agent_id answers.';
COMMENT ON COLUMN public.phone_numbers.outbound_agents IS
  'Weighted outbound agents [{agent_id, weight}]. Null/empty → agent_id places calls.';
COMMENT ON COLUMN public.phone_numbers.inbound_webhook_url IS
  'Retell-format inbound webhook (call_inbound). Can reject, override the agent, set dynamic variables.';
COMMENT ON COLUMN public.phone_numbers.fallback_number IS
  'E.164 number dialled when no agent can take an inbound call.';
