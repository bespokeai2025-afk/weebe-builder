/**
 * Cheshire clinic date helpers — Europe/London, no UTC date drift.
 */
const TZ = "Europe/London";

export function londonTodayYmd(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}

export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const base = Date.UTC(y, m - 1, d);
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(
    new Date(base + days * 86_400_000),
  );
}

export function normalizeAvailabilityRange(
  startDate: string | undefined,
  endDate: string | undefined,
): { start: string; end: string; adjusted: boolean } {
  const today = londonTodayYmd();
  let adjusted = false;
  let start = (startDate ?? "").trim().slice(0, 10);
  let end = (endDate ?? "").trim().slice(0, 10);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) {
    start = today;
    adjusted = true;
  }
  if (start < today) {
    start = today;
    adjusted = true;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    end = addDaysYmd(start, 14);
    adjusted = true;
  }
  if (end < start) {
    end = addDaysYmd(start, 14);
    adjusted = true;
  }
  const maxEnd = addDaysYmd(start, 21);
  if (end > maxEnd) {
    end = maxEnd;
    adjusted = true;
  }
  return { start, end, adjusted };
}

function londonNow(): { ymd: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  return {
    ymd: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

export function dayOfWeekLondon(ymd: string): number {
  const noon = new Date(`${ymd}T12:00:00`);
  const wd = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short" }).format(noon);
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return map[wd.slice(0, 3)] ?? 0;
}

export function slotIsFutureInLondon(startDate: string, hour: number, minute: number): boolean {
  const now = londonNow();
  if (startDate > now.ymd) return true;
  if (startDate < now.ymd) return false;
  return hour * 60 + minute > now.minutes;
}

export function* iterateYmdRange(start: string, end: string): Generator<string> {
  let cur = start;
  let guard = 0;
  while (cur <= end && guard < 45) {
    yield cur;
    cur = addDaysYmd(cur, 1);
    guard++;
  }
}
