/**
 * Public custom telemetry webhook receiver.
 *
 * Accepts post-call data from Project B (OpenAI Realtime microservice) and
 * writes it to the same analytics tables as the Retell pipeline.
 *
 * - Always returns HTTP 200 to the caller.
 * - Does NOT modify the existing /api/public/retell-webhook route.
 * - Optional auth via X-Custom-Telemetry-Secret / Authorization header.
 */
import { createFileRoute } from "@tanstack/react-router";
import { RETELL_CORS_HEADERS } from "@/lib/retell/retell-webhook.processor";
import {
  processCustomTelemetry,
  type CustomTelemetryPayload,
} from "@/lib/custom-telemetry/custom-telemetry.processor";

function telemetryJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...RETELL_CORS_HEADERS },
  });
}

export const Route = createFileRoute("/api/webhook/custom-telemetry")({
  server: {
    handlers: {
      OPTIONS: async () => {
        console.log("[CUSTOM TELEMETRY] OPTIONS request");
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...RETELL_CORS_HEADERS },
        });
      },

      GET: async () => {
        console.log("[CUSTOM TELEMETRY] Health check");
        return telemetryJson({ status: "ok", success: true }, 200);
      },

      POST: async ({ request }) => {
        const rawBody = await request.text();
        console.log("[CUSTOM TELEMETRY] POST received");

        if (!rawBody.trim()) {
          console.log("[CUSTOM TELEMETRY] Empty body — returning 200");
          return telemetryJson({ success: true }, 200);
        }

        let payload: CustomTelemetryPayload;
        try {
          payload = JSON.parse(rawBody) as CustomTelemetryPayload;
        } catch {
          console.warn("[CUSTOM TELEMETRY] Malformed JSON body — returning 200");
          return telemetryJson({ success: true }, 200);
        }

        try {
          const result = await processCustomTelemetry(payload, request.headers);
          return telemetryJson(
            {
              success: true,
              ok: result.ok,
              message: result.message,
              callId: result.callId,
            },
            200,
          );
        } catch (error) {
          console.error("[CUSTOM TELEMETRY] Processor threw — returning 200", error);
          return telemetryJson({ success: true }, 200);
        }
      },
    },
  },
});
