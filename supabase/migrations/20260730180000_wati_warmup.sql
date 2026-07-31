-- WATI WhatsApp number warm-up — daily send caps to avoid Meta blocks
alter table wati_connections
  add column if not exists warmup_config jsonb not null default '{}'::jsonb;

comment on column wati_connections.warmup_config is
  'WhatsApp warm-up: enabled, startedAt, startingDaily, dailyIncrement, targetDaily, channelPhone, paused';
