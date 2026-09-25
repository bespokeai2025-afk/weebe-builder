/**
 * Fast batched CSV lead/contact import — avoids N sequential DB round-trips per row.
 */
import type { CsvLeadRow } from "@/lib/whatsapp/csv-leads.shared";
import { parseNotesToMeta } from "@/lib/whatsapp/csv-leads.shared";
import { normalizeWhatsAppPhone, phoneMatchKey } from "@/lib/whatsapp/wati-campaign.server";
import {
  DEFAULT_CAMPAIGN_LEAD_STAGE,
  readListingStage,
  writeCampaignQualification,
  writeListingStage,
  type CampaignQualification,
} from "@/lib/whatsapp/campaign-leads.shared";

const BATCH_UPSERT = 200;

type ExistingLead = {
  id: string;
  phone: string;
  full_name: string | null;
  email: string | null;
  company_name: string | null;
  notes: string | null;
  meta?: Record<string, unknown> | null;
  pipeline_stage?: string | null;
};

type ExistingContact = {
  id: string;
  phone: string;
  name: string | null;
  notes: string | null;
  tags?: string[] | null;
  lead_status?: string | null;
};

type LeadLookup = {
  byExact: Map<string, ExistingLead>;
  byTail: Map<string, ExistingLead>;
};

function mergeLeadMeta(
  existing: Record<string, unknown> | null | undefined,
  rowMeta: Record<string, string>,
  qualification: CampaignQualification | Partial<CampaignQualification> | null | undefined,
): Record<string, unknown> {
  let next: Record<string, unknown> = {
    ...(typeof existing === "object" && existing ? existing : {}),
    ...rowMeta,
  };
  if (qualification && (qualification.intent || qualification.asking_price || qualification.rental_price)) {
    next = writeCampaignQualification(next, {
      intent: qualification.intent ?? "",
      asking_price: qualification.asking_price ?? "",
      rental_price: qualification.rental_price ?? "",
      availability: qualification.availability ?? "",
      property_status: qualification.property_status ?? "",
      viewing_availability: qualification.viewing_availability ?? "",
      notes: qualification.notes ?? "",
    });
  }
  return next;
}

function leadMetaFromCsvRow(row: CsvLeadRow): Record<string, string> {
  if (row.import_meta && Object.keys(row.import_meta).length > 0) return row.import_meta;
  return parseNotesToMeta(row.notes);
}

async function fetchLeadsByPhones(
  sb: any,
  workspaceId: string,
  phones: string[],
): Promise<ExistingLead[]> {
  const out: ExistingLead[] = [];
  const unique = [...new Set(phones.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 500) {
    const chunk = unique.slice(i, i + 500);
    const { data, error } = await sb
      .from("leads")
      .select("id, phone, full_name, email, company_name, notes, meta, pipeline_stage")
      .eq("workspace_id", workspaceId)
      .in("phone", chunk);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as ExistingLead[]));
  }
  return out;
}

async function fetchLeadsByTails(
  sb: any,
  workspaceId: string,
  tails: string[],
): Promise<ExistingLead[]> {
  const out: ExistingLead[] = [];
  // 8, not 10. A UAE mobile in national format ("527574999") is 9 digits, so a 10-digit floor
  // dropped it here and it was never compared against the existing lead — which is how one person
  // ended up stored as 527574999, 0527574999 and 971527574999, each getting its own campaign send.
  const unique = [...new Set(tails.filter((t) => t && t.length >= 8))];
  for (let i = 0; i < unique.length; i += 40) {
    const chunk = unique.slice(i, i + 40);
    const or = chunk.map((t) => `phone.like.%${t}`).join(",");
    const { data, error } = await sb
      .from("leads")
      .select("id, phone, full_name, email, company_name, notes, meta, pipeline_stage")
      .eq("workspace_id", workspaceId)
      .or(or);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as ExistingLead[]));
  }
  return out;
}

