import { createFileRoute } from "@tanstack/react-router";
import { DNR_PABAU_CORS, dnrPabauJson, handleDnrPabauPost } from "@/lib/dnr/dnr-retell-pabau-handler.server";
import { persistPabauBookingToCalendar } from "@/lib/dnr/dnr-receptionist-audit.server";
import {
  dnrBookAppointmentHint,
  parseDnrBookAppointment,
} from "@/lib/dnr/dnr-book-appointment.shared";
import {
  applyDnrBookSession,
  getDnrPabauCallSession,
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
          const session = getDnrPabauCallSession(workspaceId, retellCallId);
          const merged = applyDnrBookSession(args, session);
          if (merged.filled_from_session.length) {
            console.log("[dnr-pabau] book_appointment filled from session", {
              retellCallId,
              filled: merged.filled_from_session,
            });
          }
          const parsed = parseDnrBookAppointment(merged.args);
          if (!parsed.ok) {
            return dnrPabauJson(
              {
                error: parsed.error,
                hint: parsed.hint ?? dnrBookAppointmentHint(),
                missing_fields: parsed.missing ?? [],
                session_available: Boolean(session?.contact_id),
              },
              400,
            );
          }
          const body = parsed.data;
          const services = await pabauListServices(pabau);
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
