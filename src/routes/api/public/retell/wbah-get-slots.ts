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

/** yyyy-MM-dd of today in London time. */
function todayInLondon(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: WBAH_TZ }).format(
    new Date(),
  );
}

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
 *
 * Strategy (priority order):
 *   1. Earliest slot today (or earliest overall if no today slots).
 *   2. Earliest slot on a DIFFERENT day from slot 1 (prefer tomorrow or next
 *      working day over another same-day time, so caller hears real options).
 *   3. Earliest slot on a DIFFERENT day from both prior picks (or 3+ hours
 *      later on the same day if no third day exists).
 *
 * This ensures the agent says "10 AM today, 2 PM tomorrow, 11 AM Thursday"
 * rather than exhausting every same-day slot before mentioning future dates.
 */
function pickSpoken(slots: DisplaySlot[], n: number): DisplaySlot[] {
  if (slots.length <= n) return slots;

  const chosen: DisplaySlot[] = [slots[0]];

  if (n >= 2) {
    // Strongly prefer a slot on a different day for slot 2
    const diffDay = slots.find(
      (s) => !chosen.includes(s) && s.date !== chosen[0].date,
    );
    if (diffDay) {
      chosen.push(diffDay);
    } else {
      // Same day — at least 3 hours later
      const laterToday = slots.find(
        (s) =>
          !chosen.includes(s) &&
          new Date(s.utc).getTime() - new Date(chosen[0].utc).getTime() >=
            3 * 3600 * 1000,
      );
      chosen.push(laterToday ?? slots[1]);
    }
  }

  if (n >= 3) {
    const usedDates = new Set(chosen.map((s) => s.date));
    // Prefer a third distinct day
    const thirdDay = slots.find(
      (s) => !chosen.includes(s) && !usedDates.has(s.date),
    );
    if (thirdDay) {
      chosen.push(thirdDay);
    } else {
      // Same days — pick something 2+ hours after the last chosen
      const last = chosen[chosen.length - 1];
      const later = slots.find(
        (s) =>
          !chosen.includes(s) &&
          new Date(s.utc).getTime() - new Date(last.utc).getTime() >=
            2 * 3600 * 1000,
      );
      if (later) chosen.push(later);
    }
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

        // Detect the {{current_date}} Retell default: if the preferred_date
        // equals today in London time, treat it as "no preference" and search
        // the full 7-day forward window.  This prevents the agent from burning
        // through every today-slot before the caller can ask for tomorrow.
        const today = todayInLondon();
        const effectiveDate =
          rawPreferredDate === today ? null : rawPreferredDate;

        if (!effectiveDate) {
          // No date preference (or default current_date) → search from now for 7 days
          windowStart = now.toISOString();
          windowEnd = new Date(
            now.getTime() + MAX_WINDOW_DAYS * 24 * 3600 * 1000,
          ).toISOString();
        } else if (isWeekend(effectiveDate)) {
          // Weekend requested → advance to next weekday
          requestedDayName = weekdayLabel(effectiveDate);
          fallbackUsed = true;
          const nextWd = nextWeekdayAfter(effectiveDate);
          windowStart = dayWindowUtc(nextWd).start;
          windowEnd = dayWindowUtc(addDays(nextWd, MAX_WINDOW_DAYS - 1)).end;
        } else {
          // Caller explicitly named a future weekday → search that day first
          requestedDayName = weekdayLabel(effectiveDate);
          const { start, end } = dayWindowUtc(effectiveDate);
          windowStart = start;
          windowEnd = end;
        }

        // ── First Calendly call ─────────────────────────────────────────────
        let times = await getWbahCalendlyAvailableTimes(windowStart, windowEnd);

        // ── Fallback: specific future weekday was empty → search next 7 days ─
        if (
          effectiveDate &&
          !isWeekend(effectiveDate) &&
          times.length === 0
        ) {
          fallbackUsed = true;
          const dayAfter = addDays(effectiveDate, 1);
          const weekAfter = addDays(effectiveDate, MAX_WINDOW_DAYS);
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
          effective_date: effectiveDate ?? "(7-day window)",
          today_override: rawPreferredDate === today,
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
