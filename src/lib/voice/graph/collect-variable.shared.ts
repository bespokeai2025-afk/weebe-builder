/**
 * Bind a caller answer to the variable this collect node is asking for.
 */

import { referencedTemplateVars } from "./speech-prompt.shared";

const FIELD_HINTS: Array<[RegExp, string[]]> = [
  [/\b(preferred\s+)?title|mr|mrs|miss|ms\b/i, ["title", "preferred_title", "salutation"]],
  [/\bfirst\s*name|forename|given name\b/i, ["first_name", "firstname", "given_name"]],
  [/\blast\s*name|surname|family name\b/i, ["last_name", "lastname", "surname"]],
  [/\bfull name|\byour name\b|\bname\b/i, ["full_name", "name", "caller_name"]],
  [/\bpost\s*code|zip\s*code|zipcode\b/i, ["postcode", "post_code", "zip", "zip_code"]],
  [/\bphone|mobile|contact number|telephone\b/i, ["phone", "mobile", "phone_number", "contact_number"]],
  [/\be-?mail\b/i, ["email", "email_address"]],
  [/\baddress|street|property address\b/i, ["address", "property_address"]],
  [/\bowner|own the property\b/i, ["owner", "property_owner"]],
  [/\bproperty type|house or flat|bungalow\b/i, ["property_type", "type"]],
];

export function inferCollectVariableName(
  instruction: string,
  declaredNames: string[],
): string | null {
  const names = declaredNames.map((n) => n.trim()).filter(Boolean);
  if (names.length === 0) return null;

  const refs = referencedTemplateVars(instruction).filter((n) =>
    names.some((d) => d.toLowerCase() === n.toLowerCase()),
  );
  if (refs.length === 1) {
    return names.find((d) => d.toLowerCase() === refs[0]!.toLowerCase()) ?? refs[0]!;
  }

  const lowerNames = new Map(names.map((n) => [n.toLowerCase(), n]));
  for (const [hint, candidates] of FIELD_HINTS) {
    if (!hint.test(instruction)) continue;
    for (const candidate of candidates) {
      const hit = lowerNames.get(candidate.toLowerCase());
      if (hit) return hit;
    }
  }

  for (const name of names) {
    const label = name.replace(/_/g, "[ _]?");
    if (new RegExp(`\\b${label}\\b`, "i").test(instruction)) return name;
  }
  return null;
}

export function shouldCaptureCollectAnswer(userText: string): boolean {
  const t = userText.trim();
  if (!t || t.length < 2) return false;
  if (/^(yes|yeah|yep|yup|no|nope|nah|ok|okay|oke|sure|hello|hi|hey|what|huh|pardon)\.?$/i.test(t)) {
    return false;
  }
  if (/\?/.test(t) || /^(who|what|why|how|when|where)\b/i.test(t)) return false;
  return true;
}
