import * as React from 'react'
import { render } from '@react-email/components'
import { createClient } from '@supabase/supabase-js'
import { TEMPLATES } from '@/lib/email-templates/registry'
import type { Database } from '@/integrations/supabase/types'

const SITE_NAME = 'webespokegenbuilder'
const SENDER_DOMAIN = 'notify.webespokeaibuilder.com'
const FROM_DOMAIN = 'webespokeaibuilder.com'

function generateToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

let _admin: ReturnType<typeof createClient<Database>> | null = null
function getAdmin() {
  if (!_admin) {
    _admin = createClient<Database>(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _admin
}

export interface EnqueueParams {
  templateName: string
  recipientEmail?: string
  idempotencyKey?: string
  templateData?: Record<string, any>
}

/**
 * Enqueue a transactional email from server-side code (no user JWT required).
 * Used by webhook handlers and other server-initiated triggers.
 */
export async function enqueueTransactionalEmail(params: EnqueueParams) {
  const supabase = getAdmin()
  const template = TEMPLATES[params.templateName]
  if (!template) {
    console.error('[email] template not found:', params.templateName)
    return { success: false, error: 'template_not_found' }
  }

  const effectiveRecipient = template.to || params.recipientEmail
  if (!effectiveRecipient) {
    return { success: false, error: 'recipient_required' }
  }

  const messageId = crypto.randomUUID()
  const idempotencyKey = params.idempotencyKey || messageId
  const templateData = params.templateData || {}
  const normalizedEmail = effectiveRecipient.toLowerCase()

  // Suppression check
  const { data: suppressed } = await supabase
    .from('suppressed_emails')
    .select('id')
    .eq('email', normalizedEmail)
    .maybeSingle()
  if (suppressed) {
    await supabase.from('email_send_log').insert({
      message_id: messageId,
      template_name: params.templateName,
      recipient_email: effectiveRecipient,
      status: 'suppressed',
    })
    return { success: false, reason: 'email_suppressed' }
  }

  // Unsubscribe token
  let unsubscribeToken: string
  const { data: existing } = await supabase
    .from('email_unsubscribe_tokens')
    .select('token, used_at')
    .eq('email', normalizedEmail)
    .maybeSingle()
  if (existing && !existing.used_at) {
    unsubscribeToken = existing.token
  } else if (!existing) {
    unsubscribeToken = generateToken()
    await supabase
      .from('email_unsubscribe_tokens')
      .upsert(
        { token: unsubscribeToken, email: normalizedEmail },
        { onConflict: 'email', ignoreDuplicates: true },
      )
    const { data: stored } = await supabase
      .from('email_unsubscribe_tokens')
      .select('token')
      .eq('email', normalizedEmail)
      .maybeSingle()
    if (stored) unsubscribeToken = stored.token
  } else {
    return { success: false, reason: 'email_suppressed' }
  }

  const element = React.createElement(template.component, templateData)
  const html = await render(element)
  const text = await render(element, { plainText: true })
  const subject =
    typeof template.subject === 'function'
      ? template.subject(templateData)
      : template.subject

  await supabase.from('email_send_log').insert({
    message_id: messageId,
    template_name: params.templateName,
    recipient_email: effectiveRecipient,
    status: 'pending',
  })

  const { error: enqueueError } = await supabase.rpc('enqueue_email', {
    queue_name: 'transactional_emails',
    payload: {
      message_id: messageId,
      to: effectiveRecipient,
      from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
      sender_domain: SENDER_DOMAIN,
      subject,
      html,
      text,
      purpose: 'transactional',
      label: params.templateName,
      idempotency_key: idempotencyKey,
      unsubscribe_token: unsubscribeToken!,
      queued_at: new Date().toISOString(),
    },
  })

  if (enqueueError) {
    console.error('[email] enqueue failed', enqueueError)
    await supabase.from('email_send_log').insert({
      message_id: messageId,
      template_name: params.templateName,
      recipient_email: effectiveRecipient,
      status: 'failed',
      error_message: 'Failed to enqueue email',
    })
    return { success: false, error: 'enqueue_failed' }
  }

  return { success: true }
}
