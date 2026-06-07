/**
 * Builds Retell `general_tools` definitions for the booking flow.
 * Server-only — referenced from createServerFn handlers.
 */

const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL ??
  "https://project--032aa199-686b-4533-8984-add303d96a06.lovable.app";

export function buildBookingTools() {
  const base = `${PUBLIC_BASE_URL}/api/public/retell`;
  return [
    {
      type: "custom",
      name: "check_availability",
      description:
        "Check available appointment slots for the user's calendar within a date range. Use before offering times.",
      url: `${base}/availability`,
      speak_during_execution: true,
      execution_message_description: "Checking the calendar for open times",
      parameters: {
        type: "object",
        properties: {
          start_date: {
            type: "string",
            description: "Start of search window, ISO date e.g. 2026-06-01",
          },
          end_date: {
            type: "string",
            description: "End of search window, ISO date e.g. 2026-06-07",
          },
          timezone: {
            type: "string",
            description: "IANA timezone, e.g. Europe/London. Optional.",
          },
        },
        required: ["start_date", "end_date"],
      },
    },
    {
      type: "custom",
      name: "book_appointment",
      description:
        "Book an appointment at a specific available start time. Only call after the caller has confirmed name, email and the chosen slot.",
      url: `${base}/book`,
      speak_during_execution: true,
      execution_message_description: "Booking the appointment now",
      parameters: {
        type: "object",
        properties: {
          start: {
            type: "string",
            description: "ISO 8601 start time exactly as returned by check_availability",
          },
          name: { type: "string", description: "Attendee full name" },
          email: { type: "string", description: "Attendee email address" },
          phone: { type: "string", description: "Attendee phone in E.164 format. Optional." },
          notes: { type: "string", description: "Any notes the caller wants on the booking." },
          timezone: { type: "string", description: "IANA timezone. Optional." },
        },
        required: ["start", "name", "email"],
      },
    },
    {
      type: "custom",
      name: "cancel_appointment",
      description: "Cancel an existing appointment by its booking id.",
      url: `${base}/cancel`,
      speak_during_execution: true,
      execution_message_description: "Cancelling the appointment",
      parameters: {
        type: "object",
        properties: {
          booking_id: { type: "string", description: "Cal.com booking uid returned at book time" },
          reason: { type: "string", description: "Optional cancellation reason" },
        },
        required: ["booking_id"],
      },
    },
    {
      type: "custom",
      name: "reschedule_appointment",
      description:
        "Move an existing appointment to a new start time. Use after check_availability has confirmed the new slot is free.",
      url: `${base}/reschedule`,
      speak_during_execution: true,
      execution_message_description: "Rescheduling the appointment",
      parameters: {
        type: "object",
        properties: {
          booking_id: {
            type: "string",
            description: "Cal.com booking uid for the appointment to move",
          },
          new_start: {
            type: "string",
            description: "ISO 8601 start time for the new slot, as returned by check_availability",
          },
          reason: { type: "string", description: "Optional reason for the reschedule" },
        },
        required: ["booking_id", "new_start"],
      },
    },
  ];
}
