/**
 * WBAH-specific real-time Calendly slot availability endpoint.
 *
 * Called by the WBAH Retell agent's tool function during a live call to fetch
 * available appointment slots from Calendly. Unlike /api/public/retell/availability
 * (which is Cal.com only), this endpoint uses WBAH's Calendly credentials directly.
 *
 * Tool configuration in Retell:
 *   URL:    https://webeebuilder.com/api/public/retell/wbah-availability
 *   Method: POST
 *   Auth:   x-retell-signature header (verified against WBAH workspace key)
 *   Body:   { agent_id, start_date, end_date, timezone? }
 *           start_date / end_date: ISO date strings or ISO datetimes
 */
import { createFileRoute } from "@tanstack/react-router";
import { verifyRetellSignatureMultiKey } from "@/lib/calendar/retell-signature";
import { resolveRetellCandidateKeysByAgent } from "@/lib/calendar/retell-key-lookup";
import { normalizeRetellPayload } from "@/lib/calendar/retell-payload";
import {
  getWbahCalendlyAvailableSlots,
  isWbahCalendlyConfigured,
} from "@/lib/wbah/post-call/wbah-calendly.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-retell-signature",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

/** Ensure a date string becomes a full ISO datetime (midnight UTC if date-only). */
function toIsoDatetime(value: string): string {
  if (!value) return new Date().toISOString();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return `${value.trim()}T00:00:00.000Z`;
  }
  return value.trim();
}

/** Summarise slots for the agent prompt — grouped by day. */
function buildSummary(slots: Array<{ start: string; display: string }>): string {
  if (slots.length === 0) {
    return "No appointment slots are available in the next week. Ask if they would like a callback instead.";
  }
  // Group by date (Europe/London)
  const dayMap = new Map<string, string[]>();
  for (const s of slots) {
    const d = new Date(s.start);
    const dateKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(d);
    const timePart = new Intl.DateTimeFormat("en-GB", {
      hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Europe/London",
    }).format(d).toUpperCase();
    if (!dayMap.has(dateKey)) dayMap.set(dateKey, []);
    dayMap.get(dateKey)!.push(timePart);
  }
  const dayParts: string[] = [];
  for (const [, times] of dayMap) {
    const displayDay = new Intl.DateTimeFormat("en-GB", {
      weekday: "long", day: "numeric", month: "long", timeZone: "Europe/London",
    }).format(new Date(slots[dayParts.length === 0 ? 0 : dayParts.length]?.start ?? slots[0].start));
    dayParts.push(`on ${displayDay}: ${times.join(", ")}`);
  }
  return `I found ${slots.length} available slot${slots.length !== 1 ? "s" : ""}. ${dayParts.join("; ")}.`;
}

export const Route = createFileRoute("/api/public/retell/wbah-availability")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const rawBody = await request.text();
        const sig = request.headers.get("x-retell-signature");

        // Identify agent for key lookup
        let bodyAgentId: string | undefined;
        try {
          const quick = JSON.parse(rawBody) as Record<string, unknown>;
          const args = (quick.args ?? {}) as Record<string, unknown>;
          const call = (quick.call ?? {}) as Record<string, unknown>;
          bodyAgentId =
            (args.agent_id as string) ??
            (call.agent_id as string) ??
            (quick.agent_id as string) ??
            undefined;
        } catch { /* ignore */ }

        // Signature verification
        const candidateKeys = await resolveRetellCandidateKeysByAgent(bodyAgentId);
        if (!verifyRetellSignatureMultiKey(rawBody, sig, candidateKeys)) {
          console.warn("[retell/wbah-availability] Signature verification failed", { agentId: bodyAgentId });
          return json({ error: "invalid signature" }, 401);
        }

        // Parse body
        const parsed = normalizeRetellPayload(rawBody) as Record<string, unknown>;
        const startDate = String(parsed.start_date ?? "").trim();
        const endDate = String(parsed.end_date ?? "").trim();

        if (!startDate || !endDate) {
          // Default: now → 7 days ahead in London time
          const now = new Date();
          const weekAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
          Object.assign(parsed, {
            start_date: now.toISOString(),
            end_date: weekAhead.toISOString(),
          });
        }

        const startIso = toIsoDatetime(startDate || new Date().toISOString());
        const endIso = toIsoDatetime(
          endDate || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        );

        if (!isWbahCalendlyConfigured()) {
          console.warn("[retell/wbah-availability] Calendly token not configured");
          return json({
            success: false,
            slot_count: 0,
            slots: [],
            message: "The calendar isn't configured. Please contact us directly to book.",
          });
        }

        try {
          const slots = await getWbahCalendlyAvailableSlots(startIso, endIso);
          const summary = buildSummary(slots);

          console.log("[retell/wbah-availability]", {
            agentId: bodyAgentId,
            startIso,
            endIso,
            slot_count: slots.length,
          });

          return json({
            success: true,
            slot_count: slots.length,
            slots,
            message: summary,
          });
        } catch (e) {
          console.error("[retell/wbah-availability] Calendly fetch failed:", e);
          return json({
            success: false,
            slot_count: 0,
            slots: [],
            message: "I'm having trouble checking the calendar right now. Would you like to arrange a callback instead?",
          });
        }
      },
    },
  },
});
