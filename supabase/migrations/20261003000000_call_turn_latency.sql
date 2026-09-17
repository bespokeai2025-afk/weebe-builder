-- Per-turn voice latency, and a marker for test calls.
--
-- CallTurnTrace already records 28 fine-grained marks per turn — stt_final,
-- llm_speech_first_token, tts_first_audio, speech→audio — and then only
-- console.logs them. Nothing reaches the database, so there is no latency
-- baseline, no way to compare against Retell, and no way to notice a
-- regression after a voice change. That is what this table fixes.
--
-- One row per assistant turn. Every duration is milliseconds, and nullable:
-- a turn that ended early (barge-in, cancelled response) legitimately has no
-- first-audio mark, and a null must stay distinguishable from a zero.

alter table public.calls
  add column if not exists is_test_call boolean not null default false;

comment on column public.calls.is_test_call is
  'True for calls placed from the builder/test-call surface rather than real traffic. Keeps test latency out of production percentiles.';

create index if not exists calls_test_call_idx
  on public.calls (workspace_id, is_test_call, started_at desc)
  where is_test_call;

create table if not exists public.call_turns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  -- Provider call id (calls.retell_call_id), not calls.id: turns are written
  -- from the live gateway, which knows the provider id and may run before the
  -- calls row exists.
  call_id text not null,
  turn_index integer not null,

  -- ── The headline number: caller stopped talking → caller hears audio ──────
  speech_to_first_audio_ms integer,

  -- ── Stage breakdown, so a regression points at a stage ───────────────────
  endpoint_to_stt_final_ms  integer,
  stt_to_route_ms           integer,
  stt_to_node_loaded_ms     integer,
  stt_to_first_token_ms     integer,
  stt_to_first_sentence_ms  integer,
  stt_to_first_audio_ms     integer,

  -- ── Which path the turn took (answers "how often do we pay for an LLM
  --    classify?" and "is speculation actually paying for itself?") ─────────
  edge_route_method   text,
  global_route_method text,
  speculative_hit     boolean,
  partial_commit      boolean,
  interrupted         boolean,

  -- ── Endpointing decision, so semantic endpointing can be evaluated ───────
  -- hangover_ms is the silence window actually used for this turn, and
  -- held_for_incomplete records whether it was extended because the partial
  -- looked mid-thought. Together they show whether the adaptive window is
  -- buying speed on complete answers without clipping unfinished ones.
  hangover_ms          integer,
  held_for_incomplete  boolean,

  -- ── Context for slicing ──────────────────────────────────────────────────
  node_id    text,
  engine     text,
  agent_id   text,
  is_test_call boolean not null default false,

  created_at timestamptz not null default now()
);

comment on table public.call_turns is
  'One row per assistant turn with latency marks and the routing path taken. Written fire-and-forget from the voice gateway; never on the critical path of a call.';
comment on column public.call_turns.speech_to_first_audio_ms is
  'Caller stopped speaking → first TTS audio byte out. The number to compare against Retell.';
comment on column public.call_turns.edge_route_method is
  'unconditional | equation | equation_else | generic_single | heuristic | llm | none — "llm" means a full model round trip sat on the critical path.';

create unique index if not exists call_turns_call_turn_uidx
  on public.call_turns (call_id, turn_index);
create index if not exists call_turns_workspace_created_idx
  on public.call_turns (workspace_id, created_at desc);
-- Percentile queries scan by workspace and filter out nulls and test traffic.
create index if not exists call_turns_latency_idx
  on public.call_turns (workspace_id, is_test_call, speech_to_first_audio_ms)
  where speech_to_first_audio_ms is not null;

alter table public.call_turns enable row level security;
drop policy if exists "call_turns_members_read" on public.call_turns;
create policy "call_turns_members_read"
  on public.call_turns for select to authenticated
  using (exists (select 1 from public.workspace_members m
                 where m.workspace_id = call_turns.workspace_id
                   and m.user_id = auth.uid()));
revoke insert, update, delete on public.call_turns from authenticated, anon;
grant all on public.call_turns to service_role;
