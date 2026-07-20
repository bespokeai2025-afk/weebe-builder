/**
 * WEBEE Webhook Delivery Engine
 *
 * Delivers outbound webhooks to customer-configured URLs.
 * Signs payloads with X-WEBEE-Signature (HMAC-SHA256).
 * Retries failed deliveries with exponential backoff.
 */
import { createClient } from "@supabase/supabase-js";
import { createHmac } from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const RETRY_DELAYS_SECONDS = [30, 120, 600, 3600]; // 30s, 2m, 10m, 1h

export type WebhookEventType =
  | "lead.created"   | "lead.updated"
  | "call.started"   | "call.completed"  | "call.failed"
  | "booking.created"
  | "campaign.completed"
  | "document.uploaded"
  | "agent.deployed";

function adminSb() {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Fire a webhook event for a workspace.
 * Finds all active subscriptions for the event type and delivers them.
 */
export async function fireWebhookEvent(
  workspaceId: string,
  eventType: WebhookEventType,
  data: Record<string, unknown>,
) {
  const sb = adminSb();

  const { data: hooks } = await sb
    .from("workspace_webhooks")
    .select("id, target_url, secret")
    .eq("workspace_id", workspaceId)
    .eq("event_type", eventType)
    .eq("active", true);

  if (!hooks?.length) return;

  const payload = JSON.stringify({
    event:       eventType,
    workspace_id: workspaceId,
    timestamp:   new Date().toISOString(),
    data,
  });

  await Promise.all(hooks.map(hook => deliverWebhook(sb, workspaceId, hook, eventType, payload)));
}

async function deliverWebhook(
  sb: ReturnType<typeof adminSb>,
  workspaceId: string,
  hook: { id: string; target_url: string; secret: string },
  eventType: string,
  payload: string,
) {
  const signature = signPayload(payload, hook.secret);

  // Create delivery record
  const { data: delivery } = await sb
    .from("webhook_deliveries")
    .insert({
      workspace_id:  workspaceId,
      webhook_id:    hook.id,
      event_type:    eventType,
      payload:       JSON.parse(payload),
      status:        "pending",
      attempt_count: 0,
    })
    .select("id")
    .single();

  if (!delivery) return;

  await attemptDelivery(sb, delivery.id, hook.target_url, payload, signature, 0);
}

async function attemptDelivery(
  sb: ReturnType<typeof adminSb>,
  deliveryId: string,
  targetUrl: string,
  payload: string,
  signature: string,
  attemptNumber: number,
) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);

    const res = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type":        "application/json",
        "X-WEBEE-Signature":   `sha256=${signature}`,
        "X-WEBEE-Delivery-Id": deliveryId,
        "User-Agent":          "WEBEE-Webhooks/1.0",
      },
      body:   payload,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const responseText = await res.text().catch(() => "");
    const success = res.status >= 200 && res.status < 300;

    if (success) {
      await sb.from("webhook_deliveries").update({
        status:        "delivered",
        response_code: res.status,
        response_body: responseText.slice(0, 500),
        attempt_count: attemptNumber + 1,
        delivered_at:  new Date().toISOString(),
      }).eq("id", deliveryId);
    } else {
      await scheduleRetry(sb, deliveryId, targetUrl, payload, signature, attemptNumber, res.status, responseText);
    }
  } catch (e: any) {
    await scheduleRetry(sb, deliveryId, targetUrl, payload, signature, attemptNumber, 0, e?.message ?? "Network error");
  }
}

async function scheduleRetry(
  sb: ReturnType<typeof adminSb>,
  deliveryId: string,
  targetUrl: string,
  payload: string,
  signature: string,
  attemptNumber: number,
  responseCode: number,
  responseBody: string,
) {
  const nextAttempt = attemptNumber + 1;
  const hasMoreRetries = nextAttempt < RETRY_DELAYS_SECONDS.length;
  const nextRetryAt = hasMoreRetries
    ? new Date(Date.now() + RETRY_DELAYS_SECONDS[nextAttempt] * 1000).toISOString()
    : null;

  await sb.from("webhook_deliveries").update({
    status:        hasMoreRetries ? "retrying" : "failed",
    response_code: responseCode,
    response_body: (responseBody ?? "").slice(0, 500),
    attempt_count: nextAttempt,
    next_retry_at: nextRetryAt,
  }).eq("id", deliveryId);

  if (hasMoreRetries && nextRetryAt) {
    setTimeout(
      () => attemptDelivery(sb, deliveryId, targetUrl, payload, signature, nextAttempt),
      RETRY_DELAYS_SECONDS[nextAttempt] * 1000,
    );
  }
}

/**
 * Retry all pending/retrying deliveries that are due.
 * Call from the campaign-executor cron or a dedicated tick.
 */
export async function retryPendingDeliveries(): Promise<{ retried: number; failed: number }> {
  const sb = adminSb();
  const now = new Date().toISOString();

  const { data: due } = await sb
    .from("webhook_deliveries")
    .select("id, webhook_id, event_type, payload, attempt_count")
    .in("status", ["pending", "retrying"])
    .lte("next_retry_at", now)
    .limit(50);

  if (!due?.length) return { retried: 0, failed: 0 };

  let retried = 0; let failed = 0;
  for (const d of due) {
    const { data: hook } = await sb
      .from("workspace_webhooks")
      .select("target_url, secret, workspace_id")
      .eq("id", d.webhook_id)
      .maybeSingle();

    if (!hook) { failed++; continue; }

    const payloadStr = JSON.stringify(d.payload);
    const signature  = signPayload(payloadStr, hook.secret);
    await attemptDelivery(sb, d.id, hook.target_url, payloadStr, signature, d.attempt_count);
    retried++;
  }

  return { retried, failed };
}
