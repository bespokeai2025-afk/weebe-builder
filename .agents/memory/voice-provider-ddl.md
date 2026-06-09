---
name: Voice provider & Supabase DDL constraint
description: How voice_provider is stored and why DDL migrations can't run from the Replit sandbox against the Supabase project.
---

# Voice provider storage & DDL migration constraint

## Rule
`voice_provider` is stored in `agents.settings.voiceProvider` (JSONB field), not as a separate column, because DDL cannot be executed against the Supabase project from within the Replit sandbox.

**Why:** The Replit sandbox blocks outbound connections to `db.[ref].supabase.co` (DNS ENOTFOUND) and the Supabase pooler rejects service-role-key-as-password. The Supabase JS client only runs DML through PostgREST; there is no `exec_sql` RPC defined in this project.

**How to apply:** When the Supabase CLI is available, run:
```
supabase db push
```
The migration file `supabase/migrations/20260609_voice_provider.sql` is already written and idempotent. After it is applied, `voice_provider` can be read from the DB column instead of `settings.voiceProvider`.

## Twilio credentials pattern
- `TWILIO_ACCOUNT_SID` — always comes from `process.env.TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN` — comes from `workspace_settings.twilio_auth_token` (already a column) with `process.env.TWILIO_AUTH_TOKEN` as fallback
- `OPENAI_REALTIME_INBOUND_URL` — comes from `process.env.OPENAI_REALTIME_INBOUND_URL`; once migration is applied, also readable from `workspace_settings.openai_realtime_inbound_url`
