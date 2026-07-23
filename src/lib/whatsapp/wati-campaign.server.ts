/**
 * Shared WATI campaign helpers — used by server functions and inbound webhook.
 */

export type CampaignAudienceFilter = {
  qualification_status?: string;
  pipeline_stage?: string;
  status?: string;
  whatsapp_opt_in_only?: boolean;
  lead_ids?: string[];
};

import {
  watiApiRoot,
  watiApiV3Base,
} from "@/lib/whatsapp/wati-api-base.shared";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type WatiConnectionRow = {
  api_key: string;
  tenant_id: string;
  workspace_id: string;
  api_host: string | null;
};

export function digitsOnly(phone: string | null | undefined): string {
  return String(phone ?? "").replace(/\D/g, "");
}

/** Normalize to digits-only for storage/compare (keeps country code when present). */
export function normalizeWhatsAppPhone(phone: string | null | undefined): string {
  const d = digitsOnly(phone);
  return d || String(phone ?? "").trim();
}

/** Last 10 digits — common match key for UK/mobile tails. */
export function phoneTail(phone: string | null | undefined): string | null {
  const d = digitsOnly(phone);
  return d.length >= 10 ? d.slice(-10) : null;
}

export function buildWatiTemplateParams(
  lead: Record<string, unknown>,
  mapping: Record<string, string> | null | undefined,
): Array<{ name: string; value: string }> {
  if (!mapping || typeof mapping !== "object") return [];
  return Object.entries(mapping)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([paramKey, fieldKey]) => {
      const raw = fieldKey.startsWith("meta.")
        ? (lead.meta as Record<string, unknown> | null)?.[fieldKey.slice(5)]
        : lead[fieldKey];
      const value =
        raw == null || raw === ""
          ? ""
          : typeof raw === "string"
            ? raw
            : String(raw);
      return { name: paramKey, value };
    });
}

export async function getWatiConnectionForWorkspace(
  _sb: { from: (t: string) => any },
  workspaceId: string,
): Promise<WatiConnectionRow | null> {
  // wati_connections has RLS and stores secrets — always read via service role
  // (user-scoped clients cannot see rows even when status is connected).
  const { data } = await (supabaseAdmin as any)
    .from("wati_connections")
    .select("api_key, tenant_id, workspace_id, api_host")
    .eq("workspace_id", workspaceId)
    .eq("status", "connected")
    .maybeSingle();
  if (!data?.api_key || !data?.tenant_id) return null;
  return data as WatiConnectionRow;
}

/** WATI V3 allows up to 10,000 recipients per request — use smaller chunks for rate limits. */
export const WATI_V3_SEND_CHUNK_SIZE = 500;

export type WatiTemplateSendItem = {
  phone: string;
  parameters: Array<{ name: string; value: string }>;
  leadId?: string;
  contactName?: string | null;
  bodyPreview?: string;
};

export type WatiTemplateSendResult = {
  phone: string;
  leadId?: string;
  ok: boolean;
  messageId?: string;
  error?: string;
};

function watiAuthHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey.replace(/^Bearer\s+/i, "")}`,
    "Content-Type": "application/json",
  };
}

function parseV1SendResponse(
  data: Record<string, unknown>,
  text: string,
  resOk: boolean,
  fallbackLocalMessageId?: string,
): { ok: boolean; messageId?: string; error?: string } {
  const receivers = data.receivers as Array<{ localMessageId?: string; errors?: unknown[] }> | undefined;
  const receiverErrors = receivers?.flatMap((r) => r.errors ?? []) ?? [];
  const resultFlag = data.result;
  if (resOk && resultFlag === false) {
    const info = data.info ?? data.error ?? data.message;
    let err = info ? String(info) : text.slice(0, 300);
    if (data.validWhatsAppNumber === false) {
      err += " (not a valid WhatsApp number — check country code and that the number uses WhatsApp)";
    }
    return { ok: false, error: err.slice(0, 400) };
  }
  if (resOk && receiverErrors.length > 0) {
    return { ok: false, error: JSON.stringify(receiverErrors).slice(0, 300) };
  }
  if (!resOk) {
    return { ok: false, error: text.slice(0, 300) || "HTTP error" };
  }
  const messageId = String(
    receivers?.[0]?.localMessageId ??
      (data as { id?: string; messageId?: string }).id ??
      (data as { messageId?: string }).messageId ??
      fallbackLocalMessageId ??
      "",
  );
  if (!messageId) {
    return { ok: false, error: "WATI send succeeded but returned no message id" };
  }
  return { ok: true, messageId };
}

/** V3 batch send — POST /api/ext/v3/messageTemplates/send (docs.wati.io) */
async function postWatiTemplateSendV3(opts: {
  tenantId: string;
  apiKey: string;
  apiHost?: string | null;
  templateName: string;
  broadcastName: string;
  channel?: string | null;
  recipients: Array<{
    phone: string;
    parameters: Array<{ name: string; value: string }>;
    localMessageId?: string;
  }>;
}): Promise<{ ok: boolean; status: number; data: Record<string, unknown>; text: string }> {
  const url = `${watiApiV3Base(opts.tenantId, opts.apiHost)}/messageTemplates/send`;
  const body = JSON.stringify({
    channel: opts.channel ?? null,
    template_name: opts.templateName,
    broadcast_name: opts.broadcastName,
    recipients: opts.recipients.map((r) => ({
      phone_number: r.phone,
      ...(r.localMessageId ? { local_message_id: r.localMessageId } : {}),
      custom_params: r.parameters,
    })),
  });
  const res = await fetch(url, { method: "POST", headers: watiAuthHeaders(opts.apiKey), body });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* non-json */
  }
  return { ok: res.ok, status: res.status, data, text };
}

function parseV3BatchResults(
  items: WatiTemplateSendItem[],
  data: Record<string, unknown>,
  resOk: boolean,
  text: string,
  localIdsByPhone: Map<string, string>,
): WatiTemplateSendResult[] {
  if (!resOk) {
    const msg = String(data.message ?? data.error ?? text).slice(0, 300) || "V3 send failed";
    return items.map((item) => ({ phone: item.phone, leadId: item.leadId, ok: false, error: msg }));
  }

  if (data.success === false) {
    const msg = String(data.error ?? data.message ?? "V3 send rejected").slice(0, 300);
    return items.map((item) => ({ phone: item.phone, leadId: item.leadId, ok: false, error: msg }));
  }

  const byPhone = new Map<string, { local_message_id?: string; errors?: string[] }>();
  const rows = data.recipients as
    | Array<{ phone_number?: string; local_message_id?: string; errors?: string[] }>
    | undefined;
  for (const row of rows ?? []) {
    const phone = normalizeWhatsAppPhone(String(row.phone_number ?? ""));
    if (phone) byPhone.set(phone, row);
  }

  return items.map((item) => {
    const row = byPhone.get(item.phone);
    const rowErrors = row?.errors?.filter(Boolean) ?? [];
    if (rowErrors.length > 0) {
      return {
        phone: item.phone,
        leadId: item.leadId,
        ok: false,
        error: rowErrors.join("; ").slice(0, 400),
      };
    }
    return {
      phone: item.phone,
      leadId: item.leadId,
      ok: true,
      messageId: String(row?.local_message_id ?? localIdsByPhone.get(item.phone) ?? ""),
    };
  });
}

function newWatiLocalMessageId(leadId?: string): string {
  if (leadId) return `lead_${leadId}`;
  return crypto.randomUUID();
}

async function sendWatiTemplateMessageV1(opts: {
  tenantId: string;
  apiKey: string;
  apiHost?: string | null;
  toPhone: string;
  templateName: string;
  parameters: Array<{ name: string; value: string }>;
  broadcastName: string;
  localMessageId?: string;
}): Promise<{ messageId: string; ok: boolean; error?: string }> {
  const to = normalizeWhatsAppPhone(opts.toPhone);
  const fallbackLocalMessageId = opts.localMessageId ?? newWatiLocalMessageId();
  const root = watiApiRoot(opts.tenantId, opts.apiHost);
  const body = JSON.stringify({
    template_name: opts.templateName,
    broadcast_name: opts.broadcastName,
    parameters: opts.parameters,
  });
  const headers = watiAuthHeaders(opts.apiKey);

  async function postSend(apiVersion: "v1" | "v2") {
    const url = `${root}/api/${apiVersion}/sendTemplateMessage?whatsappNumber=${encodeURIComponent(to)}`;
    const res = await fetch(url, { method: "POST", headers, body });
    const text = await res.text();
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      /* non-json */
    }
    return { res, text, data };
  }

  let { res, text, data } = await postSend("v1");
  if (res.status === 404) {
    ({ res, text, data } = await postSend("v2"));
  }

  const parsed = parseV1SendResponse(data, text, res.ok, fallbackLocalMessageId);
  return {
    messageId: parsed.messageId ?? fallbackLocalMessageId,
    ok: parsed.ok,
    error: parsed.error,
  };
}

/**
 * Send template messages in batch via WATI V3 (falls back to V1 one-by-one if V3 unavailable).
 * @see https://docs.wati.io/reference/post_api-ext-v3-messagetemplates-send
 */
export async function sendWatiTemplateMessagesBatch(opts: {
  tenantId: string;
  apiKey: string;
  apiHost?: string | null;
  templateName: string;
  broadcastName: string;
  items: WatiTemplateSendItem[];
  channel?: string | null;
}): Promise<{ results: WatiTemplateSendResult[]; api: "v3" | "v1" }> {
  const validItems = opts.items
    .map((item) => ({ ...item, phone: normalizeWhatsAppPhone(item.phone) }))
    .filter((item) => item.phone.length >= 7);

  if (validItems.length === 0) {
    return { results: [], api: "v3" };
  }

  const allResults: WatiTemplateSendResult[] = [];
  let useV1 = false;

  for (let i = 0; i < validItems.length; i += WATI_V3_SEND_CHUNK_SIZE) {
    if (useV1) break;
    const chunk = validItems.slice(i, i + WATI_V3_SEND_CHUNK_SIZE);
    const localIdsByPhone = new Map<string, string>();
    const v3 = await postWatiTemplateSendV3({
      tenantId: opts.tenantId,
      apiKey: opts.apiKey,
      apiHost: opts.apiHost,
      templateName: opts.templateName,
      broadcastName: opts.broadcastName,
      channel: opts.channel,
      recipients: chunk.map((item) => {
        const localMessageId = newWatiLocalMessageId(item.leadId);
        localIdsByPhone.set(item.phone, localMessageId);
        return {
          phone: item.phone,
          parameters: item.parameters,
          localMessageId,
        };
      }),
    });

    if (v3.status === 404 || v3.status === 501) {
      useV1 = true;
      break;
    }

    allResults.push(...parseV3BatchResults(chunk, v3.data, v3.ok, v3.text, localIdsByPhone));

    if (i + WATI_V3_SEND_CHUNK_SIZE < validItems.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  if (!useV1 && allResults.length >= validItems.length) {
    return { results: allResults, api: "v3" };
  }

  const v1Results: WatiTemplateSendResult[] = [];
  const startIdx = useV1 ? 0 : allResults.length;
  const remaining = useV1 ? validItems : validItems.slice(startIdx);

  for (const item of remaining) {
    const localMessageId = newWatiLocalMessageId(item.leadId);
    const v1 = await sendWatiTemplateMessageV1({
      tenantId: opts.tenantId,
      apiKey: opts.apiKey,
      apiHost: opts.apiHost,
      toPhone: item.phone,
      templateName: opts.templateName,
      parameters: item.parameters,
      broadcastName: opts.broadcastName,
      localMessageId,
    });
    v1Results.push({
      phone: item.phone,
      leadId: item.leadId,
      ok: v1.ok,
      messageId: v1.ok ? localMessageId : undefined,
      error: v1.error,
    });
    await new Promise((r) => setTimeout(r, 120));
  }

  return {
    results: useV1 ? v1Results : [...allResults, ...v1Results],
    api: useV1 || v1Results.length > 0 ? "v1" : "v3",
  };
}

export async function sendWatiTemplateMessage(opts: {
  tenantId: string;
  apiKey: string;
  apiHost?: string | null;
  toPhone: string;
  templateName: string;
  parameters: Array<{ name: string; value: string }>;
  broadcastName: string;
}): Promise<{ messageId: string; ok: boolean; error?: string }> {
  const phone = normalizeWhatsAppPhone(opts.toPhone);
  if (!phone) {
    return { messageId: "", ok: false, error: "Invalid phone number" };
  }

  try {
    const localMessageId = newWatiLocalMessageId();
    const localIdsByPhone = new Map<string, string>([[phone, localMessageId]]);
    const v3 = await postWatiTemplateSendV3({
      tenantId: opts.tenantId,
      apiKey: opts.apiKey,
      apiHost: opts.apiHost,
      templateName: opts.templateName,
      broadcastName: opts.broadcastName,
      recipients: [{ phone, parameters: opts.parameters, localMessageId }],
    });

    if (v3.status !== 404 && v3.status !== 501) {
      const [result] = parseV3BatchResults(
        [{ phone, parameters: opts.parameters }],
        v3.data,
        v3.ok,
        v3.text,
        localIdsByPhone,
      );
      if (result) {
        return {
          messageId: result.messageId ?? "",
          ok: result.ok,
          error: result.error,
        };
      }
    }

    return await sendWatiTemplateMessageV1({ ...opts, localMessageId });
  } catch (e) {
    return { messageId: "", ok: false, error: (e as Error).message };
  }
}

export async function findLeadByPhone(
  sb: { from: (t: string) => any },
  workspaceId: string,
  phone: string,
): Promise<{ id: string; full_name: string | null; phone: string } | null> {
  const normalized = normalizeWhatsAppPhone(phone);
  const tail = phoneTail(normalized);
  if (!normalized && !tail) return null;

  const { data: exact } = await sb
    .from("leads")
    .select("id, full_name, phone")
    .eq("workspace_id", workspaceId)
    .eq("phone", normalized)
    .limit(1)
    .maybeSingle();
  if (exact?.id) return exact;

  if (tail) {
    const { data: rows } = await sb
      .from("leads")
      .select("id, full_name, phone")
      .eq("workspace_id", workspaceId)
      .ilike("phone", `%${tail}`)
      .limit(5);
    const list = (rows ?? []) as Array<{ id: string; full_name: string | null; phone: string }>;
    const match =
      list.find((r) => phoneTail(r.phone) === tail) ??
      list[0] ??
      null;
    return match;
  }

  return null;
}

export async function resolveCampaignAudienceLeads(
  sb: { from: (t: string) => any },
  workspaceId: string,
  filter: CampaignAudienceFilter | null | undefined,
): Promise<Array<Record<string, unknown>>> {
  let q = sb
    .from("leads")
    .select("*")
    .eq("workspace_id", workspaceId)
    .not("phone", "is", null)
    .neq("phone", "");

  const f = filter ?? {};
  if (f.lead_ids?.length) q = q.in("id", f.lead_ids);
  if (f.qualification_status) q = q.eq("qualification_status", f.qualification_status);
  if (f.pipeline_stage) q = q.eq("pipeline_stage", f.pipeline_stage);
  if (f.status) q = q.eq("status", f.status);
  if (f.whatsapp_opt_in_only) q = q.eq("whatsapp_opt_in", true);

  const { data, error } = await q.limit(5000);
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<Record<string, unknown>>;
}

export async function attachLeadToInboundMessage(
  sb: { from: (t: string) => any },
  workspaceId: string,
  phone: string,
  contactName: string | null,
): Promise<string | null> {
  const lead = await findLeadByPhone(sb, workspaceId, phone);
  if (lead?.id) {
    await sb
      .from("leads")
      .update({ last_contacted_at: new Date().toISOString() })
      .eq("id", lead.id);
    return lead.id;
  }
  return null;
}

export function isWatiStatusEvent(payload: Record<string, unknown>): boolean {
  const t = String(payload.eventType ?? payload.type ?? payload.event ?? "").toLowerCase();
  return (
    t.includes("sentmessagedelivered") ||
    t.includes("sentmessageread") ||
    t.includes("templatemessagefailed") ||
    t.includes("sessionmessagesent")
  );
}
