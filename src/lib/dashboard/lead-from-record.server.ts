/**
 * Turn a Data Records row (or an Auto Dialer target) into a Leads row.
 *
 * Shared by the Data Records "Add to Leads" button and the Auto Dialer's per-call button, so a
 * person sent to Leads from either place gets the same fields and the same duplicate check.
 */
import { toE164 } from "@/lib/telephony/auto-dialer.shared";

type Sb = { from: (table: string) => any };

export interface LeadFromRecordResult {
  alreadyLead: boolean;
  leadId: string;
}

/** Last 9 digits — enough to find the same number written as 07…, 447… or +447…. */
function phoneTail(phone: string): string {
  return phone.replace(/\D/g, "").slice(-9);
}

/** An existing lead with this number, however either side wrote it. */
async function findLeadByPhone(sb: Sb, workspaceId: string, phone: string): Promise<string | null> {
  const tail = phoneTail(phone);
  if (tail.length < 7) return null;
  const { data, error } = await sb
    .from("leads")
    .select("id, phone")
    .eq("workspace_id", workspaceId)
    .ilike("phone", `%${tail}`)
    .limit(20);
  if (error) throw new Error(error.message);
  const target = toE164(phone) || phone;
  const match = (data ?? []).find(
    (l: { phone: string | null }) => (toE164(l.phone) || String(l.phone ?? "").trim()) === target,
  );
  return match ? String(match.id) : null;
}

/** The workspace's data record for this number, if there is one. */
export async function findDataRecordByPhone(
  sb: Sb,
  workspaceId: string,
  phone: string,
): Promise<Record<string, any> | null> {
  const tail = phoneTail(phone);
  if (tail.length < 7) return null;
  const { data, error } = await sb
    .from("data_records")
    .select("*")
    .eq("workspace_id", workspaceId)
    .ilike("mobile_number", `%${tail}`)
    .order("updated_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);
  const target = toE164(phone) || phone;
  return (
    (data ?? []).find(
      (r: { mobile_number: string | null; is_deleted?: boolean }) =>
        !r.is_deleted && (toE164(r.mobile_number) || String(r.mobile_number ?? "").trim()) === target,
    ) ?? null
  );
}

export async function createLeadFromDataRecord(
  sb: Sb,
  workspaceId: string,
  record: Record<string, any>,
  extraMeta: Record<string, unknown> = {},
): Promise<LeadFromRecordResult> {
  const phone = String(record.mobile_number ?? "").trim();
  if (!phone) throw new Error("This record has no phone number to lead with");

  const existing = await findLeadByPhone(sb, workspaceId, phone);
  if (existing) return { alreadyLead: true, leadId: existing };

  const addressParts = [record.address_line1, record.address_line2, record.city, record.state, record.postal_code]
    .map((v) => (v ? String(v).trim() : ""))
    .filter(Boolean);

  const meta: Record<string, unknown> = { ...(record.meta ?? {}) };
  for (const [key, value] of Object.entries(record)) {
    if (key === "meta" || value == null || value === "") continue;
    if (!(key in meta)) meta[key] = value;
  }
  if (record.id) meta.added_from_data_record_id = record.id;
  Object.assign(meta, extraMeta);

  const { data: inserted, error: insertErr } = await sb
    .from("leads")
    .insert({
      workspace_id: workspaceId,
      full_name: record.name || null,
      phone,
      email: record.email || null,
      company_name: record.client_name || null,
      business_address: addressParts.length ? addressParts.join(", ") : null,
      state_name: record.state || null,
      business_type: record.title || null,
      source: "import",
      source_detail: String(extraMeta.source_detail ?? "data_records"),
      status: "need_to_call",
      meta,
    })
    .select("id")
    .single();
  if (insertErr) throw new Error(insertErr.message);
  return { alreadyLead: false, leadId: inserted.id as string };
}