function buildLeadLookup(leads: ExistingLead[]): LeadLookup {
  const byExact = new Map<string, ExistingLead>();
  const byTail = new Map<string, ExistingLead>();
  for (const lead of leads) {
    const normalized = normalizeWhatsAppPhone(lead.phone);
    if (normalized) byExact.set(normalized, lead);
    // phoneMatchKey (last 9, min 8) rather than phoneTail (last 10, min 10): the shorter key is
    // what lets a national-format number match the same person stored with a country code.
    const tail = phoneMatchKey(normalized);
    if (tail && !byTail.has(tail)) byTail.set(tail, lead);
  }
  return { byExact, byTail };
}

function resolveExistingLead(
  phone: string,
  lookup: LeadLookup,
): ExistingLead | null {
  const exact = lookup.byExact.get(phone);
  if (exact) return exact;
  const tail = phoneMatchKey(phone);
  if (tail && lookup.byTail.has(tail)) return lookup.byTail.get(tail)!;
  return null;
}

async function loadLeadLookupForRows(
  sb: any,
  workspaceId: string,
  rows: CsvLeadRow[],
): Promise<LeadLookup> {
  const normalizedPhones: string[] = [];
  const tails: string[] = [];
  for (const row of rows) {
    const phone = normalizeWhatsAppPhone(row.phone);
    if (!phone || phone.replace(/\D/g, "").length < 7) continue;
    normalizedPhones.push(phone);
    const tail = phoneMatchKey(phone);
    if (tail) tails.push(tail);
  }

  const byPhone = await fetchLeadsByPhones(sb, workspaceId, normalizedPhones);
  const lookup = buildLeadLookup(byPhone);

  const unmatchedTails = [
    ...new Set(
      normalizedPhones
        .filter((p) => !lookup.byExact.has(p))
        .map((p) => phoneMatchKey(p))
        .filter((t): t is string => !!t && !lookup.byTail.has(t)),
    ),
  ];
  if (unmatchedTails.length > 0) {
    const byTailRows = await fetchLeadsByTails(sb, workspaceId, unmatchedTails);
    for (const lead of byTailRows) {
      const normalized = normalizeWhatsAppPhone(lead.phone);
      if (normalized && !lookup.byExact.has(normalized)) lookup.byExact.set(normalized, lead);
      const tail = phoneMatchKey(normalized);
      if (tail && !lookup.byTail.has(tail)) lookup.byTail.set(tail, lead);
    }
  }

  return lookup;
}

async function fetchContactsByPhones(
  sb: any,
  workspaceId: string,
  phones: string[],
): Promise<Map<string, ExistingContact>> {
  const map = new Map<string, ExistingContact>();
  const unique = [...new Set(phones.filter(Boolean))];
  const add = (row: ExistingContact) => {
    const normalized = normalizeWhatsAppPhone(row.phone);
    if (normalized && !map.has(normalized)) map.set(normalized, row);
    // Also keyed by the 9-digit identity so a national-format import row resolves to the same
    // contact as one stored with a country code, instead of creating a second row.
    const tail = phoneMatchKey(row.phone);
    if (tail && !map.has(tail)) map.set(tail, row);
  };
  for (let i = 0; i < unique.length; i += 500) {
    const chunk = unique.slice(i, i + 500);
    const { data, error } = await sb
      .from("whatsapp_contacts")
      .select("id, phone, name, notes, tags, lead_status")
      .eq("workspace_id", workspaceId)
      .in("phone", chunk);
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as ExistingContact[]) add(row);
  }

  // Anything still unmatched may be stored under a different format — look those up by tail.
  const unresolved = [...new Set(unique.map((p) => phoneMatchKey(p)).filter((t): t is string => !!t && !map.has(t)))];
  for (let i = 0; i < unresolved.length; i += 40) {
    const chunk = unresolved.slice(i, i + 40);
    const { data, error } = await sb
      .from("whatsapp_contacts")
      .select("id, phone, name, notes, tags, lead_status")
      .eq("workspace_id", workspaceId)
      .or(chunk.map((t) => `phone.like.%${t}`).join(","));
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as ExistingContact[]) add(row);
  }
  return map;
}

