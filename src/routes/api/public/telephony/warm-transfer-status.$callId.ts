/**
 * Warm transfer — status callback for the destination leg.
 *
 * `warmTransferCall` (telephony.gateway.ts) is waiting on an in-memory promise
 * for this exact call, keyed by callId — this is what resolves it, so the
 * graph VM can move past the transfer node instead of hanging until its own
 * timeout fires.
 */
import { createFileRoute } from "@tanstack/react-router";
import {
  resolveWarmTransferAnswered,
  resolveWarmTransferSettled,
} from "@/lib/voice/gateway/telephony.gateway";

function jsonOk() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/public/telephony/warm-transfer-status/$callId")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const callId = params.callId;
        const rawBody = await request.text().catch(() => "");
        const twilioParams: Record<string, string> = {};
        try {
          new URLSearchParams(rawBody).forEach((v, k) => {
            twilioParams[k] = v;
          });
        } catch {
          /* malformed body — nothing to act on */
        }

        const status = twilioParams["CallStatus"] ?? "";
        if (status === "in-progress" || status === "answered") {
          resolveWarmTransferAnswered(callId);
        } else if (status) {
          resolveWarmTransferSettled(callId, status);
        }

        return jsonOk();
      },

      GET: async () => new Response("Warm transfer status webhook — POST only", { status: 405 }),
    },
  },
});
