-- Cross-instance cache invalidation signals.
-- Server-write-only (service_role); authenticated/anon have no access.
CREATE TABLE IF NOT EXISTS platform_cache_signals (
  signal_key TEXT PRIMARY KEY,
  version    BIGINT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE platform_cache_signals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON platform_cache_signals FROM anon, authenticated;
