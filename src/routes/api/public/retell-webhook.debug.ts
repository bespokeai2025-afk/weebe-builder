import { createFileRoute } from "@tanstack/react-router";
import {
  getDurableRetellWebhookDebugSnapshot,
  headersToDebugObject,
  RETELL_CORS_HEADERS,
  retellJson,
} from "@/lib/retell/retell-webhook.processor";

export const Route = createFileRoute("/api/public/retell-webhook/debug")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => {
        console.log("[RETELL WEBHOOK] Incoming request", {
          method: "OPTIONS",
          path: "/api/public/retell-webhook/debug",
          headers: headersToDebugObject(request.headers),
        });
        console.log("[RETELL WEBHOOK] Returning 200", { method: "OPTIONS", responseCode: 200 });
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...RETELL_CORS_HEADERS },
        });
      },
      GET: async ({ request }) => {
        console.log("[RETELL WEBHOOK] Incoming request", {
          method: "GET",
          path: "/api/public/retell-webhook/debug",
          headers: headersToDebugObject(request.headers),
        });
        console.log("[RETELL WEBHOOK] Returning 200", { method: "GET", responseCode: 200 });
        return retellJson(await getDurableRetellWebhookDebugSnapshot(), 200);
      },
    },
  },
});
