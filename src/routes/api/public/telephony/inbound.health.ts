import { createFileRoute } from "@tanstack/react-router";

function healthJson(provider: string, configured: boolean, extra?: object) {
  return new Response(
    JSON.stringify({
      status: "ok",
      provider,
      environment: process.env.NODE_ENV ?? "development",
      timestamp: new Date().toISOString(),
      expectedMethod: "POST",
      configured,
      ...extra,
    }),
    { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } },
  );
}

export const Route = createFileRoute("/api/public/telephony/inbound/health")({
  server: {
    handlers: {
      GET: async () =>
        healthJson(
          "twilio-voice-inbound",
          !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
          { description: "Twilio inbound call webhook — configure Voice URL on each phone number" },
        ),
    },
  },
});
