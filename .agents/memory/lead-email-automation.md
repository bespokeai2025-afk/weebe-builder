---
name: Lead email automation (compose/template/auto-send)
description: Shared "send email to a lead" path used by leads UI and the webform auto-email trigger; sender resolution and preferred_contact convention.
---

- Sender resolution reuses the existing HexMail Resend-fallback pattern: per-workspace
  `workspace_settings.hexmail_resend_*` creds first, then `RESEND_API_KEY`/`RESEND_FROM` env
  vars. Deliberately did NOT build a separate provider/Outlook adapter for this — kept it
  Resend-only for now, consistent with `deliverability.server.ts`.
  **Why:** avoids a second parallel sending path; Outlook OAuth was explicitly deferred pending
  a user decision on Azure/Entra app credentials.
  **How to apply:** any future "send email as this workspace" feature should call through
  `sendEmailToLeadCore`/`sendTemplateEmailToLeadCore` in `lead-email.server.ts` rather than
  hand-rolling another Resend call.

- `leads.preferred_contact` is NOT a column — it only ever gets set into
  `leads.meta.preferred_contact` at lead **creation** time in `webforms.server.ts`, sourced from
  `raw.preferred_contact_method ?? raw.preferred_contact`. It is never updated afterward.
  **Why:** webform payloads use `preferred_contact_method` as the field name; the lead-creation
  code and any automation gating on this value must check the same two keys, in the same order,
  and fall back to `lead.preferred_contact_method`/`lead.meta.preferred_contact_method` too when
  reading it back off a lead row (UI badge logic does this).
  **How to apply:** gate any "prefers email" automation/UI on this exact fallback chain, and only
  fire creation-time automations off the raw webform payload, not a later `leads` table update.

- `lead_email_log` has a partial unique index (`lead_id` WHERE `trigger='auto_new_lead' AND
  status='sent'`) so at most one automated send can succeed per lead — manual sends are
  unrestricted. The webform hook additionally gates on `leadStatus === "created"` so re-submits
  from an existing lead never re-trigger it.
