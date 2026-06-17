/**
 * FreJun Teler — Call Flow URL handler.
 *
 * FreJun POSTs here when a call arrives to one of our numbers.
 * We look up the number → workspace → agent, create a telephony_calls row,
 * and respond with a Call Flow JSON that tells FreJun to open a WebSocket
 * audio stream to our HyperStream bridge.
 *
 * FreJun Call Flow response format:
 *   { "action": "stream", "ws_url": "wss://...", "sample_rate": "16k", "chunk_size": 400 }
 *
 * Also handles outbound calls where callId is provided as a query param —
 * the flow_url on outbound initiate includes ?callId=<id>.
 */
import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const FREJUN_WEBHOOK_SECRET = process.env.FREJUN_WEBHOOK_SECRET ?? "";

function verifyFreJunSecret(request: Request): boolean {
  if (!FREJUN_WEBHOOK_SECRET) return true; // Not configured — allow (log only)
  const header = request.headers.get("x-frejun-secret") ?? request.headers.get("x-webhook-secret") ?? "";
  if (!header) {
    console.warn("[frejun/flow] Missing x-frejun-secret header");
    return false;
  }
  const a = Buffer.from(header);
  const b = Buffer.from(FREJUN_WEBHOOK_SECRET);
  if (a.length !== b.length) return false;
  try { return timingSafeEqual(a, b); } catch { return false; }
}

function jsonOk(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function hangupFlow() {
  return jsonOk({ action: "hangup" });
}

export const Route = createFileRoute("/api/public/frejun/flow")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!verifyFreJunSecret(request)) {
          return new Response(JSON.stringify({ action: "hangup", reason: "unauthorized" }), {
            status: 403,
            headers: { "Content-Type": "application/json" },
          });
        }

        let body: Record<string, string>;
        try {
          body = (await request.json()) as Record<string, string>;
        } catch {
          return hangupFlow();
        }

        const { call_id: frejunCallId, from_number, to_number, direction } = body;
        const url = new URL(request.url);
        const queryCallId = url.searchParams.get("callId") ?? null;

        if (!frejunCallId && !queryCallId) {
          console.log("[frejun/flow] no call_id in body or query");
          return hangupFlow();
        }

        const resolvedFrejunId = frejunCallId ?? queryCallId!;

        let callRowId: string | null = null;

        if (direction === "outbound" || queryCallId) {
          const { data: existing } = await supabaseAdmin
            .from("telephony_calls")
            .select("id")
            .eq("call_sid", queryCallId ?? resolvedFrejunId)
            .maybeSingle();

          if (existing?.id) {
            callRowId = existing.id;
            await supabaseAdmin
              .from("telephony_calls")
              .update({ status: "answered", answered_at: new Date().toISOString(), call_sid: resolvedFrejunId })
              .eq("id", callRowId);
          }
        }

        if (!callRowId && to_number) {
          const { data: numberRow } = await supabaseAdmin
            .from("phone_numbers")
            .select("id, workspace_id, agent_id, is_active")
            .eq("phone_number", to_number)
            .eq("is_active", true)
            .maybeSingle();

          if (!numberRow) {
            console.log("[frejun/flow] unknown number:", to_number);
            return hangupFlow();
          }

          const { data: inserted, error: insertErr } = await supabaseAdmin
            .from("telephony_calls")
            .insert({
              workspace_id: numberRow.workspace_id,
              phone_number_id: numberRow.id,
              agent_id: numberRow.agent_id,
              call_sid: resolvedFrejunId,
              direction: "inbound",
              from_number: from_number ?? null,
              to_number: to_number ?? null,
              status: "ringing",
              provider: "frejun",
            })
            .select("id")
            .single();

          if (insertErr) {
            console.error("[frejun/flow] DB insert error:", insertErr.message);
            return hangupFlow();
          }

          callRowId = inserted.id;

          await supabaseAdmin.from("call_events").insert({
            call_id: callRowId,
            workspace_id: numberRow.workspace_id,
            event_type: "status_change",
            event_data: { from: "initiated", to: "ringing", frejunCallId: resolvedFrejunId },
          });
        }

        if (!callRowId) {
          console.log("[frejun/flow] could not resolve callRowId");
          return hangupFlow();
        }

        const host = request.headers.get("host") ?? "";
        const wsUrl = `wss://${host}/api/frejun/stream/${callRowId}`;

        console.log(`[frejun/flow] frejunCallId=${resolvedFrejunId} callRowId=${callRowId} wsUrl=${wsUrl}`);

        return jsonOk({
          action: "stream",
          ws_url: wsUrl,
          chunk_size: 400,
          sample_rate: "16k",
        });
      },

      GET: async () =>
        new Response("FreJun flow URL — POST only", { status: 405 }),
    },
  },
});
