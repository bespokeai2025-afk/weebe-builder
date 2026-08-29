/**
 * WBAH post-call email guards — never write STT garbage or staff mailboxes to CRM.
 */

const STAFF_DOMAIN = /@webuyanyhouse\.co\.uk$/i;

export function isValidWbahEmail(raw: unknown): boolean {
  if (raw == null) return false;
  const s = String(raw).trim();
  if (!s || /\s/.test(s)) return false;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return false;
  return true;
}

export function isWbahStaffMailbox(raw: unknown): boolean {
  if (!isValidWbahEmail(raw)) return false;
  return STAFF_DOMAIN.test(String(raw).trim());
}

/**
 * Prefer verified_details.emailaddress1, then analysis email_address, then inbound {{email}}.
 * Drops spaced STT, invalids, and @webuyanyhouse.co.uk (prompt-example leak).
 */
export function pickWbahCrmEmail(
  ...candidates: unknown[]
): string | null {
  for (const raw of candidates) {
    if (raw == null) continue;
    const s = String(raw).trim();
    if (!isValidWbahEmail(s)) continue;
    if (isWbahStaffMailbox(s)) continue;
    return s.toLowerCase();
  }
  return null;
}
