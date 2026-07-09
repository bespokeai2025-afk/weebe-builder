/**
 * "Call Ava Now" — step 2: verify the OTP and trigger the outbound Ava call.
 * POST /api/public/ava-call/verify
 * No auth. Rate-limited per IP. Max 5 OTP attempts per request row.
 */
import { createFileRoute } from "@tanstack/react-router";
import { avaCallOptionsHandler, handleAvaCallVerifyPost } from "@/lib/lead-gen/ava-call-http.server";

export const Route = createFileRoute("/api/public/ava-call/verify")({
  server: {
    handlers: {
      OPTIONS: avaCallOptionsHandler,
      POST: async ({ request }: { request: Request }) => handleAvaCallVerifyPost(request),
    },
  },
});
