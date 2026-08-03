/**
 * Shared CSV helpers for WATI campaign lead imports (client + server).
 */

export type CsvLeadRow = {
  phone: string;
  full_name?: string | null;
  email?: string | null;
  company_name?: string | null;
  notes?: string | null;
  /** Structured CSV columns (JVC property registry, etc.) */
  import_meta?: Record<string, string> | null;
};

export type CsvColumnMapping = {
  phone: string;
  /** Try each column until a valid number is found (JVC: Mobile 1 → Mobile 2 → Phone 1…). */
  phone_columns?: string[];
  full_name?: string;
  email?: string;
  company_name?: string;
  notes?: string;
  /** e.g. ProcedurePartyTypeNameEn — filter to Buyer rows when buyersOnly is set */
  party_type?: string;
  project?: string;
  building?: string;
  /** Extra CSV columns appended to lead notes (property context). */
  context_columns?: string[];
};

/** JVC owner registry export (Nov 2024 – Apr/Oct) — reference for UI/docs. */
export const JVC_OWNER_REGISTRY_COLUMN_MAP: Array<{
  csvColumn: string;
  importField: string;
  required: boolean;
  notes: string;
}> = [
  { csvColumn: "Owner Name", importField: "full_name", required: true, notes: "Contact / template name" },
  { csvColumn: "Mobile 1", importField: "phone (primary)", required: true, notes: "First WhatsApp number tried" },
  { csvColumn: "Mobile 2", importField: "phone (fallback)", required: false, notes: "Used if Mobile 1 empty" },
  { csvColumn: "Phone 1", importField: "phone (fallback)", required: false, notes: "Landline; format 971|56-4036977" },
  { csvColumn: "Phone 2", importField: "phone (fallback)", required: false, notes: "Secondary landline" },
  { csvColumn: "Secondary Mobile", importField: "phone (fallback)", required: false, notes: "Extra mobile" },
  { csvColumn: "Project", importField: "notes (project)", required: false, notes: "e.g. Samana Manhattan 2" },
  { csvColumn: "BuildingName 2", importField: "notes (building)", required: false, notes: "Building marketing name" },
  { csvColumn: "Building 1", importField: "notes (building alt)", required: false, notes: "Fallback building label" },
  { csvColumn: "Master Location", importField: "notes", required: false, notes: "Area — Jumeirah Village Circle" },
  { csvColumn: "Master Project", importField: "notes", required: false, notes: "District" },
  { csvColumn: "UnitNumber", importField: "notes", required: false, notes: "Unit / showroom id" },
  { csvColumn: "property_number", importField: "notes", required: false, notes: "Internal property ref" },
  { csvColumn: "Completion Status", importField: "notes", required: false, notes: "off-plan / ready" },
  { csvColumn: "Property Type", importField: "notes", required: false, notes: "Apartments, Showrooms, etc." },
  { csvColumn: "Sub Type", importField: "notes", required: false, notes: "flat, show_rooms, etc." },
  { csvColumn: "Usage", importField: "notes", required: false, notes: "Residential / Commercial" },
  { csvColumn: "beds", importField: "notes", required: false, notes: "Bedroom count" },
  { csvColumn: "Transaction Amount", importField: "notes", required: false, notes: "AED value (may include commas)" },
  { csvColumn: "Size", importField: "notes", required: false, notes: "Sq ft / sq m" },
  { csvColumn: "Date", importField: "notes", required: false, notes: "Transaction date" },
  { csvColumn: "Passport", importField: "notes", required: false, notes: "Passport / ID ref" },
  { csvColumn: "LandNumber", importField: "notes", required: false, notes: "DLD land number" },
  { csvColumn: "Municipality No", importField: "notes", required: false, notes: "Municipality code" },
  { csvColumn: "Municipality Sub No", importField: "notes", required: false, notes: "Municipality sub code" },
];

const PHONE_ALIASES = new Set([
  "phone",
  "phonenumber",
  "phone1",
  "phone2",
  "mobile",
  "mobile1",
  "mobile2",
  "mobilenumber",
  "secondarymobile",
  "cell",
  "cellphone",
  "contactnumber",
  "whatsapp",
  "whatsappnumber",
  "number",
]);

