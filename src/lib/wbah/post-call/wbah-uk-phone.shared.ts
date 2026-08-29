/** Normalize UK mobiles for Dynamics — collapse duplicate +, keep national 07… format. */

const UK_MOBILE = /^07\d{9}$/;

export function isValidWbahUkMobile(digits: string): boolean {
  return UK_MOBILE.test(digits);
}

/** Returns national 07XXXXXXXXX, or "" if the number is not a valid UK mobile. */
export function normalizeWbahUkMobilePhone(raw: string): string {
  let s = raw.trim();
  if (!s) return s;

  s = s.replace(/^\++/, "+");
  while (s.startsWith("++")) {
    s = `+${s.slice(2).replace(/^\++/, "")}`;
  }

  let digits = s.replace(/\D/g, "");
  if (!digits) return "";

  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("44")) digits = `0${digits.slice(2)}`;
  if (!digits.startsWith("0") && digits.length === 10 && digits.startsWith("7")) {
    digits = `0${digits}`;
  }

  if (!isValidWbahUkMobile(digits)) return "";
  return digits;
}
