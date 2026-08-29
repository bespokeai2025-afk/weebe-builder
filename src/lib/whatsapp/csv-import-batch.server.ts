/**
 * Fast batched CSV lead/contact import — avoids N sequential DB round-trips per row.
 */
import type { CsvLeadRow } from "@/lib/whatsapp/csv-leads.shared";
import { parseNotesToMeta } from "@/lib/whatsapp/csv-leads.shared";
import { normalizeWhatsAppPhone, phoneTail } from "@/lib/whatsapp/wati-campaign.server";
import {
  DEFAULT_CAMPAIGN_LEAD_STAGE,
  writeCampaignQualification,
  type CampaignQualification,
} from "@/lib/whatsapp/campaign-leads.shared";

const BATCH_UPSERT = 200;
const UPDATE_CONCURRENCY = 24;

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

async function runPool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const i = index++;
      await fn(items[i]!);
    }
  });
  await Promise.all(workers);
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
  const unique = [...new Set(tails.filter((t) => t && t.length >= 10))];
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
    const tail = phoneTail(normalized);
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
  const tail = phoneTail(phone);
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
    const tail = phoneTail(phone);
    if (tail) tails.push(tail);
  }

  const byPhone = await fetchLeadsByPhones(sb, workspaceId, normalizedPhones);
  const lookup = buildLeadLookup(byPhone);

  const unmatchedTails = [
    ...new Set(
      normalizedPhones
        .filter((p) => !lookup.byExact.has(p))
        .map((p) => phoneTail(p))
        .filter((t): t is string => !!t && !lookup.byTail.has(t)),
    ),
  ];
  if (unmatchedTails.length > 0) {
    const byTailRows = await fetchLeadsByTails(sb, workspaceId, unmatchedTails);
    for (const lead of byTailRows) {
      const normalized = normalizeWhatsAppPhone(lead.phone);
      if (normalized && !lookup.byExact.has(normalized)) lookup.byExact.set(normalized, lead);
      const tail = phoneTail(normalized);
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
  for (let i = 0; i < unique.length; i += 500) {
    const chunk = unique.slice(i, i + 500);
    const { data, error } = await sb
      .from("whatsapp_contacts")
      .select("id, phone, name, notes, tags, lead_status")
      .eq("workspace_id", workspaceId)
      .in("phone", chunk);
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as ExistingContact[]) {
      const normalized = normalizeWhatsAppPhone(row.phone);
      if (normalized) map.set(normalized, row);
    }
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
  opts?: { syncWhatsappContacts?: boolean },
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
  type LeadUpdate = { id: string; patch: Record<string, unknown> };
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
    const existing = resolveExistingLead(phone, lookup);
    const mergedMeta = mergeLeadMeta(existing?.meta, rowMeta, row.qualification);

    if (existing?.id) {
      const patch: Record<string, unknown> = {
        updated_at: now,
        whatsapp_opt_in: true,
        meta: mergedMeta,
      };
      if (row.full_name) patch.full_name = row.full_name;
      if (row.email) patch.email = row.email;
      if (row.company_name) patch.company_name = row.company_name;
      if (row.notes) patch.notes = row.notes;
      if (!existing.pipeline_stage) patch.pipeline_stage = DEFAULT_CAMPAIGN_LEAD_STAGE;
      toUpdate.push({ id: existing.id, patch });
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
        pipeline_stage: DEFAULT_CAMPAIGN_LEAD_STAGE,
        meta: mergedMeta,
      });
    }

    if (opts?.syncWhatsappContacts && existingContacts) {
      const prev = existingContacts.get(phone);
      if (prev?.id) contactUpdated++;
      else contactInserted++;
      const contactMeta = {
        ...parseNotesToMeta(prev?.notes),
        ...(row.import_meta ?? {}),
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
    await runPool(toUpdate, UPDATE_CONCURRENCY, async ({ id, patch }) => {
      const { error } = await sb.from("leads").update(patch).eq("id", id);
      if (error) throw new Error(error.message);
    });
  }

  return {
    leadIds,
    inserted: opts?.syncWhatsappContacts ? contactInserted : inserted,
    updated: opts?.syncWhatsappContacts ? contactUpdated : updated,
    skipped,
    total: opts?.syncWhatsappContacts ? contactInserted + contactUpdated : leadIds.length,
  };
}
