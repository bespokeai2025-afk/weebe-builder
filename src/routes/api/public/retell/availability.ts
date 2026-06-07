import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { verifyRetellSignatureMultiKey } from "@/lib/calendar/retell-signature";
import { getAvailableSlots } from "@/lib/calendar/calcom.server";
import { normalizeRetellPayload } from "@/lib/calendar/retell-payload";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-retell-signature",
};

const Body = z.object({
  agent_id: z.string().min(1).max(128),
  start_date: z.string().min(1),
  end_date: z.string().min(1),
  timezone: z.string().min(1).max(64).optional(),
});

/** Format a single ISO slot into a human-readable label in the given timezone. */
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

/** Group slots by calendar day and build a spoken summary the LLM can read aloud. */
function buildSlotResponse(
  rawSlots: { time: string }[],
  timezone: string,
): {
  slot_count: number;
  timezone: string;
  slots: { start: string; display: string }[];
  by_day: { date: string; day_label: string; times: string[] }[];
  summary: string;
} {
  // Limit to 12 slots to avoid overwhelming the LLM
  const limited = rawSlots.slice(0, 12);

  const slots = limited.map((s) => ({
    start: s.time,
    display: formatSlotDisplay(s.time, timezone),
  }));

  // Group by calendar day in the target timezone
  const dayMap = new Map<string, { day_label: string; times: string[] }>();
  for (const s of slots) {
    const d = new Date(s.start);
    const dateKey = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(d); // YYYY-MM-DD
    const dayLabel = new Intl.DateTimeFormat("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      timeZone: timezone,
    }).format(d);
    const timeLabel = new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: timezone,
    })
      .format(d)
      .toUpperCase();

    if (!dayMap.has(dateKey)) dayMap.set(dateKey, { day_label: dayLabel, times: [] });
    dayMap.get(dateKey)!.times.push(timeLabel);
  }

  const by_day = Array.from(dayMap.entries()).map(([date, v]) => ({
    date,
    day_label: v.day_label,
    times: v.times,
  }));

  let summary: string;
  if (slots.length === 0) {
    summary = "There are no available slots in that date range. Please try different dates.";
  } else {
    const dayParts = by_day.map((d) => {
      const timeList = d.times.join(", ");
      return `on ${d.day_label}: ${timeList}`;
    });
    const joiner = dayParts.length > 1 ? dayParts.slice(0, -1).join("; ") + " and " + dayParts[dayParts.length - 1] : dayParts[0];
    summary = `I found ${slots.length} available slot${slots.length !== 1 ? "s" : ""}. ${joiner}.`;
  }

  return { slot_count: slots.length, timezone, slots, by_day, summary };
}

async function resolveWorkspaceCandidateKey(bodyAgentId?: string): Promise<string[]> {
  if (!bodyAgentId) return [];
  const { data: agentLookup } = await supabaseAdmin
    .from("agents")
    .select("workspace_id")
    .or(`retell_agent_id.eq.${bodyAgentId},settings->>deployedRetellAgentId.eq.${bodyAgentId}`)
    .maybeSingle();
  if (!agentLookup?.workspace_id) return [];
  const { data: wsLookup } = await supabaseAdmin
    .from("workspace_settings")
    .select("retell_workspace_id")
    .eq("workspace_id", agentLookup.workspace_id)
    .maybeSingle();
  const wk = wsLookup?.retell_workspace_id?.trim();
  return wk && wk.startsWith("key_") ? [wk] : [];
}

export const Route = createFileRoute("/api/public/retell/availability")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const rawBody = await request.text();
        const sig = request.headers.get("x-retell-signature");

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

        const candidateKeys = await resolveWorkspaceCandidateKey(bodyAgentId);

        if (!verifyRetellSignatureMultiKey(rawBody, sig, candidateKeys)) {
          console.warn("[retell/availability] Signature verification failed", { agentId: bodyAgentId });
          return new Response(JSON.stringify({ error: "invalid signature" }), {
            status: 401,
            headers: { ...CORS, "Content-Type": "application/json" },
          });
        }

        const parsed = Body.safeParse(normalizeRetellPayload(rawBody));
        if (!parsed.success) {
          return new Response(JSON.stringify({ error: "invalid body", summary: "I couldn't check availability due to a request error." }), {
            status: 400,
            headers: { ...CORS, "Content-Type": "application/json" },
          });
        }
        const { agent_id, start_date, end_date, timezone } = parsed.data;

        const { data: agentRow } = await supabaseAdmin
          .from("agents")
          .select("user_id, workspace_id, settings")
          .or(`retell_agent_id.eq.${agent_id},settings->>deployedRetellAgentId.eq.${agent_id}`)
          .maybeSingle();

        if (!agentRow?.workspace_id) {
          return new Response(
            JSON.stringify({ error: "agent not found", slot_count: 0, slots: [], by_day: [], summary: "I'm having trouble accessing the calendar right now. Please try again." }),
            { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
          );
        }

        const wsId = agentRow.workspace_id;
        const uid = agentRow.user_id;

        const { data: settings } = await supabaseAdmin
          .from("workspace_settings")
          .select("calcom_api_key, default_event_type_id, calcom_event_type_id, timezone")
          .eq("workspace_id", wsId)
          .maybeSingle();

        const agentSettings = (agentRow.settings ?? {}) as {
          calcom?: { apiKey?: string; eventTypeId?: string | number };
          booking?: { enabled?: boolean; eventTypeId?: string | number };
        };
        if (agentSettings.booking?.enabled === false) {
          return new Response(
            JSON.stringify({ error: "booking disabled", slot_count: 0, slots: [], by_day: [], summary: "Booking is not available for this agent." }),
            { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
          );
        }

        const apiKey = agentSettings.calcom?.apiKey ?? settings?.calcom_api_key ?? null;
        let eventTypeId =
          Number(
            agentSettings.booking?.eventTypeId ||
              agentSettings.calcom?.eventTypeId ||
              settings?.default_event_type_id ||
              settings?.calcom_event_type_id ||
              0,
          ) || 0;

        if (!eventTypeId) {
          const { data: et } = await supabaseAdmin
            .from("calcom_event_types")
            .select("calcom_event_type_id")
            .eq("user_id", uid)
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

        const tz = timezone ?? settings?.timezone ?? "UTC";

        try {
          const rawSlots = await getAvailableSlots(apiKey, {
            eventTypeId,
            startTime: start_date,
            endTime: end_date,
            timeZone: tz,
          });

          const response = buildSlotResponse(rawSlots, tz);
          console.log("[retell/availability]", { agent_id, slot_count: response.slot_count, timezone: tz });
          return new Response(JSON.stringify(response), {
            status: 200,
            headers: { ...CORS, "Content-Type": "application/json" },
          });
        } catch (e) {
          console.error("[retell/availability]", e);
          return new Response(
            JSON.stringify({
              error: "availability lookup failed",
              slot_count: 0,
              slots: [],
              by_day: [],
              summary: "I'm having trouble checking the calendar right now. Let me try again — or we can try different dates.",
            }),
            { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
