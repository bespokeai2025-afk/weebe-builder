import { createFileRoute } from "@tanstack/react-router";
import { DNR_PABAU_CORS, dnrPabauJson, handleDnrPabauPost } from "@/lib/dnr/dnr-retell-pabau-handler.server";
import { DNR_VOICE } from "@/lib/dnr/dnr-voice.config";
import { pabauListServices } from "@/lib/dnr/dnr-pabau-booking.server";

export const Route = createFileRoute("/api/public/retell/pabau/list-services")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: DNR_PABAU_CORS }),
      POST: ({ request }) =>
        handleDnrPabauPost(request, "list_services", async ({ pabau, args }) => {
          const locationId =
            args.location_id != null ? Number(args.location_id) : DNR_VOICE.pabau.locationId;
          const services = await pabauListServices(pabau, locationId);
          return dnrPabauJson({
            location_id: locationId,
            location: DNR_VOICE.location.name,
            count: services.length,
            services: services.slice(0, 50).map((s) => ({
              service_name: s.service_name,
              duration: s.duration,
              category: s.category_name,
            })),
            summary: `${services.length} treatments at ${DNR_VOICE.location.name}. Use exact service_name when booking.`,
          });
        }),
    },
  },
});
