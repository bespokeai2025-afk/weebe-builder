/**
 * Register / verify WATI inbound webhooks.
 * Manual setup in WATI Connectors → Webhooks is always valid — auto-register is best-effort.
 */

import { watiApiRoot, watiApiV1Base, watiApiV2Base, watiApiV3Base } from "@/lib/whatsapp/wati-api-base.shared";

type WatiConn = {
  tenantId: string;
  apiKey: string;
  apiHost?: string | null;
};

/** Events for WATI Connectors UI / v2 registration (no _v2 suffix on some tenants). */
const WATI_WEBHOOK_REGISTER_EVENT_TYPES = [
  "message",
  "newContactMessageReceived",
  "sentMessageDELIVERED",
  "sentMessageREAD",
  "sentMessageREPLIED",
  "templateMessageSent",
  "templateReviewed",
  "templateQualityUpdated",
];

/** Minimal set when full registration returns HTTP 400. */
const WATI_WEBHOOK_MINIMAL_EVENT_TYPES = [
  "message",
  "newContactMessageReceived",
  "sentMessageREPLIED",
  "templateMessageSent",
  "sentMessageDELIVERED",
  "sentMessageREAD",
];

function authHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey.replace(/^Bearer\s+/i, "")}`,
    "Content-Type": "application/json",
  };
}

async function parseJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { raw: text.slice(0, 400) };
  }
}

/** Collect WhatsApp numbers for v2 webhook registration. */
export async function fetchWatiChannelPhones(conn: WatiConn): Promise<string[]> {
  const headers = authHeaders(conn.apiKey);
  const phones = new Set<string>();

  const addPhone = (raw: unknown) => {
    const s = String(raw ?? "").trim();
    if (!s) return;
    phones.add(s);
    const digits = s.replace(/\D/g, "");
    if (digits.length >= 8) phones.add(digits);
  };

  try {
    const v2 = await fetch(`${watiApiV2Base(conn.tenantId, conn.apiHost)}/whatsapp/phoneNumbers`, {
      headers,
    });
    if (v2.ok) {
      const json = await parseJson(v2);
      const rows = (json.result ?? json.phoneNumbers ?? json.data ?? []) as Array<Record<string, unknown>>;
      for (const row of rows) {
        addPhone(row.phoneNumber ?? row.displayPhoneNumber ?? row.number ?? row.phone);
      }
    }
  } catch {
    /* optional */
  }

  try {
    const v3 = await fetch(`${watiApiV3Base(conn.tenantId, conn.apiHost)}/channels`, { headers });
    if (v3.ok) {
      const json = await parseJson(v3);
      const rows = (json.channels ?? json.result ?? []) as Array<Record<string, unknown>>;
      for (const row of rows) {
        addPhone(row.phone_number ?? row.phoneNumber ?? row.channelPhoneNumber);
      }
    }
  } catch {
    /* optional */
  }

  try {
    const v1 = await fetch(`${watiApiV1Base(conn.tenantId, conn.apiHost)}/getContacts?pageSize=1`, { headers });
    if (v1.ok) {
      const json = await parseJson(v1);
      const rows = (json.contact_list ?? json.contacts ?? []) as Array<Record<string, unknown>>;
      for (const row of rows) {
        addPhone(row.wAid ?? row.phone);
      }
    }
  } catch {
    /* optional */
  }

  return [...phones];
}

async function postV2WebhookEndpoints(
  conn: WatiConn,
  payload: Array<Record<string, unknown>>,
): Promise<{ ok: boolean; status: number; body?: Record<string, unknown> }> {
  const res = await fetch(`${watiApiV2Base(conn.tenantId, conn.apiHost)}/webhookEndpoints`, {
    method: "POST",
    headers: authHeaders(conn.apiKey),
    body: JSON.stringify(payload),
  });
  const body = await parseJson(res);
  return { ok: res.ok, status: res.status, body };
}

async function registerViaV2WebhookEndpoints(
  conn: WatiConn,
  webhookUrl: string,
  eventTypes: string[],
): Promise<{ ok: boolean; status: number }> {
  const phones = await fetchWatiChannelPhones(conn);
  const attempts: Array<Array<Record<string, unknown>>> = [];

  if (phones.length > 0) {
    attempts.push(
      phones.map((phoneNumber) => ({
        phoneNumber,
        status: 1,
        url: webhookUrl,
        eventTypes,
      })),
    );
  }

  // Some tenants reject multi-phone batch — try first channel only.
  if (phones.length > 1) {
    attempts.push([
      {
        phoneNumber: phones[0],
        status: 1,
        url: webhookUrl,
        eventTypes,
      },
    ]);
  }

  for (const payload of attempts) {
    const res = await postV2WebhookEndpoints(conn, payload);
    if (res.ok) return { ok: true, status: res.status };
    if (res.status !== 400) return { ok: false, status: res.status };
  }

  return { ok: false, status: 400 };
}

async function registerViaV1UpdateWebhook(
  conn: WatiConn,
  webhookUrl: string,
): Promise<{ ok: boolean; status: number }> {
  const res = await fetch(`${watiApiV1Base(conn.tenantId, conn.apiHost)}/updateWebhook`, {
    method: "POST",
    headers: authHeaders(conn.apiKey),
    body: JSON.stringify({ webhookUrl }),
  });
  return { ok: res.ok, status: res.status };
}

export type WatiWebhookRegisterResult = {
  webhookRegistered: boolean;
  webhookManual: boolean;
  webhookNote: string;
};

/**
 * Best-effort auto-register. WATI EU tenants often require manual Connectors → Webhooks setup;
 * a 404 on legacy updateWebhook does NOT mean your manual webhook is broken.
 */
export async function registerWatiInboundWebhook(
  conn: WatiConn,
  webhookUrl: string,
  opts?: { manualAlreadyConfigured?: boolean },
): Promise<WatiWebhookRegisterResult> {
  if (opts?.manualAlreadyConfigured) {
    return {
      webhookRegistered: true,
      webhookManual: true,
      webhookNote:
        "Webhook configured manually in WATI Connectors → Webhooks. Inbound events will flow to Webee.",
    };
  }

  try {
    const eventSets = [WATI_WEBHOOK_REGISTER_EVENT_TYPES, WATI_WEBHOOK_MINIMAL_EVENT_TYPES];
    for (const eventTypes of eventSets) {
      const v2 = await registerViaV2WebhookEndpoints(conn, webhookUrl, eventTypes);
      if (v2.ok) {
        return {
          webhookRegistered: true,
          webhookManual: false,
          webhookNote: "Webhook registered automatically in WATI via API.",
        };
      }
      if (v2.status !== 400) break;
    }

    const v1 = await registerViaV1UpdateWebhook(conn, webhookUrl);
    if (v1.ok) {
      return {
        webhookRegistered: true,
        webhookManual: false,
        webhookNote: "Webhook registered automatically in WATI.",
      };
    }

    const code = v1.status || 400;
    console.warn("[wati-webhook] auto-register failed:", { v1: v1.status, host: conn.apiHost });

    return {
      webhookRegistered: false,
      webhookManual: false,
      webhookNote:
        code === 404
          ? "Auto-registration API is not available on this WATI account (404). Add the webhook URL in WATI Connectors → Webhooks, then click “Confirm manual setup”."
          : `Auto-registration failed (HTTP ${code}) — common on EU WATI accounts. Paste the URL below in WATI Connectors → Webhooks (enable Message received + Sent Message is REPLIED), then click “Confirm manual setup”.`,
    };
  } catch (e) {
    console.error("[wati-webhook] register error", e);
    return {
      webhookRegistered: false,
      webhookManual: false,
      webhookNote:
        "Auto-registration unavailable. If the webhook URL is already in WATI Connectors → Webhooks, click “Confirm manual setup”.",
    };
  }
}

export function buildWatiInboundWebhookUrl(workspaceId: string, origin?: string): string {
  const base = (
    origin?.trim() ||
    process.env.PUBLIC_APP_URL?.trim() ||
    process.env.VITE_PUBLIC_APP_URL?.trim() ||
    (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "") ||
    "https://webeereceptionist.com"
  ).replace(/\/$/, "");
  return `${base}/api/webhook/wati-inbound?workspace=${workspaceId}`;
}
