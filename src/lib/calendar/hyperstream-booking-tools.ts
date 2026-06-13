/**
 * Builds OpenAI Realtime function tool definitions for the Cal.com booking
 * flow when running through HyperStream (OpenAI native).
 *
 * Key difference from buildBookingTools() (Retell version):
 *  - tool-executor.ts calls these URLs directly from the browser with
 *    { tool, args } POST body — no Retell HMAC signature is attached.
 *  - The agent's internal row UUID is included as `agent_id` in every call
 *    so the server can look up the workspace and its Cal.com credentials.
 *  - The `url` field is carried through buildOpenAIToolDefinitions → omitted
 *    from the OpenAI session tools array (OpenAI doesn't know about it), but
 *    it IS read back by executeToolCall to know where to POST.
 */
export function buildHyperStreamBookingTools(agentId: string) {
  const PUBLIC_BASE_URL =
    process.env.PUBLIC_BASE_URL ||
    (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "");
  const base = `${PUBLIC_BASE_URL}/api/public/hyperstream`;
  return [
    {
      type: "custom",
      name: "get_event_types",
      description:
        "Retrieve the list of available appointment types (e.g. 'Discovery Call', 'Consultation', '30-min Meeting'). " +
        "Call this first if you need to ask the caller which type of appointment they want. " +
        "Returns a human-readable list and an event_type_id for each option.",
      url: `${base}/event-types`,
      parameters: {
        type: "object",
        properties: {
          agent_id: {
            type: "string",
            description: `Your agent identifier. Always pass exactly: "${agentId}"`,
          },
        },
        required: ["agent_id"],
      },
    },
    {
      type: "custom",
      name: "check_availability",
      description:
        "Check available appointment slots within a date range. " +
        "Call this BEFORE presenting times to the caller. " +
        "Returns a 'summary' field you can read aloud, plus a 'slots' array with exact ISO start times for booking. " +
        "If no slots are returned, offer to check different dates.",
      url: `${base}/availability`,
      parameters: {
        type: "object",
        properties: {
          agent_id: {
            type: "string",
            description: `Your agent identifier. Always pass exactly: "${agentId}"`,
          },
          start_date: {
            type: "string",
            description: "Start of search window, ISO date e.g. 2026-06-10",
          },
          end_date: {
            type: "string",
            description: "End of search window, ISO date e.g. 2026-06-17",
          },
          timezone: {
            type: "string",
            description:
              "Caller's IANA timezone e.g. Europe/London, America/New_York. " +
              "Slots will be formatted in this timezone.",
          },
        },
        required: ["agent_id", "start_date", "end_date"],
      },
    },
    {
      type: "custom",
      name: "book_appointment",
      description:
        "Create a confirmed booking at a specific time slot. " +
        "ONLY call this AFTER: (1) the caller has confirmed their name and email, " +
        "(2) you have read back the selected slot and the caller said yes. " +
        "Use the exact 'start' ISO string returned by check_availability — never fabricate a time. " +
        "Returns a 'confirmation_message' you can read aloud, and optionally a 'meeting_url'.",
      url: `${base}/book`,
      parameters: {
        type: "object",
        properties: {
          agent_id: {
            type: "string",
            description: `Your agent identifier. Always pass exactly: "${agentId}"`,
          },
          start: {
            type: "string",
            description:
              "ISO 8601 start time exactly as returned by check_availability e.g. 2026-06-10T14:00:00+01:00",
          },
          name: { type: "string", description: "Attendee full name" },
          email: { type: "string", description: "Attendee email address" },
          phone: {
            type: "string",
            description:
              "Attendee phone number in E.164 format e.g. +447700900000. " +
              "REQUIRED — you must collect this from the caller before calling this function.",
          },
          notes: {
            type: "string",
            description: "Any additional notes the caller wants on the booking. Optional.",
          },
          timezone: {
            type: "string",
            description: "Caller's IANA timezone e.g. Europe/London. Optional but recommended.",
          },
        },
        required: ["agent_id", "start", "name", "email", "phone"],
      },
    },
    {
      type: "custom",
      name: "cancel_appointment",
      description:
        "Cancel an existing appointment by its booking ID. " +
        "Ask the caller for the booking ID if they don't have it. " +
        "Always confirm with the caller before cancelling.",
      url: `${base}/cancel`,
      parameters: {
        type: "object",
        properties: {
          agent_id: {
            type: "string",
            description: `Your agent identifier. Always pass exactly: "${agentId}"`,
          },
          booking_id: {
            type: "string",
            description: "Cal.com booking UID returned when the appointment was created",
          },
          reason: { type: "string", description: "Optional cancellation reason" },
        },
        required: ["agent_id", "booking_id"],
      },
    },
    {
      type: "custom",
      name: "reschedule_appointment",
      description:
        "Move an existing appointment to a new time slot. " +
        "First call check_availability to confirm the new slot is free, then call this. " +
        "Always confirm the new time with the caller before rescheduling.",
      url: `${base}/reschedule`,
      parameters: {
        type: "object",
        properties: {
          agent_id: {
            type: "string",
            description: `Your agent identifier. Always pass exactly: "${agentId}"`,
          },
          booking_id: {
            type: "string",
            description: "Cal.com booking UID for the appointment to move",
          },
          new_start: {
            type: "string",
            description:
              "ISO 8601 start time for the new slot, exactly as returned by check_availability",
          },
          reason: { type: "string", description: "Optional reason for the reschedule" },
        },
        required: ["agent_id", "booking_id", "new_start"],
      },
    },
  ];
}
