import { createFileRoute } from "@tanstack/react-router";
import { DNR_PABAU_CORS, dnrPabauJson, handleDnrPabauPost } from "@/lib/dnr/dnr-retell-pabau-handler.server";
import {
  dnrNewClientValidationHint,
  isDnrNewClientInput,
  parseDnrFindOrCreateClient,
} from "@/lib/dnr/dnr-new-client-intake.shared";
import { pabauCreateClient, pabauFindClientByPhone } from "@/lib/dnr/dnr-pabau-booking.server";
import { saveDnrClientSession } from "@/lib/dnr/dnr-pabau-call-session.server";

export const Route = createFileRoute("/api/public/retell/pabau/find-or-create-client")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: DNR_PABAU_CORS }),
      POST: ({ request }) =>
        handleDnrPabauPost(request, "find_or_create_client", async ({ pabau, args, workspaceId, retellCallId }) => {
          // Every branch below is an ordinary conversational outcome — bad/missing args from the
          // LLM's own function call, "not found so ask if they're new", or a create that Pabau
          // rejected — not a failure of this webhook. All of them stay 200 with `error` in the
          // body for the agent to read and act on (its prompt already tells it what to do next);
          // a non-2xx here is what surfaced as a raw gateway error mid-call instead — see
          // book-appointment.ts for the same fix with the fuller explanation.
          const parsed = parseDnrFindOrCreateClient(args);
          if (!parsed.ok) {
            return dnrPabauJson({
              error: parsed.error,
              hint: parsed.hint ?? dnrNewClientValidationHint(),
              missing_fields: parsed.missing ?? [],
            });
          }

          const data = parsed.data;

          if (!isDnrNewClientInput(data)) {
            const found = await pabauFindClientByPhone(pabau, data.phone);
            if (found?.contact_id) {
              saveDnrClientSession({
                workspaceId,
                retellCallId,
                contact_id: found.contact_id,
                phone: data.phone,
              });
              return dnrPabauJson({
                contact_id: found.contact_id,
                created: false,
                message: `Found existing record${found.name ? `: ${found.name}` : ""}.`,
              });
            }
            return dnrPabauJson({
              error: "No existing client found for that phone",
              hint: "If they are new, set is_new_client: true and collect email and gender.",
            });
          }

          const created = await pabauCreateClient(pabau, {
            first_name: data.first_name,
            last_name: data.last_name,
            mobile: data.phone,
            email: data.email,
            gender: data.gender,
            dob: data.date_of_birth,
          });
          if (!created.contact_id) {
            return dnrPabauJson({
              error: "Could not create client",
              hint: "Use transfer_to_foh — Pabau rejected the new client record.",
              detail: created.raw,
            });
          }
          saveDnrClientSession({
            workspaceId,
            retellCallId,
            contact_id: created.contact_id,
            phone: data.phone,
          });
          return dnrPabauJson({
            contact_id: created.contact_id,
            created: true,
            message: "New client created in Pabau.",
          });
        }),
    },
  },
});
