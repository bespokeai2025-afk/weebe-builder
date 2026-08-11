import { z } from "zod";

const genderSchema = z.enum(["Male", "Female", "Other"]);

const dobSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "date_of_birth must be YYYY-MM-DD");

const baseSchema = z.object({
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  phone: z.string().min(5),
  is_new_client: z.boolean().optional(),
});

const newClientFieldsSchema = z.object({
  email: z.string().email(),
  gender: genderSchema,
  date_of_birth: dobSchema,
  preferred_language: z.string().min(1).optional(),
  how_did_you_hear_about_us: z.string().optional(),
});

export type DnrExistingClientInput = z.infer<typeof baseSchema> & { is_new_client?: false };
export type DnrNewClientInput = z.infer<typeof baseSchema> &
  z.infer<typeof newClientFieldsSchema> & { is_new_client: true };

export type DnrFindOrCreateClientInput = DnrExistingClientInput | DnrNewClientInput;

const MONTHS: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Normalize spoken / messy Retell args before validation. */
export function normalizeDnrFindOrCreateArgs(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") return {};
  const o = { ...(raw as Record<string, unknown>) };

  const phone = o.phone ?? o.mobile ?? o.phone_number;
  if (typeof phone === "string" && phone.trim()) o.phone = phone.trim();

  if (typeof o.is_new_client === "string") {
    const s = o.is_new_client.trim().toLowerCase();
    o.is_new_client = s === "true" || s === "yes" || s === "1" || s === "new";
  }

  if (typeof o.gender === "string") {
    const g = o.gender.trim().toLowerCase();
    if (g === "male" || g === "m") o.gender = "Male";
    else if (g === "female" || g === "f") o.gender = "Female";
    else if (g === "other" || g === "o") o.gender = "Other";
  }

  const dobRaw = o.date_of_birth ?? o.dob ?? o.date_of_birth_iso;
  if (typeof dobRaw === "string" && dobRaw.trim()) {
    const normalized = normalizeDateOfBirth(dobRaw.trim());
    if (normalized) o.date_of_birth = normalized;
  }

  if (typeof o.email === "string" && o.email.trim()) {
    o.email = normalizeEmail(o.email);
  }

  if (typeof o.first_name === "string") o.first_name = o.first_name.trim();
  if (typeof o.last_name === "string") o.last_name = o.last_name.trim();

  return o;
}

export function normalizeEmail(input: string): string {
  let e = input.trim().toLowerCase();
  e = e.replace(/\s+/g, " ");
  e = e.replace(/\s+at\s+/g, "@");
  e = e.replace(/\s+dot\s+/g, ".");
  e = e.replace(/\s*@\s*/g, "@");
  e = e.replace(/\s*\.\s*/g, ".");
  e = e.replace(/\s/g, "");
  return e;
}

export function normalizeDateOfBirth(input: string): string | null {
  const s = input.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const slash = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (slash) {
    const [, d, m, y] = slash;
    return `${y}-${pad2(Number(m))}-${pad2(Number(d))}`;
  }

  const isoLike = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (isoLike) {
    const [, y, m, d] = isoLike;
    return `${y}-${pad2(Number(m))}-${pad2(Number(d))}`;
  }

  const words = s
    .toLowerCase()
    .replace(/,/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ");
  if (words.length >= 3) {
    let day: number | null = null;
    let month: number | null = null;
    let year: number | null = null;
    for (const w of words) {
      const n = Number(w.replace(/\D/g, ""));
      if (MONTHS[w] != null) month = MONTHS[w];
      else if (/^\d{4}$/.test(w)) year = n;
      else if (/^\d{1,2}(st|nd|rd|th)?$/.test(w) && n >= 1 && n <= 31 && day == null) day = n;
    }
    if (day && month && year && year >= 1900 && year <= 2100) {
      return `${year}-${pad2(month)}-${pad2(day)}`;
    }
  }

  const parsed = Date.parse(s);
  if (!Number.isNaN(parsed)) {
    const d = new Date(parsed);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  return null;
}

function formatZodIssues(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.join(".") || "field"}: ${i.message}`).join("; ");
}

export function parseDnrFindOrCreateClient(
  args: unknown,
):
  | { ok: true; data: DnrFindOrCreateClientInput }
  | { ok: false; error: string; hint: string; missing?: string[] } {
  const normalized = normalizeDnrFindOrCreateArgs(args);
  const base = baseSchema.safeParse(normalized);
  if (!base.success) {
    return {
      ok: false,
      error: "first_name, last_name, and phone are required",
      hint: dnrNewClientValidationHint(),
      missing: base.error.issues.map((i) => i.path.join(".")).filter(Boolean),
    };
  }

  if (base.data.is_new_client !== true) {
    return { ok: true, data: base.data };
  }

  const extra = newClientFieldsSchema.safeParse(normalized);
  if (!extra.success) {
    const missing: string[] = [];
    if (!normalized.email) missing.push("email");
    if (!normalized.gender) missing.push("gender");
    if (!normalized.date_of_birth) missing.push("date_of_birth");
    return {
      ok: false,
      error: "New client requires email, gender, and date_of_birth",
      hint: `${dnrNewClientValidationHint()} Details: ${formatZodIssues(extra.error)}`,
      missing: missing.length ? missing : extra.error.issues.map((i) => i.path.join(".")),
    };
  }

  return {
    ok: true,
    data: {
      ...base.data,
      ...extra.data,
      preferred_language: extra.data.preferred_language ?? "English",
      is_new_client: true,
    },
  };
}

export function isDnrNewClientInput(input: DnrFindOrCreateClientInput): input is DnrNewClientInput {
  return input.is_new_client === true;
}

export function dnrNewClientValidationHint(): string {
  return "New clients: first_name, last_name, phone, email, gender (Male|Female|Other), date_of_birth (YYYY-MM-DD), is_new_client: true. Optional: preferred_language (English), how_did_you_hear_about_us.";
}

/** @deprecated use parseDnrFindOrCreateClient */
export const dnrFindOrCreateClientSchema = baseSchema;
