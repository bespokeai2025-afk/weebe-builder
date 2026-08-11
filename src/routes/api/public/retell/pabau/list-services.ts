import { createFileRoute } from "@tanstack/react-router";
import { DNR_PABAU_CORS, dnrPabauJson, handleDnrPabauPost } from "@/lib/dnr/dnr-retell-pabau-handler.server";
import { pabauListServices } from "@/lib/dnr/dnr-pabau-booking.server";

export const Route = createFileRoute("/api/public/retell/pabau/list-services")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: DNR_PABAU_CORS }),
      POST: ({ request }) =>
        handleDnrPabauPost(request, "list_services", async ({ pabau }) => {
          const services = await pabauListServices(pabau);
          return dnrPabauJson({
            location: "Medispa Cheshire only",
            count: services.length,
            services: services.slice(0, 50).map((s) => ({
              service_name: s.service_name,
              duration: s.duration,
              category: s.category_name,
            })),
            summary: `${services.length} treatments in Pabau. Use exact service_name when booking.`,
          });
        }),
    },
  },
});
