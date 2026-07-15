---
name: Workspace email provider dispatch
description: Custom per-workspace Resend provider layer — priority chain, encryption, failure semantics, what stays on the platform sender.
---

# Workspace email provider dispatch (feature: custom_email_provider)

All workspace-scoped automated email goes through `sendWorkspaceEmail(sb, {workspaceId, to, subject, html})` in `src/lib/email/email-dispatch.server.ts` — never call `sendResendEmail` directly for workspace email.

**Priority chain:** workspace's own active custom provider → reseller parent's provider (only when `workspace_relationships` active AND `reseller_client_accounts.branding_mode = 'inherit'`) → WEBEE platform env sender.

**Rules / traps:**
- `workspace_email_provider_settings` is server-only: RLS on with ZERO policies + REVOKE from authenticated/anon. All access via supabaseAdmin. Never expose `encrypted_config` through a server fn — UI gets only a masked last-4 hint.
- Credentials encrypted with AES-256-CBC keyed on sha256(SUPABASE_SERVICE_ROLE_KEY) (same scheme as systemmind client-api-connections). Empty new key on save = keep stored key.
- `sendWorkspaceEmail` NEVER throws. Custom failure → recorded on the row (`consecutive_failures`, `last_send_*` with provider-code errors only, no response bodies) → optional platform fallback. At exactly 3 consecutive failures an in-app critical alert goes to owner+admins (deduped by only firing on the crossing). Saving settings resets the counter.
- The dispatch file is imported by notification-engine.shared.ts which runs inside the campaign-executor Vite plugin — keep its imports RELATIVE + node builtins only.
- Platform-level sends (ava OTP, ava-call admin mail, Talk-to-Us fallback) intentionally stay on `sendResendEmail`.
- lead-email sender order: hexmail creds → workspace custom provider → platform env.

**Why:** resellers need child emails from their own domain; failures must not break invites/notifications; keys must never leak client-side.

**E2E:** `tests/e2e/email-provider-dispatch.e2e.test.ts` (bogus key + fallback disabled = no real emails).
