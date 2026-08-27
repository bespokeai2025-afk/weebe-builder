/** Normalize UK mobiles for Dynamics — collapse duplicate +, keep national 07… format. */

export function normalizeWbahUkMobilePhone(raw: string): string {
  let s = raw.trim();
  if (!s) return s;

  s = s.replace(/^\++/, "+");
  while (s.startsWith("++")) {
    s = `+${s.slice(2).replace(/^\++/, "")}`;
  }

  let digits = s.replace(/\D/g, "");
  if (!digits) return raw.trim();

  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("44")) digits = `0${digits.slice(2)}`;
  if (!digits.startsWith("0") && digits.length === 10 && digits.startsWith("7")) {
    digits = `0${digits}`;
  }

  return digits;
}
