---
name: Resend transactional emails
description: How auto user-emails are sent; the direct-Resend decision and the verified-domain production constraint.
---

# Resend auto-emails (workspace approval/denial)

User-facing transactional emails go through a **direct Resend REST sender**
(`src/lib/email/resend.server.ts` → `POST https://api.resend.com/emails`), NOT
the legacy Lovable email queue (`src/routes/lovable/email/*`, `enqueueTransactionalEmail`).

**Why:** the user supplied a Resend key and wanted simple auto-emails; the Lovable
queue depends on `LOVABLE_SEND_URL`/`LOVABLE_API_KEY` infra that isn't theirs.

**How to apply / constraints:**
- Trigger lives in `decideWorkspaceRequest` (workspace.functions.ts): emails are
  best-effort, wrapped in try/catch, and must never block the approve/deny write.
- Any user-controlled value (workspace_name, full_name) inserted into email HTML
  MUST be passed through `escapeHtml` first (content-injection risk). Plain-text
  bodies use the raw value.
- **Production delivery requires a verified domain.** With no verified domain,
  Resend only delivers from `onboarding@resend.dev` to the Resend account's own
  email. For real users: verify a domain at resend.com/domains and set
  `RESEND_FROM` to an address on it. Optional `PUBLIC_SITE_URL` drives the CTA link.
- **Silent failure mode:** every caller wraps `sendResendEmail(...).catch(() => {})`
  (e.g. webform lead notifications), so a missing/unverified `RESEND_FROM` never
  surfaces as an app error — the lead/record is created fine, only the email is
  dropped by Resend. This presents to the user as "webforms aren't working" even
  though capture is 100% functional; always check `RESEND_FROM` + `GET
  api.resend.com/domains` (verified status) before assuming a capture-pipeline bug.
- **Replit dev env vars do NOT reach the AWS EC2 production app.** Production
  (`webeereceptionist.com`) runs on EC2 via systemd + `EnvironmentFile=.env` on the
  server (see `deploy/webespoke.service`, `DEPLOY_AWS.md`), entirely separate from
  this Repl's env vars/secrets. Setting `RESEND_FROM` (or any server env var) here
  only fixes the Replit dev instance — the fix must also be added to the EC2 host's
  `/var/www/html/webespoke/.env` and the `webespoke` systemd service restarted for
  it to reach real customer traffic.
