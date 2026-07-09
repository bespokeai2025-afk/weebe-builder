/**
 * "Call Ava Now" — step 1: create a call request + send a 6-digit OTP via the
 * best available provider (Twilio Verify → Twilio SMS → Resend email).
 * POST /api/public/ava-call/request
 * No auth. Rate-limited 3/hour per IP, per email and per phone. Honeypot spam check.
 */
import { createFileRoute } from "@tanstack/react-router";
import { avaCallOptionsHandler, handleAvaCallRequestPost } from "@/lib/lead-gen/ava-call-http.server";

export const Route = createFileRoute("/api/public/ava-call/request")({
  server: {
    handlers: {
      OPTIONS: avaCallOptionsHandler,
      POST: async ({ request }: { request: Request }) => handleAvaCallRequestPost(request),
    },
  },
});