const PHONE_COLUMN_PRIORITY = [
  "mobile1",
  "mobile2",
  "secondarymobile",
  "phone1",
  "phone2",
  "mobile",
  "phone",
];

const NAME_ALIASES = new Set([
  "name",
  "nameen",
  "ownername",
  "fullname",
  "full_name",
  "contactname",
  "firstname",
  "first_name",
]);

const EMAIL_ALIASES = new Set(["email", "emailaddress", "mail"]);
const COMPANY_ALIASES = new Set(["company", "companyname", "company_name", "organisation", "organization"]);
const NOTES_ALIASES = new Set(["notes", "note", "comments", "comment", "remarks"]);
const PARTY_TYPE_ALIASES = new Set([
  "procedurepartytypenameen",
  "partytype",
  "role",
  "buyerseller",
  "contacttype",
]);
const PROJECT_ALIASES = new Set(["project", "masterproject", "community"]);
const BUILDING_ALIASES = new Set([
  "buildingnameen",
  "buildingname",
  "buildingname2",
  "building1",
  "building",
]);

/** JVC owner CSV — extra columns stored in lead notes automatically. */
const JVC_CONTEXT_NOTE_KEYS = new Set([
  "date",
  "masterlocation",
  "masterproject",
  "unitnumber",
  "propertynumber",
  "completionstatus",
  "propertytype",
  "subtype",
  "usage",
  "beds",
  "transactionamount",
  "size",
  "passport",
  "landnumber",
  "municipalityno",
  "municipalitysubno",
]);

function normKey(s: string): string {
  return s.toLowerCase().replace(/[\s_\-()./]+/g, "");
}

export function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

export function parseCsvText(
  text: string,
  opts?: { maxDataRows?: number },
): { headers: string[]; rows: Record<string, string>[]; truncated: boolean } {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    throw new Error("CSV must have a header row and at least one data row");
  }
  const headers = parseCsvLine(lines[0]).map((h) => h.trim());
  const maxDataRows = opts?.maxDataRows;
  const dataLineCount = lines.length - 1;
  const truncated = maxDataRows != null && dataLineCount > maxDataRows;
  const end = maxDataRows != null ? Math.min(lines.length, maxDataRows + 1) : lines.length;
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < end; i++) {
    const vals = parseCsvLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = (vals[idx] ?? "").trim();
    });
    rows.push(row);
  }
  return { headers, rows, truncated };
}

export function normalizeLeadPhone(raw: string): string {
  let s = String(raw ?? "").trim();
  if (!s || s.toLowerCase() === "null") return "";
  // DLD / registry format: 971|56-4036977 or 98|9129099611
  s = s.replace(/\|/g, "");
  s = s.replace(/[\s.\-()]/g, "");
  if (/[a-zA-Z]/.test(s)) return "";
  const digits = s.replace(/\D/g, "");
  if (digits.length < 7) return "";
  if (s.startsWith("00")) s = "+" + s.slice(2);
  else if (!s.startsWith("+")) {
    if (digits.startsWith("971") && digits.length >= 11) s = "+" + digits;
    else if (digits.length >= 10) s = "+" + digits;
    else s = digits;
  }
  return s;
}

function pickPhoneColumns(headers: string[]): string[] {
  const byKey = new Map(headers.map((h) => [normKey(h), h]));
  const cols: string[] = [];
  for (const key of PHONE_COLUMN_PRIORITY) {
    const h = byKey.get(key);
    if (h) cols.push(h);
  }
  return cols;
}

function pickAllPhonesFromRow(
  row: Record<string, string>,
  mapping: CsvColumnMapping,
): { primary: string; byColumn: Record<string, string> } {
  const cols = mapping.phone_columns?.length ? mapping.phone_columns : [mapping.phone];
  const byColumn: Record<string, string> = {};
  let primary = "";

  for (const col of cols) {
    const phone = normalizeLeadPhone(row[col] ?? "");
    if (phone && phone.replace(/\D/g, "").length >= 7) {
      byColumn[col] = phone;
      if (!primary) primary = phone;
    }
  }

  return { primary, byColumn };
}

