import { randomBytes } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const CAL_BASE = "https://api.cal.com/v2";
const TRIGGERS = ["BOOKING_CREATED", "BOOKING_RESCHEDULED", "BOOKING_CANCELLED"] as const;

export interface CalcomWebhookResult {
  ok: boolean;
  message: string;
  subscriberUrl: string;
  webhookId?: string | number;
  created: boolean;
  warnings: string[];
}

async function calFetch(
  path: string,
  apiKey: string,
  init: RequestInit = {},
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${CAL_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "cal-api-version": "2024-08-13",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* keep text */
  }
  return { status: res.status, body };
}

export async function registerCalcomWebhook(args: {
  workspaceId: string;
  subscriberUrl: string;
}): Promise<CalcomWebhookResult> {
  const warnings: string[] = [];
  const result: CalcomWebhookResult = {
    ok: false,
    message: "",
    subscriberUrl: args.subscriberUrl,
    created: false,
    warnings,
  };

  const { data: settings } = await supabaseAdmin
    .from("workspace_settings")
    .select("calcom_api_key, calcom_webhook_secret")
    .eq("workspace_id", args.workspaceId)
    .maybeSingle();

  const apiKey = (settings?.calcom_api_key as string | null)?.trim();
  if (!apiKey) {
    result.message = "Cal.com API token not set — skipping webhook registration.";
    warnings.push(result.message);
    return result;
  }

  let secret = (settings?.calcom_webhook_secret as string | null)?.trim() || "";
  if (!secret) {
    secret = `whsec_${randomBytes(24).toString("hex")}`;
    await supabaseAdmin
      .from("workspace_settings")
      .update({ calcom_webhook_secret: secret } as never)
      .eq("workspace_id", args.workspaceId);
  }

  try {
    const list = await calFetch("/webhooks", apiKey, { method: "GET" });
    if (list.status >= 200 && list.status < 300) {
      const items = (list.body as { data?: Array<Record<string, unknown>> })?.data ?? [];
      const existing = items.find((w) => String(w.subscriberUrl ?? "") === args.subscriberUrl);
      if (existing) {
        result.ok = true;
        result.created = false;
        result.webhookId = existing.id as string | number | undefined;
        result.message = "Cal.com webhook already registered.";
        return result;
      }
    } else if (list.status === 401 || list.status === 403) {
      result.message = `Cal.com auth failed (HTTP ${list.status}). Check the API token.`;
      warnings.push(result.message);
      return result;
    }
  } catch (e) {
    warnings.push(`Could not list Cal.com webhooks: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    const create = await calFetch("/webhooks", apiKey, {
      method: "POST",
      body: JSON.stringify({
        subscriberUrl: args.subscriberUrl,
        triggers: TRIGGERS,
        active: true,
        secret,
        payloadTemplate: null,
      }),
    });
    if (create.status >= 200 && create.status < 300) {
      const id =
        (create.body as { data?: { id?: string | number } })?.data?.id ??
        (create.body as { id?: string | number })?.id;
      result.ok = true;
      result.created = true;
      result.webhookId = id;
      result.message = "Cal.com webhook registered.";
      return result;
    }
    const msg = (create.body as { message?: string })?.message ?? `HTTP ${create.status}`;
    result.message = `Cal.com webhook create failed: ${msg}`;
    warnings.push(result.message);
    return result;
  } catch (e) {
    result.message = `Cal.com webhook create errored: ${e instanceof Error ? e.message : String(e)}`;
    warnings.push(result.message);
    return result;
  }
}
