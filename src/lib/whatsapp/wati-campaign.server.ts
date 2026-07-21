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

export type WatiConnectionRow = {
  api_key: string;
  tenant_id: string;
  workspace_id: string;
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
  sb: { from: (t: string) => any },
  workspaceId: string,
): Promise<WatiConnectionRow | null> {
  const { data } = await sb
    .from("wati_connections")
    .select("api_key, tenant_id, workspace_id")
    .eq("workspace_id", workspaceId)
    .eq("status", "connected")
    .maybeSingle();
  if (!data?.api_key || !data?.tenant_id) return null;
  return data as WatiConnectionRow;
}

export function watiApiRoot(tenantId: string): string {
  return `https://live-mt-server.wati.io/${tenantId}`;
}

export async function sendWatiTemplateMessage(opts: {
  tenantId: string;
  apiKey: string;
  toPhone: string;
  templateName: string;
  parameters: Array<{ name: string; value: string }>;
  broadcastName: string;
}): Promise<{ messageId: string; ok: boolean; error?: string }> {
  const to = normalizeWhatsAppPhone(opts.toPhone);
  const root = watiApiRoot(opts.tenantId);
  try {
    const res = await fetch(`${root}/api/v1/sendTemplateMessage`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        whatsappNumber: to,
        template_name: opts.templateName,
        broadcast_name: opts.broadcastName,
        parameters: opts.parameters,
      }),
    });
    const text = await res.text();
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      /* non-json */
    }
    if (!res.ok) {
      return {
        messageId: "",
        ok: false,
        error: text.slice(0, 300) || `HTTP ${res.status}`,
      };
    }
    const messageId = String(
      (data as { id?: string; messageId?: string }).id ??
        (data as { messageId?: string }).messageId ??
        `wati_${Date.now()}`,
    );
    return { messageId, ok: true };
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
    t.includes("delivered") ||
    t.includes("read") ||
    t.includes("sent") ||
    t.includes("failed") ||
    t.includes("status")
  );
}
