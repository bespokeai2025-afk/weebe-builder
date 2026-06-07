/**
 * Public Retell webhook receiver.
 *
 * This route intentionally does not use dashboard/user authentication.
 * Registration testing is permissive so Retell can validate the URL and reveal its payload shape.
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
  console.log("[RETELL WEBHOOK] Returning 200", { method, responseCode: status });
}

async function validationResponse(method: string, headers: Headers, body: unknown, reason: string) {
  console.log("[RETELL WEBHOOK] Validation bypass active", { reason });
  await logAndStore(method, headers, body, 200);
  return retellJson({ success: true, validation: true }, 200);
}

export const Route = createFileRoute("/api/public/retell-webhook")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => {
        console.log("[RETELL WEBHOOK] Incoming request", {
          method: "OPTIONS",
          headers: headersToDebugObject(request.headers),
        });
        await saveRetellWebhookDebugSnapshot({
          lastMethod: "OPTIONS",
          lastHeaders: headersToDebugObject(request.headers),
          lastBody: {},
          lastStatus: 200,
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
          headers: headersToDebugObject(request.headers),
        });
        await logAndStore("GET", request.headers, {}, 200);
        return retellJson({ status: "ok", success: true }, 200);
      },
      POST: async ({ request }) => {
        const rawBody = await request.text();
        console.log("[RETELL WEBHOOK] Incoming request", {
          method: "POST",
          headers: headersToDebugObject(request.headers),
        });
        console.log("[RETELL WEBHOOK] Body received", rawBody);

        if (!rawBody.trim()) {
          console.log(
            "[RETELL WEBHOOK] Former 400 path checked: empty body accepted for validation",
          );
          return await validationResponse("POST", request.headers, {}, "empty body");
        }

        let parsedBody: Record<string, unknown>;
        try {
          parsedBody = JSON.parse(rawBody) as Record<string, unknown>;
        } catch (error) {
          console.log("[RETELL WEBHOOK] Former 400 path reached: malformed JSON body", {
            error: error instanceof Error ? error.message : "Unknown parse error",
          });
          return await validationResponse("POST", request.headers, { rawBody }, "malformed body");
        }

        const hasEvent =
          typeof parsedBody.event === "string" || typeof parsedBody.event_type === "string";
        if (!hasEvent) {
          console.log(
            "[RETELL WEBHOOK] Former 400 path checked: missing event fields accepted for validation",
            parsedBody,
          );
          return await validationResponse(
            "POST",
            request.headers,
            parsedBody,
            "missing event fields",
          );
        }

        try {
          const result = await processRetellWebhook(rawBody, request.headers);
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
          console.error(
            "[RETELL WEBHOOK] Processing threw; returning 200 for registration testing",
            error,
          );
          await logAndStore("POST", request.headers, parsedBody, 200);
          return retellJson({ success: true }, 200);
        }
      },
    },
  },
});
