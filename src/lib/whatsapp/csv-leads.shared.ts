/**
 * Shared CSV helpers for WATI campaign lead imports (client + server).
 */

export type CsvLeadRow = {
  phone: string;
  full_name?: string | null;
  email?: string | null;
  company_name?: string | null;
  notes?: string | null;
};

export type CsvColumnMapping = {
  phone: string;
  full_name?: string;
  email?: string;
  company_name?: string;
  notes?: string;
};

const PHONE_ALIASES = new Set([
  "phone",
  "phonenumber",
  "mobile",
  "mobilenumber",
  "cell",
  "cellphone",
  "contactnumber",
  "whatsapp",
  "whatsappnumber",
  "number",
]);

const NAME_ALIASES = new Set([
  "name",
  "fullname",
  "full_name",
  "contactname",
  "firstname",
  "first_name",
]);

const EMAIL_ALIASES = new Set(["email", "emailaddress", "mail"]);
const COMPANY_ALIASES = new Set(["company", "companyname", "company_name", "organisation", "organization"]);
const NOTES_ALIASES = new Set(["notes", "note", "comments", "comment"]);

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

export function parseCsvText(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    throw new Error("CSV must have a header row and at least one data row");
  }
  const headers = parseCsvLine(lines[0]).map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseCsvLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = (vals[idx] ?? "").trim();
    });
    rows.push(row);
  }
  return { headers, rows };
}

export function normalizeLeadPhone(raw: string): string {
  let s = String(raw ?? "").trim().replace(/[\s.\-()]/g, "");
  if (s.startsWith("00")) s = "+" + s.slice(2);
  if (!s.startsWith("+") && s.length > 10) s = "+" + s;
  return s;
}

function pickColumn(headers: string[], aliases: Set<string>): string | undefined {
  for (const h of headers) {
    if (aliases.has(normKey(h))) return h;
  }
  return undefined;
}

/** Guess CSV column → lead field mapping from headers. */
export function autoDetectCsvColumnMapping(headers: string[]): CsvColumnMapping | null {
  const phone = pickColumn(headers, PHONE_ALIASES);
  if (!phone) return null;
  return {
    phone,
    full_name: pickColumn(headers, NAME_ALIASES),
    email: pickColumn(headers, EMAIL_ALIASES),
    company_name: pickColumn(headers, COMPANY_ALIASES),
    notes: pickColumn(headers, NOTES_ALIASES),
  };
}

export function mapCsvRowsToLeads(
  rows: Record<string, string>[],
  mapping: CsvColumnMapping,
): CsvLeadRow[] {
  const out: CsvLeadRow[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const rawPhone = row[mapping.phone] ?? "";
    const phone = normalizeLeadPhone(rawPhone);
    if (!phone || phone.replace(/\D/g, "").length < 7) continue;
    if (seen.has(phone)) continue;
    seen.add(phone);

    out.push({
      phone,
      full_name: mapping.full_name ? row[mapping.full_name]?.trim() || null : null,
      email: mapping.email ? row[mapping.email]?.trim() || null : null,
      company_name: mapping.company_name ? row[mapping.company_name]?.trim() || null : null,
      notes: mapping.notes ? row[mapping.notes]?.trim() || null : null,
    });
  }

  return out;
}
