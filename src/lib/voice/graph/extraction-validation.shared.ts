/**
 * Semantic checks on an extracted variable before it is stored.
 *
 * `coerce` in llm.ts only understood `number` and `boolean`; every string field accepted anything,
 * and enum `choices` were never enforced. So when the extraction model put the caller's email into
 * `mobile_number`, it was stored as the mobile number and read back on the call.
 *
 * Retell-parity rule: a value that is the wrong kind for its field is treated as NOT captured.
 * The variable stays empty, and the missing-variable rule then makes the agent ask for it again —
 * which is far better than confidently repeating the wrong thing.
 *
 * Kind is inferred from the field's name and description, because builder variables are almost
 * always declared as plain `string` regardless of what they hold.
 *
 * Relative imports only — reachable from the voice gateway bundle.
 */

import type { VariableValue } from "./types";

export type ExtractField = {
  name: string;
  description?: string;
  type?: string;
  choices?: string[];
};

export type FieldKind = "email" | "phone" | "person_name" | "postcode" | "generic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** What sort of value a field is meant to hold. */
export function inferFieldKind(field: ExtractField): FieldKind {
  const hay = `${field.name} ${field.description ?? ""}`.toLowerCase().replace(/[_\-.]/g, " ");
  // Order matters: "email" must win over a description that also says "contact".
  if (/\be ?mail\b/.test(hay)) return "email";
  if (/\b(phone|mobile|cell|telephone|tel|whatsapp|contact number|phone number)\b/.test(hay)) {
    return "phone";
  }
  if (/\b(post ?code|zip ?code|zip|postal)\b/.test(hay)) return "postcode";
  if (
    /\b(first name|last name|full name|surname|forename|name)\b/.test(hay) &&
    !/\b(company|business|street|road|property|building|file|user ?name)\b/.test(hay)
  ) {
    return "person_name";
  }
  return "generic";
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * The value to store, or null when it is the wrong kind for the field.
 *
 * Null means "not captured" — the caller keeps asking — never "store an empty string".
 */
export function validateExtractedValue(field: ExtractField, value: VariableValue): VariableValue {
  if (value === null || value === undefined) return null;

  // Enum: must be one of the declared choices. Matched case- and space-insensitively and returned
  // in the builder's own spelling, so downstream branch conditions compare exactly.
  if (field.choices && field.choices.length > 0) {
    const want = String(value).trim().toLowerCase().replace(/\s+/g, " ");
    const hit = field.choices.find((c) => c.trim().toLowerCase().replace(/\s+/g, " ") === want);
    return hit ?? null;
  }

  // Numbers and booleans are already typed by `coerce`; only strings need checking.
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (!text) return null;

  switch (inferFieldKind(field)) {
    case "email": {
      // Speech-to-text often writes "jane at acme dot com". Normalise that before judging.
      const spoken = text
        .toLowerCase()
        .replace(/\s+at\s+/g, "@")
        .replace(/\s+dot\s+/g, ".")
        .replace(/\s+/g, "");
      return EMAIL_RE.test(spoken) ? spoken : null;
    }
    case "phone": {
      // An email, or anything with letters in it, is not a phone number — this is the exact
      // failure seen on the test call.
      if (text.includes("@")) return null;
      if (/[a-z]{3,}/i.test(text.replace(/\b(ext|extension|plus)\b/gi, ""))) return null;
      const d = digitsOnly(text);
      if (d.length < 7 || d.length > 15) return null;
      return text.trim().startsWith("+") ? `+${d}` : d;
    }
    case "person_name": {
      if (text.includes("@")) return null;
      // Mostly digits is a number that landed in the wrong field, not a name.
      if (digitsOnly(text).length >= Math.max(4, text.replace(/\s/g, "").length / 2)) return null;
      return text;
    }
    case "postcode": {
      if (text.includes("@")) return null;
      return text.length <= 12 ? text.toUpperCase() : null;
    }
    default:
      return text;
  }
}

const DIGIT_WORDS: Record<string, string> = {
  zero: "0",
  oh: "0",
  o: "0",
  nought: "0",
  nil: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
};
const REPEAT_WORDS: Record<string, number> = { double: 2, triple: 3 };

/**
 * Rewrite a spoken phone number as numerals, deterministically.
 *
 * Asking the extraction model to do this was unreliable in both directions: "double oh" dropped a
 * zero ("0770900123" for 07700 900123), and adding worked examples to the prompt made it insert
 * digits instead ("077700900123", a tripled seven). A number is exactly the thing that should not
 * be left to a language model, so the caller's words are converted here and the model only has to
 * copy digits.
 *
 * Only a run that yields at least 6 digits is rewritten, so "I want one bedroom" or "two of them"
 * are left alone — this is for phone numbers, not every number word in the sentence.
 */
export function normaliseSpokenNumbers(text: string): string {
  if (!text) return text;
  const tokens = text.split(/(\s+|,|;)/);
  const out: string[] = [];
  let run: string[] = []; // original tokens of the current number run
  let digits = "";
  let pendingRepeat = 0;

  const flush = () => {
    if (digits.length >= 6) {
      // Keep a leading "plus" as a proper international prefix.
      out.push(digits);
    } else {
      out.push(...run);
    }
    run = [];
    digits = "";
    pendingRepeat = 0;
  };

  for (const tok of tokens) {
    const word = tok
      .trim()
      .toLowerCase()
      .replace(/[.!?]$/, "");
    const isSep = !tok.trim() || tok === "," || tok === ";";

    if (isSep) {
      // Separators inside a number run are swallowed; outside one they pass through.
      if (run.length) run.push(tok);
      else out.push(tok);
      continue;
    }
    if (word === "plus" && run.length === 0) {
      run.push(tok);
      digits += "+";
      continue;
    }
    if (word in REPEAT_WORDS) {
      run.push(tok);
      pendingRepeat = REPEAT_WORDS[word]!;
      continue;
    }
    if (word === "hundred" && run.length) {
      run.push(tok);
      digits += "00";
      continue;
    }
    if (word === "thousand" && run.length) {
      run.push(tok);
      digits += "000";
      continue;
    }
    if (word === "and" && run.length) {
      run.push(tok);
      continue;
    }
    const d = DIGIT_WORDS[word] ?? (/^\d+$/.test(word) ? word : undefined);
    if (d !== undefined) {
      run.push(tok);
      digits += pendingRepeat > 1 && d.length === 1 ? d.repeat(pendingRepeat) : d;
      pendingRepeat = 0;
      continue;
    }
    // Anything else ends the run.
    if (run.length) flush();
    out.push(tok);
  }
  if (run.length) flush();

  return out
    .join("")
    .replace(/\+\s*/g, "+")
    .replace(/[ \t]{2,}/g, " ");
}
