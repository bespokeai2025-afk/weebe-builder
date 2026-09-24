-- Auto Dialer: remembered defaults for the single-person "call now" action.
--
-- The phone-icon quick call beside a lead has no dial-list form to type the 2
-- route numbers into every time, so it needs somewhere to remember the last
-- ones used per workspace.

ALTER TABLE public.workspace_settings
  ADD COLUMN IF NOT EXISTS dialer_default_route_numbers jsonb,
  ADD COLUMN IF NOT EXISTS dialer_default_from_number   text;
