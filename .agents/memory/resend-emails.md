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
