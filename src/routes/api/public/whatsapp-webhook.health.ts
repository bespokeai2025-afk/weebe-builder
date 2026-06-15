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

export const Route = createFileRoute("/api/public/whatsapp-webhook/health")({
  server: {
    handlers: {
      GET: async () =>
        healthJson(
          "whatsapp-unified",
          !!(process.env.TWILIO_ACCOUNT_SID || process.env.WATI_API_KEY || process.env.META_WA_APP_SECRET),
          {
            description: "Unified WhatsApp webhook — supports Twilio, WATI, and Meta providers",
            note: "URL per workspace: /api/public/whatsapp-webhook/{workspaceId}",
          },
        ),
    },
  },
});
