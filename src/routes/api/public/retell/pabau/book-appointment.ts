import { createFileRoute } from "@tanstack/react-router";
import { DNR_PABAU_CORS, dnrPabauJson, handleDnrPabauPost } from "@/lib/dnr/dnr-retell-pabau-handler.server";
import { persistPabauBookingToCalendar } from "@/lib/dnr/dnr-receptionist-audit.server";
import {
  dnrBookAppointmentHint,
  parseDnrBookAppointment,
} from "@/lib/dnr/dnr-book-appointment.shared";
import {
  applyDnrBookSession,
  describeDnrBookSession,
  hydrateDnrPabauCallSession,
} from "@/lib/dnr/dnr-pabau-call-session.server";
import {
  matchPabauService,
  pabauBookAppointment,
  pabauListServices,
} from "@/lib/dnr/dnr-pabau-booking.server";

export const Route = createFileRoute("/api/public/retell/pabau/book-appointment")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: DNR_PABAU_CORS }),
      POST: ({ request }) =>
        handleDnrPabauPost(request, "book_appointment", async ({ pabau, args, workspaceId, retellCallId }) => {
          const session = await hydrateDnrPabauCallSession(workspaceId, retellCallId);
          const merged = applyDnrBookSession(args, session);
          if (merged.filled_from_session.length) {
            console.log("[dnr-pabau] book_appointment filled from session", {
              retellCallId,
              filled: merged.filled_from_session,
            });
          }
          const parsed = parseDnrBookAppointment(merged.args);
          if (!parsed.ok) {
            const sessionState = describeDnrBookSession(session);
            return dnrPabauJson(
              {
                error: parsed.error,
                hint: parsed.hint ?? dnrBookAppointmentHint(),
                missing_fields: parsed.missing ?? [],
                invalid_fields: parsed.invalid ?? [],
                session: sessionState,
                session_available: sessionState.has_contact_id,
                next_step:
                  !sessionState.has_service_name || sessionState.slot_count === 0
                    ? "Call check_availability with exact service_name and valid date range, then book_appointment again."
                    : undefined,
              },
              400,
            );
          }
          const body = parsed.data;
          const locationId =
            merged.args.location_id != null ? Number(merged.args.location_id) : undefined;
          const practitionerId =
            merged.args.practitioner_id != null ? Number(merged.args.practitioner_id) : undefined;
          const services = await pabauListServices(pabau, locationId);
          const matched = matchPabauService(services, body.service_name);
          if (!matched) {
            return dnrPabauJson({ error: `Unknown service: ${body.service_name}` }, 400);
          }
          const result = await pabauBookAppointment({
            config: pabau,
            contactId: body.contact_id,
            serviceName: body.service_name,
            startDate: body.start_date,
            startTime: body.start_time,
            notes: body.notes,
            locationId,
            practitionerId: practitionerId && !Number.isNaN(practitionerId) ? practitionerId : undefined,
          });
          if (result.ok) {
            const durationMatch = matched.duration.match(/(\d+)/);
            const durationMinutes = durationMatch ? parseInt(durationMatch[1], 10) : 30;
            await persistPabauBookingToCalendar({
              workspaceId,
              contactId: body.contact_id,
              serviceName: body.service_name,
              startDate: body.start_date,
              startTime: body.start_time,
              notes: body.notes,
              durationMinutes,
              pabauRaw: result.raw,
            });
          }
          return dnrPabauJson(
            {
              ...result,
              filled_from_session: merged.filled_from_session,
            },
            result.ok ? 200 : 502,
          );
        }),
    },
  },
});
