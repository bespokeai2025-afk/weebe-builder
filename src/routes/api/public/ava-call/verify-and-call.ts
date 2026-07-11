/**
 * "Call Ava Now" — spec-named alias of /api/public/ava-call/verify used by the
 * main Webespoke marketing site (webespokeai.com). Accepts { requestId, otp }
 * OR { email, phone, otp } (the marketing site holds no requestId).
 * POST /api/public/ava-call/verify-and-call
 */
import { createFileRoute } from "@tanstack/react-router";
import { avaCallOptionsHandler, handleAvaCallVerifyPost } from "@/lib/lead-gen/ava-call-http.server";

export const Route = createFileRoute("/api/public/ava-call/verify-and-call")({
  server: {
    handlers: {
      OPTIONS: avaCallOptionsHandler,
      POST: async ({ request }: { request: Request }) => handleAvaCallVerifyPost(request),
    },
  },
});
