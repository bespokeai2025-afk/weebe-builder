/** Stable visual roles shared by dashboard and analytics; no data fetching. */
export const CHART = {
  primary: "var(--viz-blue)", primaryGlow: "var(--viz-blue)",
  leads: "var(--viz-violet)", accent: "var(--viz-teal)",
  success: "var(--success)", warning: "var(--warning)", danger: "var(--destructive)",
  neutral: "var(--muted-foreground)", pink: "var(--viz-pink)", orange: "var(--warning)",
  grid: "var(--border)", axis: "var(--muted-foreground)",
};

export function coloredSlices<T extends { value: number }>(data: T[], colors: string[]) {
  return data.map((item, index) => ({ ...item, color: colors[index % colors.length] }))
    .filter(item => item.value > 0);
}

/** Expand calendar-date buckets without using browser-local dates or crossing DST. */
export function dailySeries(
  rows: { day: string; count: number }[],
  range: { startIso: string; endIso: string; timezone?: string },
) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: range.timezone || "UTC", year: "numeric", month: "2-digit", day: "2-digit",
  });
  const calendarDay = (ms: number) => {
    const parts = formatter.formatToParts(new Date(ms));
    const part = (type: string) => parts.find(p => p.type === type)?.value;
    return `${part("year")}-${part("month")}-${part("day")}`;
  };
  const start = Date.parse(range.startIso), end = Date.parse(range.endIso);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  const first = Date.parse(`${calendarDay(start)}T00:00:00Z`);
  const last = Date.parse(`${calendarDay(end - 1)}T00:00:00Z`);
  const counts = new Map(rows.map(row => [row.day, row.count]));
  const result: { date: string; count: number }[] = [];
  for (let cursor = first; cursor <= last && result.length < 366; cursor += 86_400_000) {
    const date = new Date(cursor).toISOString().slice(0, 10);
    result.push({ date, count: counts.get(date) ?? 0 });
  }
  return result;
}
