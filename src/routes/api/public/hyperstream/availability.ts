import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getAvailableSlots, getCalcomUserTimezone } from "@/lib/calendar/calcom.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const Body = z.object({
  agent_id: z.string().min(1).max(128),
  start_date: z.string().min(1),
  end_date: z.string().min(1),
  timezone: z.string().min(1).max(64).optional(),
});

function formatSlotDisplay(isoTime: string, timezone: string): string {
  const d = new Date(isoTime);
  const datePart = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: timezone,
  }).format(d);
  const timePart = new Intl.DateTimeFormat("en-GB", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: timezone,
  })
    .format(d)
    .toUpperCase();
  return `${datePart} at ${timePart}`;
}

function buildSlotResponse(rawSlots: { time: string }[], timezone: string) {
  const limited = rawSlots.slice(0, 12);
  const slots = limited.map((s) => ({ start: s.time, display: formatSlotDisplay(s.time, timezone) }));
  const dayMap = new Map<string, { day_label: string; times: string[] }>();
  for (const s of slots) {
    const d = new Date(s.start);
    const dateKey = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(d);
    const dayLabel = new Intl.DateTimeFormat("en-GB", {
      weekday: "long", day: "numeric", month: "long", timeZone: timezone,
    }).format(d);
    const timeLabel = new Intl.DateTimeFormat("en-GB", {
      hour: "numeric", minute: "2-digit", hour12: true, timeZone: timezone,
    }).format(d).toUpperCase();
    if (!dayMap.has(dateKey)) dayMap.set(dateKey, { day_label: dayLabel, times: [] });
    dayMap.get(dateKey)!.times.push(timeLabel);
  }
  const by_day = Array.from(dayMap.entries()).map(([date, v]) => ({ date, ...v }));
  let summary: string;
  if (slots.length === 0) {
    summary = "There are no available slots in that date range. Please try different dates.";
  } else {
    const dayParts = by_day.map((d) => `on ${d.day_label}: ${d.times.join(", ")}`);
    const joiner = dayParts.length > 1
      ? dayParts.slice(0, -1).join("; ") + " and " + dayParts[dayParts.length - 1]
      : dayParts[0];
    summary = `I found ${slots.length} available slot${slots.length !== 1 ? "s" : ""}. ${joiner}.`;
  }
  return { slot_count: slots.length, timezone, slots, by_day, summary };
}

export const Route = createFileRoute("/api/public/hyperstream/availability")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const body = await request.json().catch(() => null) as Record<string, unknown> | null;
        const args = (body?.args ?? body ?? {}) as Record<string, unknown>;

        const parsed = Body.safeParse(args);
        if (!parsed.success) {
          return new Response(
            JSON.stringify({ error: "invalid body", slot_count: 0, slots: [], by_day: [], summary: "I couldn't check availability due to a request error." }),
            { status: 400, headers: { ...CORS, "Content-Type": "application/json" } },
          );
        }
        const { agent_id, start_date, end_date, timezone: callerTz } = parsed.data;

        const { data: agentRow } = await supabaseAdmin
          .from("agents")
          .select("user_id, workspace_id, settings")
          .eq("id", agent_id)
          .maybeSingle();

        if (!agentRow?.workspace_id) {
          return new Response(
            JSON.stringify({ error: "agent not found", slot_count: 0, slots: [], by_day: [], summary: "I'm having trouble accessing the calendar right now." }),
            { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
          );
        }

        const agentSettings = (agentRow.settings ?? {}) as { booking?: { enabled?: boolean; eventTypeId?: string | number } };
        if (agentSettings.booking?.enabled === false) {
          return new Response(
            JSON.stringify({ error: "booking disabled", slot_count: 0, slots: [], by_day: [], summary: "Booking is not available for this agent." }),
            { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
          );
        }

        const { data: ws } = await supabaseAdmin
          .from("workspace_settings")
          .select("calcom_api_key, default_event_type_id, calcom_event_type_id, timezone")
          .eq("workspace_id", agentRow.workspace_id)
          .maybeSingle();

        const apiKey = ws?.calcom_api_key ?? null;
        let eventTypeId = Number(agentSettings.booking?.eventTypeId || ws?.default_event_type_id || ws?.calcom_event_type_id || 0) || 0;

        if (!eventTypeId) {
          const { data: et } = await supabaseAdmin
            .from("calcom_event_types")
            .select("calcom_event_type_id")
            .eq("user_id", agentRow.user_id)
            .eq("active", true)
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle();
          eventTypeId = Number(et?.calcom_event_type_id ?? 0) || 0;
        }

        if (!apiKey || !eventTypeId) {
          return new Response(
            JSON.stringify({ error: "calendar not configured", slot_count: 0, slots: [], by_day: [], summary: "The calendar isn't set up yet. Please contact us directly to book." }),
            { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
          );
        }

        let tz = callerTz ?? ws?.timezone ?? null;
        if (!tz) tz = await getCalcomUserTimezone(apiKey);
        tz = tz ?? "UTC";

        try {
          const rawSlots = await getAvailableSlots(apiKey, { eventTypeId, startTime: start_date, endTime: end_date, timeZone: tz });
          const response = buildSlotResponse(rawSlots, tz);
          console.log("[hyperstream/availability]", { agent_id, slot_count: response.slot_count, timezone: tz });
          return new Response(JSON.stringify(response), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
        } catch (e) {
          console.error("[hyperstream/availability]", e);
          return new Response(
            JSON.stringify({ error: "availability lookup failed", slot_count: 0, slots: [], by_day: [], summary: "I'm having trouble checking the calendar right now. Let me try again — or we can try different dates." }),
            { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