function pickPhoneFromRow(row: Record<string, string>, mapping: CsvColumnMapping): string {
  return pickAllPhonesFromRow(row, mapping).primary;
}

function cellDisplay(val: string | undefined): string | null {
  const v = (val ?? "").trim();
  if (!v || v.toLowerCase() === "null") return null;
  return v;
}

function pickColumn(headers: string[], aliases: Set<string>): string | undefined {
  for (const h of headers) {
    if (aliases.has(normKey(h))) return h;
  }
  return undefined;
}

/** Guess CSV column → lead field mapping from headers. */
export function autoDetectCsvColumnMapping(headers: string[]): CsvColumnMapping | null {
  const phoneColumns = pickPhoneColumns(headers);
  const phone = phoneColumns[0] ?? pickColumn(headers, PHONE_ALIASES);
  if (!phone) return null;

  const building =
    pickColumn(headers, BUILDING_ALIASES) ??
    headers.find((h) => normKey(h) === "buildingname2") ??
    headers.find((h) => normKey(h) === "building1");

  const context_columns = headers.filter((h) => JVC_CONTEXT_NOTE_KEYS.has(normKey(h)));

  return {
    phone,
    phone_columns: phoneColumns.length > 0 ? phoneColumns : [phone],
    full_name: pickColumn(headers, NAME_ALIASES),
    email: pickColumn(headers, EMAIL_ALIASES),
    company_name: pickColumn(headers, COMPANY_ALIASES),
    notes: pickColumn(headers, NOTES_ALIASES),
    party_type: pickColumn(headers, PARTY_TYPE_ALIASES),
    project: pickColumn(headers, PROJECT_ALIASES),
    building,
    context_columns: context_columns.length > 0 ? context_columns : undefined,
  };
}

export function csvHasPartyTypeColumn(mapping: CsvColumnMapping): boolean {
  return !!mapping.party_type;
}

export function mapCsvRowsToLeads(
  rows: Record<string, string>[],
  mapping: CsvColumnMapping,
  opts?: { maxLeads?: number; skipLeads?: number; buyersOnly?: boolean },
): CsvLeadRow[] {
  const out: CsvLeadRow[] = [];
  const seen = new Set<string>();
  const maxLeads = opts?.maxLeads;
  const skipLeads = Math.max(0, opts?.skipLeads ?? 0);
  const buyersOnly = opts?.buyersOnly !== false && !!mapping.party_type;
  let skippedValid = 0;

  for (const row of rows) {
    if (maxLeads != null && out.length >= maxLeads) break;

    if (buyersOnly && mapping.party_type) {
      const role = (row[mapping.party_type] ?? "").trim().toLowerCase();
      if (role === "seller" || role === "landlord" || role === "developer") continue;
    }

    const { primary: phone, byColumn: phonesByColumn } = pickAllPhonesFromRow(row, mapping);
    if (!phone) continue;
    if (seen.has(phone)) continue;
    seen.add(phone);

    if (skippedValid < skipLeads) {
      skippedValid++;
      continue;
    }

    const import_meta: Record<string, string> = {};
    const noteParts: string[] = [];
    for (const [col, num] of Object.entries(phonesByColumn)) {
      import_meta[col] = num;
      noteParts.push(`${col}: ${num}`);
    }
    if (mapping.notes && row[mapping.notes]?.trim()) {
      const v = row[mapping.notes].trim();
      import_meta[mapping.notes] = v;
      noteParts.push(v);
    }
    if (mapping.project && row[mapping.project]?.trim()) {
      const v = row[mapping.project].trim();
      import_meta["Project"] = v;
      noteParts.push(`Project: ${v}`);
    }
    if (mapping.building && row[mapping.building]?.trim()) {
      const v = row[mapping.building].trim();
      import_meta["Building"] = v;
      noteParts.push(`Building: ${v}`);
    }
    for (const col of mapping.context_columns ?? []) {
      const val = cellDisplay(row[col]);
      if (val) {
        import_meta[col] = val;
        noteParts.push(`${col}: ${val}`);
      }
    }
    if (mapping.email && row[mapping.email]?.trim()) {
      import_meta["Email"] = row[mapping.email].trim();
    }
    if (mapping.company_name && row[mapping.company_name]?.trim()) {
      import_meta["Company"] = row[mapping.company_name].trim();
    }

    const fullName = mapping.full_name ? cellDisplay(row[mapping.full_name]) : null;

    out.push({
      phone,
      full_name: fullName,
      email: mapping.email ? cellDisplay(row[mapping.email]) : null,
      company_name: mapping.company_name ? cellDisplay(row[mapping.company_name]) : null,
      notes: noteParts.length ? noteParts.join(" · ") : null,
      import_meta: Object.keys(import_meta).length ? import_meta : null,
    });
  }

  return out;
}

