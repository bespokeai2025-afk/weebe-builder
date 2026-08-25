import { WBAH_TIMEZONE } from "@/lib/dashboard/wbah-timezone";

/** Normalize "2:30 PM", "14:30", "14:30:00" → "HH:mm" (24h). */
export function normalizeUkTime24(timePart: string): string | null {
  const raw = String(timePart ?? "").trim();
  if (!raw) return null;

  const ampm = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)$/i);
  if (ampm) {
    let h = Number(ampm[1]);
    const m = ampm[2];
    const mer = ampm[3].toLowerCase();
    if (mer === "pm" && h < 12) h += 12;
    if (mer === "am" && h === 12) h = 0;
    return `${String(h).padStart(2, "0")}:${m}`;
  }

  const hm = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (hm) return `${String(Number(hm[1])).padStart(2, "0")}:${hm[2]}`;

  return null;
}

/**
 * Convert a UK wall-clock date+time (Europe/London) to a UTC Date.
 * Handles BST/GMT via Intl iteration (no extra deps).
 */
export function ukLocalToUtcDate(datePart: string, timePart: string): Date | null {
  const dateMatch = String(datePart).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const time24 = normalizeUkTime24(timePart);
  if (!dateMatch || !time24) return null;

  const y = Number(dateMatch[1]);
  const m = Number(dateMatch[2]);
  const d = Number(dateMatch[3]);
  const [hh, mm] = time24.split(":").map(Number);
  if ([y, m, d, hh, mm].some((n) => Number.isNaN(n))) return null;

  let utcMs = Date.UTC(y, m - 1, d, hh, mm, 0);
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: WBAH_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const desiredFakeUtc = Date.UTC(y, m - 1, d, hh, mm, 0);
  for (let i = 0; i < 4; i++) {
    const parts = fmt.formatToParts(new Date(utcMs));
    const get = (type: string) =>
      Number(parts.find((p) => p.type === type)?.value ?? NaN);
    const londonFakeUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
    const delta = desiredFakeUtc - londonFakeUtc;
    if (delta === 0) break;
    utcMs += delta;
  }

  const out = new Date(utcMs);
  return Number.isNaN(out.getTime()) ? null : out;
}

export function ukLocalToUtcIso(datePart: string, timePart: string): string | null {
  const d = ukLocalToUtcDate(datePart, timePart);
  return d ? d.toISOString() : null;
}

export function addMinutesIso(iso: string, minutes: number): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCMinutes(d.getUTCMinutes() + minutes);
  return d.toISOString();
}

/** Normalize callback_datetime (naive UK local) → UTC ISO — mirrors n8n POST dashboard body. */
export function normalizeCallbackDatetimeUtc(raw: string | null | undefined): string | null {
  const cb = String(raw ?? "").trim();
  if (!cb || cb === "NA") return null;

  try {
    if (/Z|[+-]\d{2}:?\d{2}$/.test(cb)) {
      return new Date(cb).toISOString();
    }
    const [datePart, timePart = "00:00:00"] = cb.split("T");
    const [y, m, day] = datePart.split("-").map(Number);
    const [hh, mm, ss = 0] = timePart.split(":").map(Number);
    const tmpUTC = new Date(Date.UTC(y, m - 1, day, hh, mm, ss));
    const ukFmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: WBAH_TIMEZONE,
      timeZoneName: "shortOffset",
    });
    const parts = ukFmt.formatToParts(tmpUTC);
    const offPart = parts.find((p) => p.type === "timeZoneName")?.value || "GMT";
    const off = offPart.match(/GMT([+-]\d+)?/);
    const offHrs = off && off[1] ? Number(off[1]) : 0;
    return new Date(Date.UTC(y, m - 1, day, hh - offHrs, mm, ss)).toISOString();
  } catch {
    return cb.endsWith("Z") ? cb : `${cb}Z`;
  }
}
