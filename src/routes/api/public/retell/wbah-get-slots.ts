/**
 * POST /api/public/retell/wbah-get-slots
 *
 * WBAH-specific Retell custom-function webhook for slot availability.
 * Replaces the WeeBespoke UAT endpoint so that:
 *
 *   1. Only genuinely bookable Calendly start times are returned (no fake
 *      5-minute interval generation).
 *   2. A null / missing preferred_date searches forward across the next 7 days
 *      rather than locking onto today's date.
 *   3. A weekend preferred_date automatically falls through to the next weekday.
 *   4. A weekday preferred_date that has no availability falls through to the
 *      next 7 days and indicates this in the message.
 *   5. slot_message (the `message` field) offers only 2-3 spoken options so the
 *      agent doesn't read out hundreds of times.
 *
 * Contract (must match WeeBespoke's existing response shape so the Retell flow
 * and the Book Appointment node need no changes):
 *
 *   { success, slot_count, slots: [{date, time}], message }
 *
 * The Retell flow node maps  message → slot_message  dynvar.
 */

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { normalizeRetellPayload } from "@/lib/calendar/retell-payload";
import { getWbahCalendlyAvailableTimes } from "@/lib/wbah/post-call/wbah-calendly.server";

// ─── constants ───────────────────────────────────────────────────────────────

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const WBAH_TZ = "Europe/London";
const MAX_WINDOW_DAYS = 7;
const DEFAULT_LIMIT = 12;
/** How many slots to mention aloud in the message. */
const SPOKEN_SLOTS = 3;

// ─── schema ──────────────────────────────────────────────────────────────────

const Body = z.object({
  /** How many slots to include in the slots[] array.  Defaults to 12. */
  limit: z.coerce.number().int().min(1).max(50).optional(),
  /**
   * yyyy-MM-dd in London time, or null / absent.
   * If absent → search from now across the next 7 days.
   * If a weekend → advance to next weekday.
   * If a full weekday with no slots → fall through to next 7 days.
   */
  preferred_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});

// ─── date helpers ─────────────────────────────────────────────────────────────

/** yyyy-MM-dd → true when the date falls on a Saturday or Sunday (London TZ). */
function isWeekend(dateStr: string): boolean {
  // noon UTC is unambiguous for day-of-week in any UTC+offset zone
  const dow = new Date(dateStr + "T12:00:00Z").getUTCDay();
  return dow === 0 || dow === 6; // Sunday or Saturday
}

/** Advance a yyyy-MM-dd string by n calendar days. */
function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Return the next weekday (Mon–Fri) strictly after dateStr. */
function nextWeekdayAfter(dateStr: string): string {
  let cur = dateStr;
  for (let i = 0; i < 8; i++) {
    cur = addDays(cur, 1);
    if (!isWeekend(cur)) return cur;
  }
  return cur; // shouldn't be reached
}

/**
 * Full UTC window for a yyyy-MM-dd date.
 * Using midnight–midnight UTC captures all London business hours whether BST or GMT.
 */
function dayWindowUtc(dateStr: string): { start: string; end: string } {
  return {
    start: dateStr + "T00:00:00.000Z",
    end: dateStr + "T23:59:59.000Z",
  };
}

// ─── formatting helpers ───────────────────────────────────────────────────────

interface DisplaySlot {
  date: string; // yyyy-MM-dd (London)
  time: string; // e.g. "9:00 AM" or "2:30 PM"
  utc: string;  // original UTC ISO for slot picking logic
}

function toDisplaySlot(utcIso: string): DisplaySlot {
  const d = new Date(utcIso);
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: WBAH_TZ }).format(d); // yyyy-MM-dd
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: WBAH_TZ,
  })
    .format(d)
    .toUpperCase(); // "9:00 AM" / "2:30 PM"
  return { date, time, utc: utcIso };
}

function weekdayLabel(dateStr: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    timeZone: WBAH_TZ,
  }).format(new Date(dateStr + "T12:00:00Z")); // "Monday", "Tuesday" …
}

// ─── spoken slot selection ────────────────────────────────────────────────────

/**
 * Choose up to `n` slots spread across times/days for the spoken message.
 * Strategy: earliest available, then something 3+ hours later or a different day,
 * then something on a different day if possible.
 */
function pickSpoken(slots: DisplaySlot[], n: number): DisplaySlot[] {
  if (slots.length <= n) return slots;

  const chosen: DisplaySlot[] = [slots[0]];

  if (n >= 2) {
    const second = slots.find(
      (s) =>
        !chosen.includes(s) &&
        (s.date !== chosen[0].date ||
          new Date(s.utc).getTime() - new Date(chosen[0].utc).getTime() >=
            3 * 3600 * 1000),
    );
    chosen.push(second ?? slots[1]);
  }

  if (n >= 3) {
    const last = chosen[chosen.length - 1];
    const third = slots.find(
      (s) =>
        !chosen.includes(s) &&
        (s.date !== chosen[0].date ||
          new Date(s.utc).getTime() - new Date(last.utc).getTime() >=
            2 * 3600 * 1000),
    );
    if (third) chosen.push(third);
  }

  return chosen;
}

