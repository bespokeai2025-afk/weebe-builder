import { createFileRoute } from "@tanstack/react-router";
import { RETELL_CORS_HEADERS, retellJson } from "@/lib/retell/retell-webhook.processor";

export const Route = createFileRoute("/api/public/retell-webhook/health")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: RETELL_CORS_HEADERS }),
      GET: async () => retellJson({ status: "ok" }),
    },
  },
});
