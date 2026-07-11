/**
 * "Call Ava Now" — spec-named alias of /api/public/ava-call/request used by the
 * main Webespoke marketing site (webespokeai.com). Identical behavior; also
 * accepts `businessWebsite` in place of `website`.
 * POST /api/public/ava-call/request-otp
 */
import { createFileRoute } from "@tanstack/react-router";
import { avaCallOptionsHandler, handleAvaCallRequestPost } from "@/lib/lead-gen/ava-call-http.server";

export const Route = createFileRoute("/api/public/ava-call/request-otp")({
  server: {
    handlers: {
      OPTIONS: avaCallOptionsHandler,
      POST: async ({ request }: { request: Request }) => handleAvaCallRequestPost(request),
    },
  },
});
