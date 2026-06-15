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

export const Route = createFileRoute("/api/public/frejun/health")({
  server: {
    handlers: {
      GET: async () =>
        healthJson(
          "frejun",
          true,
          { description: "FreJun Teler call status and flow webhooks — per-workspace configuration in Telephony Settings" },
        ),
    },
  },
});
