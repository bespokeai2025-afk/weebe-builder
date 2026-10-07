-- Twilio reseller model: one Twilio Subaccount per workspace, provisioned by
-- WEBEE under its own master Twilio account (WEBEE-UIUX-AUDIT.md Twilio
-- reseller initiative). This is the counterpart to the old BYOK columns on
-- workspace_settings (twilio_account_sid/twilio_auth_token) — those are left
-- untouched (WhatsApp-via-Twilio still reads them independently); this table
-- is the new, voice-only, WEBEE-managed credential store.
--
-- Locked down to service_role only: this row holds a live secret capable of
-- spending real money via the Twilio API, so no workspace member — not even
-- an admin — should be able to read or write it directly. It is only ever
-- touched by resolveOrCreateWorkspaceSubaccount (server-side).

CREATE TABLE IF NOT EXISTS public.workspace_twilio_subaccounts (
  workspace_id                  UUID PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  twilio_subaccount_sid         TEXT NOT NULL,
  twilio_subaccount_auth_token  TEXT NOT NULL,
  status                        TEXT NOT NULL DEFAULT 'active',
  friendly_name                 TEXT,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_twilio_subaccounts_status_ck') THEN
    ALTER TABLE public.workspace_twilio_subaccounts
      ADD CONSTRAINT workspace_twilio_subaccounts_status_ck
      CHECK (status IN ('active', 'suspended', 'closed'));
  END IF;
END $$;

ALTER TABLE public.workspace_twilio_subaccounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_twilio_subaccounts FROM authenticated;

COMMENT ON TABLE public.workspace_twilio_subaccounts IS
  'Twilio Subaccount credentials WEBEE provisions per workspace under its own master account. Service-role-only — never exposed to workspace users. See src/lib/telephony/twilio-credentials.server.ts.';