async function upsertContactChunks(sb: any, rows: Record<string, unknown>[]): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH_UPSERT) {
    const chunk = rows.slice(i, i + BATCH_UPSERT);
    const { error } = await sb
      .from("whatsapp_contacts")
      .upsert(chunk, { onConflict: "workspace_id,phone" });
    if (error && /import_meta/i.test(error.message)) {
      const stripped = chunk.map(({ import_meta: _im, ...rest }) => rest);
      const retry = await sb
        .from("whatsapp_contacts")
        .upsert(stripped, { onConflict: "workspace_id,phone" });
      if (retry.error) throw new Error(retry.error.message);
    } else if (error) {
      throw new Error(error.message);
    }
  }
}

async function insertLeadChunks(
  sb: any,
  rows: Record<string, unknown>[],
): Promise<Array<{ id: string; phone: string }>> {
  const created: Array<{ id: string; phone: string }> = [];
  for (let i = 0; i < rows.length; i += BATCH_UPSERT) {
    const chunk = rows.slice(i, i + BATCH_UPSERT);
    const { data, error } = await sb.from("leads").insert(chunk).select("id, phone");
    if (error) throw new Error(error.message);
    created.push(...((data ?? []) as Array<{ id: string; phone: string }>));
  }
  return created;
}

/**
 * Bulk-write already-matched leads in chunks, one upsert per chunk instead of one UPDATE per
 * row. Re-selecting an existing Buzzchat audience for a campaign is the common case — most of
 * the contacts already have a lead — and that used to mean one HTTP round trip per contact
 * (a concurrency-24 pool of individual `.update()` calls), which is what made loading a few
 * hundred contacts visibly slow.
 * `onConflict: "id"` makes this an UPDATE for every row here, since `id` always already exists.
 */
async function updateLeadChunks(
  sb: any,
  rows: Array<{ id: string; phone: string; workspace_id: string; patch: Record<string, unknown> }>,
): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH_UPSERT) {
    const chunk = rows.slice(i, i + BATCH_UPSERT).map((r) => ({
      id: r.id,
      phone: r.phone,
      workspace_id: r.workspace_id,
      ...r.patch,
    }));
    const { error } = await sb.from("leads").upsert(chunk, { onConflict: "id" });
    if (error) throw new Error(error.message);
  }
}

export type CsvImportBatchResult = {
  leadIds: string[];
  inserted: number;
  updated: number;
  skipped: number;
  total: number;
};

