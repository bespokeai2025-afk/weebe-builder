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

export const Route = createFileRoute("/api/public/calcom-webhook/health")({
  server: {
    handlers: {
      GET: async () =>
        healthJson(
          "calcom",
          true,
          {
            description: "Cal.com booking webhook — per-workspace, auto-registered when Cal.com API key is saved",
            note: "URL per workspace: /api/public/calcom-webhook/{workspaceId}",
          },
        ),
    },
  },
});