// ─── message builder ─────────────────────────────────────────────────────────

function buildMessage(
  spoken: DisplaySlot[],
  requestedDayName: string | null,
  fallbackUsed: boolean,
): string {
  if (spoken.length === 0) {
    if (requestedDayName && fallbackUsed) {
      return (
        `There are no appointments available on ${requestedDayName} ` +
        `and I couldn't find anything in the next week either. ` +
        `Ask if they would like a callback instead.`
      );
    }
    return (
      "No appointment slots are available in the next week. " +
      "Ask if they would like a callback instead."
    );
  }

  // Group by display date for natural phrasing
  const byDate = new Map<string, { label: string; times: string[] }>();
  for (const s of spoken) {
    if (!byDate.has(s.date)) {
      byDate.set(s.date, { label: weekdayLabel(s.date), times: [] });
    }
    byDate.get(s.date)!.times.push(s.time);
  }

  const parts: string[] = [];
  for (const { label, times } of byDate.values()) {
    // "Monday at 9:00 AM or 2:30 PM" / "Monday at 9:00 AM"
    parts.push(`${label} at ${times.join(" or ")}`);
  }

  const intro =
    requestedDayName && fallbackUsed
      ? `There's nothing available on ${requestedDayName}, but I do have `
      : "I have ";

  const options =
    parts.length === 1
      ? parts[0]
      : parts.length === 2
        ? `${parts[0]}, or ${parts[1]}`
        : `${parts.slice(0, -1).join(", ")}, or ${parts[parts.length - 1]}`;

  return `${intro}${options}. Which would work best?`;
}

// ─── route ────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/api/public/retell/wbah-get-slots")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),

      POST: async ({ request }) => {
        const rawBody = await request.text();

        // Retell sends { name, args: { limit, preferred_date }, call: {...} }.
        // normalizeRetellPayload flattens args into the root.
        const flat = normalizeRetellPayload(rawBody);
        const parsed = Body.safeParse(flat);

        const limit = parsed.success
          ? (parsed.data.limit ?? DEFAULT_LIMIT)
          : DEFAULT_LIMIT;
        const rawPreferredDate = parsed.success
          ? (parsed.data.preferred_date ?? null)
          : null;

        // ── Determine search window ─────────────────────────────────────────
        const now = new Date();
        let requestedDayName: string | null = null;
        let fallbackUsed = false;
        let windowStart: string;
        let windowEnd: string;

        if (!rawPreferredDate) {
          // No date preference → search from now for 7 days
          windowStart = now.toISOString();
          windowEnd = new Date(
            now.getTime() + MAX_WINDOW_DAYS * 24 * 3600 * 1000,
          ).toISOString();
        } else if (isWeekend(rawPreferredDate)) {
          // Weekend requested (or Saturday current_date bug) → next weekday
          requestedDayName = weekdayLabel(rawPreferredDate);
          fallbackUsed = true;
          const nextWd = nextWeekdayAfter(rawPreferredDate);
          windowStart = dayWindowUtc(nextWd).start;
          windowEnd = dayWindowUtc(addDays(nextWd, MAX_WINDOW_DAYS - 1)).end;
        } else {
          // Specific weekday → search that day only first
          requestedDayName = weekdayLabel(rawPreferredDate);
          const { start, end } = dayWindowUtc(rawPreferredDate);
          windowStart = start;
          windowEnd = end;
        }

        // ── First Calendly call ─────────────────────────────────────────────
        let times = await getWbahCalendlyAvailableTimes(windowStart, windowEnd);

        // ── Fallback: specific weekday was empty → search next 7 days ───────
        if (
          rawPreferredDate &&
          !isWeekend(rawPreferredDate) &&
          times.length === 0
        ) {
          fallbackUsed = true;
          const dayAfter = addDays(rawPreferredDate, 1);
          const weekAfter = addDays(rawPreferredDate, MAX_WINDOW_DAYS);
          times = await getWbahCalendlyAvailableTimes(
            dayWindowUtc(dayAfter).start,
            dayWindowUtc(weekAfter).end,
          );
        }

        // ── Format response ─────────────────────────────────────────────────
        const totalCount = times.length;
        const displaySlots = times.slice(0, limit).map((t) =>
          toDisplaySlot(t.start_time),
        );

        const spoken = pickSpoken(displaySlots, SPOKEN_SLOTS);
        const message = buildMessage(spoken, requestedDayName, fallbackUsed);

        console.log("[wbah-get-slots]", {
          preferred_date: rawPreferredDate,
          fallbackUsed,
          slot_count: totalCount,
          returned: displaySlots.length,
          spoken: spoken.length,
        });

        return new Response(
          JSON.stringify({
            success: true,
            slot_count: totalCount,
            slots: displaySlots.map(({ date, time }) => ({ date, time })),
            message,
          }),
          {
            status: 200,
            headers: { ...CORS, "Content-Type": "application/json" },
          },
        );
      },
    },
  },
});
