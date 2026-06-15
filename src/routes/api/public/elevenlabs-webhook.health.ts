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

export const Route = createFileRoute("/api/public/elevenlabs-webhook/health")({
  server: {
    handlers: {
      GET: async () =>
        healthJson(
          "elevenlabs",
          !!process.env.ELEVENLABS_API_KEY,
          {
            description: "ElevenLabs Conversational AI post-call transcript webhook",
            note: "Secured via ?secret= query param set when registering the webhook",
          },
        ),
    },
  },
});
