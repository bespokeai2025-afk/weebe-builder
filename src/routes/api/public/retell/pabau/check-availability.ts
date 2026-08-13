import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { DNR_PABAU_CORS, dnrPabauJson, handleDnrPabauPost } from "@/lib/dnr/dnr-retell-pabau-handler.server";
import { pabauCheckAvailability } from "@/lib/dnr/dnr-pabau-booking.server";
import { saveDnrAvailabilitySession } from "@/lib/dnr/dnr-pabau-call-session.server";

export const Route = createFileRoute("/api/public/retell/pabau/check-availability")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: DNR_PABAU_CORS }),
      POST: ({ request }) =>
        handleDnrPabauPost(request, "check_availability", async ({ pabau, args, workspaceId, retellCallId }) => {
          const body = z.object({
            service_name: z.string().min(1),
            start_date: z.string().optional(),
            end_date: z.string().optional(),
            location_id: z.union([z.string(), z.number()]).optional(),
            practitioner_id: z.union([z.string(), z.number()]).optional(),
            practitioner_name: z.string().optional(),
          }).safeParse(args);
          if (!body.success) {
            return dnrPabauJson({ error: "service_name required" }, 400);
          }
          const result = await pabauCheckAvailability({
            config: pabau,
            serviceName: body.data.service_name,
            startDate: body.data.start_date ?? "",
            endDate: body.data.end_date ?? "",
            locationId: body.data.location_id != null ? Number(body.data.location_id) : undefined,
            practitionerId:
              body.data.practitioner_id != null ? Number(body.data.practitioner_id) : undefined,
            practitionerName: body.data.practitioner_name,
          });
          saveDnrAvailabilitySession({
            workspaceId,
            retellCallId,
            service_name: body.data.service_name,
            location_id: result.location.id,
            practitioner_id: result.practitioner?.id,
            slots: result.slots.map((s) => ({
              start_date: s.start_date,
              start_time: s.start_time,
            })),
          });
          return dnrPabauJson(result);
        }),
    },
  },
});
