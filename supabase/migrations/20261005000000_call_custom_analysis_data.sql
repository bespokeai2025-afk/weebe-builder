-- Post-call data retrieval, stored on every call.
--
-- Custom post-call fields ("email_address", "callback_datetime", "calendly_slot", …) were
-- extracted after every call and returned as `call_analysis.custom_analysis_data` — exactly as
-- Retell does — but nothing ever saved them on the call. They were only read by workflow-specific
-- handlers (bookings, lead intelligence, qualification), several of which skip test calls, so a
-- builder test call showed the three built-ins and none of the fields the user had defined.
--
-- Retell keeps these on every call. This column does the same: general purpose, one row per call,
-- whatever fields the agent defines.

alter table public.calls
  add column if not exists custom_analysis_data jsonb;

comment on column public.calls.custom_analysis_data is
  'Custom post-call analysis fields for this call, keyed by field name (Retell call_analysis.custom_analysis_data).';

notify pgrst, 'reload schema';
