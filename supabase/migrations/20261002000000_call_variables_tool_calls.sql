-- Call visibility: persist collected dynamic variables and tool-call history.
--
-- Both providers already produce this data and both currently drop it:
--   * Retell sends `collected_dynamic_variables` (live Extract Variable node
--     output) and `tool_calls` in the call_analyzed webhook, but the calls
--     table had nowhere to put them.
--   * Webee Native computes variables in the graph VM and emits tool_call
--     directives, but only console.logged the tool calls.
--
-- Storing them makes the call-detail Variables/Tools panel work for both,
-- and makes post-hoc debugging possible without replaying a webhook payload.

alter table public.calls
  add column if not exists collected_variables jsonb,
  add column if not exists tool_calls jsonb;

comment on column public.calls.collected_variables is
  'Dynamic variables captured during the call (merged setup + in-call collected). Provider-neutral.';
comment on column public.calls.tool_calls is
  'Tool/function invocations during the call: [{name, type, success, latency_ms, tool_call_id, start_time_sec}].';