/** How many raw CSV rows to read so skip + batch size can find enough valid phones. */
export function csvScanRowCount(batchSize: number, skipValid = 0): number {
  const need = Math.max(0, skipValid) + Math.max(1, batchSize);
  return Math.max(need * 100, 2000);
}

const CSV_SKIP_STORAGE_PREFIX = "webee:wa-csv-skip:";

export function loadCsvSkipForFile(fileName: string): number {
  if (typeof localStorage === "undefined" || !fileName) return 0;
  const raw = localStorage.getItem(`${CSV_SKIP_STORAGE_PREFIX}${fileName}`);
  const n = parseInt(raw ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function saveCsvSkipForFile(fileName: string, skip: number): void {
  if (typeof localStorage === "undefined" || !fileName) return;
  localStorage.setItem(`${CSV_SKIP_STORAGE_PREFIX}${fileName}`, String(Math.max(0, skip)));
}

/** Parse legacy `notes` string (`Key: value · Key: value`) into a field map. */
export function parseNotesToMeta(notes: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!notes?.trim()) return out;
  for (const part of notes.split(" · ")) {
    const i = part.indexOf(": ");
    if (i > 0) {
      const key = part.slice(0, i).trim();
      const val = part.slice(i + 2).trim();
      if (key && val) out[key] = val;
    }
  }
  return out;
}

/** Merge structured import_meta with parsed notes (meta wins on conflict). */
export function getContactFieldsMap(contact: {
  notes?: string | null;
  import_meta?: Record<string, unknown> | null;
}): Record<string, string> {
  const fromNotes = parseNotesToMeta(contact.notes);
  const fromMeta: Record<string, string> = {};
  if (contact.import_meta && typeof contact.import_meta === "object") {
    for (const [k, v] of Object.entries(contact.import_meta)) {
      const s = v != null ? String(v).trim() : "";
      if (s) fromMeta[k] = s;
    }
  }
  return { ...fromNotes, ...fromMeta };
}

/** Read first matching field from a contact (import_meta + notes). */
export function getContactField(
  contact: { notes?: string | null; import_meta?: Record<string, unknown> | null },
  ...keys: string[]
): string | null {
  const map = getContactFieldsMap(contact);
  for (const key of keys) {
    const v = map[key];
    if (v?.trim()) return v.trim();
  }
  return null;
}

/** Read first matching key from a flat field map. */
export function getContactMetaValue(
  meta: Record<string, unknown> | null | undefined,
  ...keys: string[]
): string | null {
  if (!meta || typeof meta !== "object") return null;
  for (const key of keys) {
    const v = meta[key];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return null;
}

/** JVC / property CSV phone column labels in display order. */
export const PHONE_FIELD_ORDER = [
  "Mobile 1",
  "Mobile 2",
  "Secondary Mobile",
  "Phone 1",
  "Phone 2",
];

function phoneDigits(phone: string): string {
  return phone.replace(/\D/g, "");
}

/** All phone numbers on a contact (primary + Mobile 1, Mobile 2, Phone 1, etc.). */
export function getContactPhones(contact: {
  phone?: string;
  notes?: string | null;
  import_meta?: Record<string, unknown> | null;
}): Array<{ label: string; phone: string }> {
  const map = getContactFieldsMap(contact);
  const out: Array<{ label: string; phone: string }> = [];
  const seen = new Set<string>();

  function add(label: string, phone: string) {
    const digits = phoneDigits(phone);
    if (!digits || seen.has(digits)) return;
    seen.add(digits);
    out.push({ label, phone });
  }

  for (const label of PHONE_FIELD_ORDER) {
    const v = map[label];
    if (v) add(label, v);
  }

  for (const [label, value] of Object.entries(map)) {
    if (PHONE_FIELD_ORDER.includes(label)) continue;
    if (/mobile|phone/i.test(label)) add(label, value);
  }

  if (contact.phone?.trim()) {
    const primary = contact.phone.trim();
    const digits = phoneDigits(primary);
    const existingIdx = out.findIndex((p) => phoneDigits(p.phone) === digits);
    if (existingIdx >= 0) {
      // Promote primary label for WhatsApp contact number
      out[existingIdx] = { label: out[existingIdx].label, phone: primary };
    } else {
      out.unshift({ label: "Phone", phone: primary });
    }
  }

  return out;
}

/** Preferred display order for JVC / property registry fields. */
const CONTACT_FIELD_ORDER = [
  "Name",
  "Phone",
  ...PHONE_FIELD_ORDER,
  "Master Project",
  "Project",
  "Building",
  "BuildingName 2",
  "Building 1",
  "Property Type",
  "Sub Type",
  "Usage",
  "UnitNumber",
  "property_number",
  "Master Location",
  "Completion Status",
  "Date",
  "Transaction Amount",
  "Size",
  "beds",
  "Passport",
  "LandNumber",
  "Municipality No",
  "Municipality Sub No",
  "Email",
  "Company",
];

/** All displayable fields for a Buzzchat contact (meta + legacy notes). */
export function getContactDetailFields(contact: {
  name?: string | null;
  phone?: string;
  notes?: string | null;
  import_meta?: Record<string, unknown> | null;
}): Array<{ label: string; value: string }> {
  const map = getContactFieldsMap(contact);
  const fields: Array<{ label: string; value: string }> = [];
  const seen = new Set<string>();

  function add(label: string, value: string) {
    const key = `${label}:${value}`;
    if (!value.trim() || seen.has(key)) return;
    seen.add(key);
    fields.push({ label, value: value.trim() });
  }

  if (contact.name?.trim()) add("Name", contact.name);

  const phones = getContactPhones(contact);
  if (phones.length > 0) {
    for (const { label, phone } of phones) add(label, phone);
  } else if (contact.phone?.trim()) {
    add("Phone", contact.phone);
  }

  for (const label of CONTACT_FIELD_ORDER) {
    if (label === "Name" || label === "Phone" || PHONE_FIELD_ORDER.includes(label)) continue;
    const v = map[label];
    if (v) add(label, v);
  }

  for (const [label, value] of Object.entries(map)) {
    if (CONTACT_FIELD_ORDER.includes(label)) continue;
    if (PHONE_FIELD_ORDER.includes(label)) continue;
    if (/mobile|phone/i.test(label)) continue;
    add(label, value);
  }

  return fields;
}

/** Slice a large CSV file to header + N data rows before parsing (avoids freezing on 50k+ row files). */
export function sliceCsvTextForParse(text: string, maxDataRows: number): string {
  const lines = text.split(/\r?\n/);
  if (lines.length <= maxDataRows + 1) return text;
  return lines.slice(0, maxDataRows + 1).join("\n");
}

/**
 * Read only the first N data rows from a CSV File (does not load multi-MB files into memory).
 */
export async function readCsvFileHead(file: File, maxDataRows: number): Promise<{ text: string; truncated: boolean }> {
  if (file.size <= 512 * 1024) {
    const full = await file.text();
    const sliced = sliceCsvTextForParse(full, maxDataRows);
    return { text: sliced, truncated: sliced.length < full.length };
  }

  const chunkSize = 256 * 1024;
  let offset = 0;
  let buffer = "";
  let newlineCount = 0;

  while (offset < file.size && newlineCount <= maxDataRows) {
    const slice = file.slice(offset, Math.min(offset + chunkSize, file.size));
    buffer += await slice.text();
    newlineCount = (buffer.match(/\n/g) ?? []).length;
    offset += chunkSize;
  }

  const lines = buffer.split(/\r?\n/);
  const truncated = offset < file.size || lines.length > maxDataRows + 1;
  const text = lines.slice(0, maxDataRows + 1).join("\n");
  return { text, truncated };
}
