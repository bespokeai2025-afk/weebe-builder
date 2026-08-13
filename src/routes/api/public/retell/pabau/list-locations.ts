import { createFileRoute } from "@tanstack/react-router";
import { DNR_PABAU_CORS, dnrPabauJson, handleDnrPabauPost } from "@/lib/dnr/dnr-retell-pabau-handler.server";
import { DNR_VOICE } from "@/lib/dnr/dnr-voice.config";
import {
  isDnrBookableLocation,
  pabauListLocations,
  pabauListPractitionersAtLocation,
} from "@/lib/dnr/dnr-pabau-locations.server";

export const Route = createFileRoute("/api/public/retell/pabau/list-locations")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: DNR_PABAU_CORS }),
      POST: ({ request }) =>
        handleDnrPabauPost(request, "list_locations", async ({ pabau }) => {
          const locations = await pabauListLocations(pabau);
          const cheshireId = DNR_VOICE.pabau.locationId;
          const practitioners = await pabauListPractitionersAtLocation(pabau, cheshireId);

          return dnrPabauJson({
            bookable_location_id: cheshireId,
            bookable_location: DNR_VOICE.location.name,
            note: "This phone line only books Cheshire (Castlerock House). Liverpool and London are not bookable here.",
            locations: locations.map((l) => ({
              location_id: l.id,
              location_name: l.location_name,
              bookable_on_this_line: isDnrBookableLocation(l.id),
            })),
            practitioners_at_cheshire: practitioners.slice(0, 25).map((p) => ({
              practitioner_id: p.id,
              name: p.full_name,
              job_title: p.job_title,
            })),
            summary: `Use location_id ${cheshireId} for all bookings on this line. Optional practitioner_id when caller requests a specific clinician.`,
          });
        }),
    },
  },
});