export async function batchImportCsvLeads(
  sb: any,
  workspaceId: string,
  rows: CsvLeadRow[],
  opts?: {
    syncWhatsappContacts?: boolean;
    /**
     * Label for this upload, stamped onto every lead as `meta.upload_type`.
     *
     * Gives an import an identity, so a batch can later be filtered as a group
     * — in Listing Leads and when picking an audience for a campaign. Applied
     * here rather than per row so a row's own notes-derived meta still works.
     */
    uploadType?: string | null;
  },
): Promise<CsvImportBatchResult> {
  const lookup = await loadLeadLookupForRows(sb, workspaceId, rows);
  const now = new Date().toISOString();

  const leadIds: string[] = [];
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let contactInserted = 0;
  let contactUpdated = 0;

  type LeadInsert = Record<string, unknown> & { phone: string };
  type LeadUpdate = { id: string; phone: string; workspace_id: string; patch: Record<string, unknown> };
  const toInsert: LeadInsert[] = [];
  const toUpdate: LeadUpdate[] = [];
  const contactUpserts: Record<string, unknown>[] = [];
  const seenPhones = new Set<string>();

  let existingContacts: Map<string, ExistingContact> | null = null;
  if (opts?.syncWhatsappContacts) {
    const phones = rows
      .map((r) => normalizeWhatsAppPhone(r.phone))
      .filter((p) => p && p.replace(/\D/g, "").length >= 7);
    existingContacts = await fetchContactsByPhones(sb, workspaceId, phones);
  }

  for (const row of rows) {
    const phone = normalizeWhatsAppPhone(row.phone);
    if (!phone || phone.replace(/\D/g, "").length < 7) {
      skipped++;
      continue;
    }
    if (seenPhones.has(phone)) continue;
    seenPhones.add(phone);

    const rowMeta = leadMetaFromCsvRow(row);
    const uploadType = (opts?.uploadType ?? "").trim();
    // Re-importing the same phone under a new label re-categorises it, which
    // matches the mental model: the newest upload is what it belongs to now.
    if (uploadType) rowMeta.upload_type = uploadType;
    const existing = resolveExistingLead(phone, lookup);
    const mergedMetaRaw = mergeLeadMeta(existing?.meta, rowMeta, row.qualification);
    const mergedMeta = readListingStage(mergedMetaRaw, existing?.pipeline_stage)
      ? mergedMetaRaw
      : writeListingStage(mergedMetaRaw, DEFAULT_CAMPAIGN_LEAD_STAGE);

    if (existing?.id) {
      const patch: Record<string, unknown> = {
        updated_at: now,
        whatsapp_opt_in: true,
        meta: mergedMeta,
      };
      // Every optional field is always present in the patch, falling back to the lead's current
      // value rather than being omitted — the write below is a single bulk upsert across many
      // rows with different fields set, and an absent key there is NULL, not "leave unchanged".
      // Filling it here keeps the old per-row "only touch what changed" behaviour exact.
      patch.full_name = row.full_name || existing.full_name || null;
      patch.email = row.email || existing.email || null;
      patch.company_name = row.company_name || existing.company_name || null;
      patch.notes = row.notes || existing.notes || null;
      // workspace_id + phone are the only NOT NULL columns leads has with no default — carried
      // along even though this row always updates, because upsert's INSERT ... ON CONFLICT still
      // validates them against the VALUES tuple before the conflict is even evaluated.
      toUpdate.push({ id: existing.id, phone, workspace_id: workspaceId, patch });
      leadIds.push(existing.id);
      updated++;
    } else {
      toInsert.push({
        workspace_id: workspaceId,
        phone,
        full_name: row.full_name ?? null,
        email: row.email ?? null,
        company_name: row.company_name ?? null,
        notes: row.notes ?? null,
        source: "import",
        lead_origin: "csv_import",
        origin_provider: "CSV",
        whatsapp_opt_in: true,
        meta: mergedMeta,
      });
    }

    if (opts?.syncWhatsappContacts && existingContacts) {
      const prev = existingContacts.get(phone) ?? existingContacts.get(phoneMatchKey(phone) ?? "");
      if (prev?.id) contactUpdated++;
      else contactInserted++;
      // rowMeta, not row.import_meta: it carries the stamped upload_type, and
      // the contacts table is the cheap place to read the category list back
      // from (the leads table is too large to scan on page load).
      const contactMeta = {
        ...parseNotesToMeta(prev?.notes),
        ...rowMeta,
      };
      const tags = [
        ...new Set([...(prev?.tags ?? []), ...(row.tags ?? [])].filter(Boolean)),
      ];
      const payload: Record<string, unknown> = {
        workspace_id: workspaceId,
        phone,
        name: row.full_name ?? prev?.name ?? null,
        source: "import",
        notes: row.notes ?? prev?.notes ?? null,
        lead_status: row.lead_status ?? prev?.lead_status ?? "new",
        tags,
        updated_at: now,
      };
      if (Object.keys(contactMeta).length > 0) payload.import_meta = contactMeta;
      contactUpserts.push(payload);
    }
  }

  if (opts?.syncWhatsappContacts && contactUpserts.length > 0) {
    await upsertContactChunks(sb, contactUpserts);
  }

  if (toInsert.length > 0) {
    const created = await insertLeadChunks(sb, toInsert);
    for (const row of created) {
      inserted++;
      leadIds.push(row.id);
      const normalized = normalizeWhatsAppPhone(row.phone);
      if (normalized) {
        lookup.byExact.set(normalized, {
          id: row.id,
          phone: row.phone,
          full_name: null,
          email: null,
          company_name: null,
          notes: null,
        });
      }
    }
  }

  if (toUpdate.length > 0) {
    await updateLeadChunks(sb, toUpdate);
  }

  return {
    leadIds,
    inserted: opts?.syncWhatsappContacts ? contactInserted : inserted,
    updated: opts?.syncWhatsappContacts ? contactUpdated : updated,
    skipped,
    total: opts?.syncWhatsappContacts ? contactInserted + contactUpdated : leadIds.length,
  };
}
