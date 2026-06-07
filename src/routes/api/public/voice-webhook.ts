/**
 * Public voice-agent webhook receiver (neutral-branded alias of
 * `/api/public/retell-webhook`). User-facing URL — do not show provider
 * names here. Delegates to the same processor as the legacy route.
 */
import { createFileRoute } from "@tanstack/react-router";
import {
  headersToDebugObject,
  processRetellWebhook,
  RETELL_CORS_HEADERS,
  saveRetellWebhookDebugSnapshot,
  retellJson,
} from "@/lib/retell/retell-webhook.processor";

async function logAndStore(method: string, headers: Headers, body: unknown, status: number) {
  const lastHeaders = headersToDebugObject(headers);
  await saveRetellWebhookDebugSnapshot({
    lastMethod: method,
    lastHeaders,
    lastBody: body,
    lastStatus: status,
  });
}

async function validationResponse(method: string, headers: Headers, body: unknown) {
  await logAndStore(method, headers, body, 200);
  return retellJson({ success: true, validation: true }, 200);
}

export const Route = createFileRoute("/api/public/voice-webhook")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => {
        await saveRetellWebhookDebugSnapshot({
          lastMethod: "OPTIONS",
          lastHeaders: headersToDebugObject(request.headers),
          lastBody: {},
          lastStatus: 200,
        });
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...RETELL_CORS_HEADERS },
        });
      },
      GET: async ({ request }) => {
        await logAndStore("GET", request.headers, {}, 200);
        return retellJson({ status: "ok", success: true }, 200);
      },
      POST: async ({ request }) => {
        const rawBody = await request.text();
        if (!rawBody.trim()) return validationResponse("POST", request.headers, {});

        let parsedBody: Record<string, unknown>;
        try {
          parsedBody = JSON.parse(rawBody) as Record<string, unknown>;
        } catch {
          return validationResponse("POST", request.headers, { rawBody });
        }

        const hasEvent =
          typeof parsedBody.event === "string" || typeof parsedBody.event_type === "string";
        if (!hasEvent) return validationResponse("POST", request.headers, parsedBody);

        try {
          const result = await processRetellWebhook(rawBody, request.headers, {
            skipSignature: true,
          });
          await logAndStore("POST", request.headers, parsedBody, 200);
          if ([400, 401, 403].includes(result.status)) return retellJson({ success: true }, 200);
          return result.ok
            ? retellJson(
                {
                  success: true,
                  ok: true,
                  message: result.message,
                  event: result.event,
                  callId: result.callId,
                },
                200,
              )
            : retellJson({ success: true }, 200);
        } catch (error) {
          console.error("[VOICE WEBHOOK] Processing threw; returning 200", error);
          await logAndStore("POST", request.headers, parsedBody, 200);
          return retellJson({ success: true }, 200);
        }
      },
    },
  },
});
