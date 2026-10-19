/** Shared duration labels for call tables. */

/** Seconds → "3m 12s" ("—" when missing or zero). Calls, Receptionist and Telephony tables. */
export function formatCallSeconds(s?: number | null): string {
  if (!s) return "—";
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${r}s`;
}

/** Milliseconds → "3m 12s" / "45s" ("—" when missing). Leads and Qualified tables. */
export function formatCallMs(ms: number | null): string {
  if (ms == null) return "—";
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}
