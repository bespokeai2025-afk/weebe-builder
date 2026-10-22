/**
 * Callback asked for, but no time given → next working day at the same UK time.
 *
 * Retell only fills callback_datetime when the caller names a time. "I'm busy",
 * "call me later", "you're breaking up" left the lead in Tried To Contact, and the
 * morning cannot-contact sweep then disqualified it (audit: Saeed Toumeh).
 * WBAH's rule (Oct 2026): default to the next working day (Mon–Fri) at the time
 * of the original call. UK bank holidays are not skipped.
 */
import { WBAH_TIMEZONE } from "@/lib/dashboard/wbah-timezone";
import { ukLocalToUtcIso } from "./wbah-uk-datetime.shared";

/** Phrases that say a callback was NOT asked for — removed before matching. */
const NOT_REQUESTED =
  /\b(?:no|without\s+(?:a|any))\s+call\s*backs?\s+(?:was\s+|were\s+)?(?:requested|arranged|needed|agreed)?|\bdid\s*(?:not|n['’]t)\s+(?:request|want|ask\s+for)\s+(?:a\s+)?call\s*back\b|\bdeclined\s+(?:a\s+)?call\s*back\b/gi;

const CALLBACK_WITHOUT_TIME: RegExp[] = [
  // asked for one
  /\b(?:requested|requesting|asked\s+for|wants?|wanted|would\s+like|agreed\s+to|arranged)\s+(?:a\s+|another\s+)?(?:call\s*back|follow-?up\s+call|call\s+later)\b/i,
  /\basked\s+(?:to\s+be|us\s+to|the\s+agent\s+to)\s+(?:called|call|ring|phone)\s+(?:(?:them|her|him)\s+)?back\b/i,
  /\b(?:call|ring|phone|try)\s+(?:them|her|him|me)?\s*(?:back\s+|again\s+)?(?:later|another\s+time|at\s+a\s+(?:later|better)\s+time)\b/i,
  /\b(?:reschedule|rearrange)\s+the\s+call\b/i,
  // busy / at work / driving (sheet rows 82–85)
  // the caller is busy — not "all operators were busy" on someone's switchboard
  /\b(?:user|caller|they|she|he|vendor|customer|homeowner)\b[^.]{0,25}?\b(?:was|were|is|are|being)\s+(?:currently\s+)?(?:too\s+)?(?:busy|at\s+work|driving|in\s+a\s+meeting)\b/i,
  /\b(?:user|caller|they|she|he)\s+(?:was|were|is|are)\s+(?:currently\s+)?driving\b|\bwhile\s+driving\b/i,
  /\b(?:had|has|have)\s*(?:n['’]t|\s+not|\s+no)\s+(?:got\s+)?time\b/i,
  // line trouble (rows 95–96)
  /\b(?:could|can)\s*(?:not|n['’]t)\s+hear\b/i,
  /\b(?:breaking\s+up|(?:bad|poor)\s+(?:line|signal|connection|reception))\b/i,
];

export function summaryAsksForCallbackWithoutTime(...summaries: Array<string | null | undefined>): boolean {
  const text = summaries
    .map((s) => String(s ?? "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(NOT_REQUESTED, " ");
  if (!text.trim()) return false;
  return CALLBACK_WITHOUT_TIME.some((re) => re.test(text));
}

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function londonParts(ms: number) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: WBAH_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: get("hour") === "24" ? "00" : get("hour"),
    minute: get("minute"),
    weekday: WEEKDAY_INDEX[get("weekday")] ?? 1,
  };
}

/**
 * Next Mon–Fri after the call's UK date, at the call's UK wall-clock time.
 * `local` is a naive Europe/London "YYYY-MM-DDTHH:mm:00" (what Retell's
 * callback_datetime looks like); `utc` is the matching instant.
 */
export function nextWorkingDaySameUkTime(fromMs: number): { local: string; utc: string } | null {
  const p = londonParts(fromMs);
  if (!p.year) return null;
  const date = new Date(Date.UTC(p.year, p.month - 1, p.day));
  let weekday = p.weekday;
  do {
    date.setUTCDate(date.getUTCDate() + 1);
    weekday = (weekday + 1) % 7;
  } while (weekday === 0 || weekday === 6);
  const ymd = date.toISOString().slice(0, 10);
  const time = `${p.hour}:${p.minute}`;
  const utc = ukLocalToUtcIso(ymd, time);
  return utc ? { local: `${ymd}T${time}:00`, utc } : null;
}
