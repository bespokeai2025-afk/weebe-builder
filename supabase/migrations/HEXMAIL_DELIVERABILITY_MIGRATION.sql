-- ──────────────────────────────────────────────────────────────────────────────
-- HexMail Deliverability & Domain Warming System
-- Apply in Supabase SQL Editor: https://app.supabase.com → SQL Editor
-- ──────────────────────────────────────────────────────────────────────────────

-- 1. Sender Domains ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_sender_domains (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id            UUID NOT NULL,
  domain                  TEXT NOT NULL,
  provider                TEXT NOT NULL DEFAULT 'resend',   -- resend | sendgrid | postmark
  status                  TEXT NOT NULL DEFAULT 'pending',  -- pending | active | paused | suspended
  dkim_selector           TEXT,
  spf_status              TEXT NOT NULL DEFAULT 'unknown',  -- pass | fail | warning | missing | unknown
  dkim_status             TEXT NOT NULL DEFAULT 'unknown',
  dmarc_status            TEXT NOT NULL DEFAULT 'unknown',
  mx_status               TEXT NOT NULL DEFAULT 'unknown',
  tracking_domain_status  TEXT NOT NULL DEFAULT 'unknown',
  spf_record              TEXT,
  dkim_record             TEXT,
  dmarc_record            TEXT,
  mx_records              JSONB,
  dns_checked_at          TIMESTAMPTZ,
  verified_at             TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, domain)
);

-- 2. Mailboxes ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_mailboxes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL,
  domain_id         UUID REFERENCES email_sender_domains(id) ON DELETE CASCADE,
  email_address     TEXT NOT NULL,
  provider          TEXT NOT NULL DEFAULT 'resend',
  status            TEXT NOT NULL DEFAULT 'pending',         -- pending | warming | active | paused | suspended
  daily_send_limit  INTEGER NOT NULL DEFAULT 50,
  sends_today       INTEGER NOT NULL DEFAULT 0,
  warmup_stage      INTEGER NOT NULL DEFAULT 0,              -- 0 = not started, 1..10 = stages
  last_sent_at      TIMESTAMPTZ,
  last_reset_at     TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, email_address)
);

-- 3. Warmup Plans ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_warmup_plans (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id            UUID NOT NULL,
  domain_id               UUID REFERENCES email_sender_domains(id) ON DELETE CASCADE,
  mailbox_id              UUID REFERENCES email_mailboxes(id) ON DELETE CASCADE,
  name                    TEXT NOT NULL,
  start_date              DATE NOT NULL,
  current_day             INTEGER NOT NULL DEFAULT 0,
  starting_daily_volume   INTEGER NOT NULL DEFAULT 5,
  target_daily_volume     INTEGER NOT NULL DEFAULT 200,
  increment_type          TEXT NOT NULL DEFAULT 'weekly_double', -- weekly_double | weekly_fixed | daily_fixed
  increment_value         INTEGER NOT NULL DEFAULT 0,
  status                  TEXT NOT NULL DEFAULT 'active',     -- active | paused | completed | cancelled
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Daily Warmup Targets ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_warmup_daily_targets (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL,
  warmup_plan_id    UUID NOT NULL REFERENCES email_warmup_plans(id) ON DELETE CASCADE,
  day_number        INTEGER NOT NULL,
  target_send_count INTEGER NOT NULL DEFAULT 0,
  actual_send_count INTEGER NOT NULL DEFAULT 0,
  bounce_count      INTEGER NOT NULL DEFAULT 0,
  complaint_count   INTEGER NOT NULL DEFAULT 0,
  reply_count       INTEGER NOT NULL DEFAULT 0,
  open_count        INTEGER NOT NULL DEFAULT 0,
  click_count       INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'pending',          -- pending | in_progress | completed | skipped
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (warmup_plan_id, day_number)
);

-- 5. Reputation Events ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_reputation_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL,
  domain_id     UUID REFERENCES email_sender_domains(id) ON DELETE CASCADE,
  mailbox_id    UUID REFERENCES email_mailboxes(id) ON DELETE SET NULL,
  event_type    TEXT NOT NULL,   -- bounce | complaint | unsubscribe | delivery_failure | provider_error | dns_failure | spam_trap
  severity      TEXT NOT NULL DEFAULT 'info',  -- info | warning | critical
  description   TEXT,
  source        TEXT,            -- resend_webhook | manual | system_check
  metadata      JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Deliverability Checks ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_deliverability_checks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL,
  domain_id     UUID REFERENCES email_sender_domains(id) ON DELETE CASCADE,
  check_type    TEXT NOT NULL,   -- spf | dkim | dmarc | mx | tracking_domain | full
  status        TEXT NOT NULL,   -- pass | fail | warning | missing
  details       JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes ─────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_email_sender_domains_workspace ON email_sender_domains(workspace_id);
CREATE INDEX IF NOT EXISTS idx_email_mailboxes_workspace      ON email_mailboxes(workspace_id);
CREATE INDEX IF NOT EXISTS idx_email_mailboxes_domain         ON email_mailboxes(domain_id);
CREATE INDEX IF NOT EXISTS idx_email_warmup_plans_workspace   ON email_warmup_plans(workspace_id);
CREATE INDEX IF NOT EXISTS idx_email_warmup_plans_mailbox     ON email_warmup_plans(mailbox_id);
CREATE INDEX IF NOT EXISTS idx_email_warmup_daily_plan        ON email_warmup_daily_targets(warmup_plan_id);
CREATE INDEX IF NOT EXISTS idx_email_reputation_events_ws     ON email_reputation_events(workspace_id);
CREATE INDEX IF NOT EXISTS idx_email_reputation_events_domain ON email_reputation_events(domain_id);
CREATE INDEX IF NOT EXISTS idx_email_deliverability_checks_ws ON email_deliverability_checks(workspace_id);
