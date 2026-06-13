/**
 * WATI Inbound Webhook
 *
 * Receives message events from WATI and normalizes them to the same
 * message object shape the existing runtime expects.
 *
 * - Never modifies AI runtime, workflow builder, or any existing WhatsApp flow.
 * - Always returns HTTP 200 so WATI stops retrying.
 * - Validates optional webhook secret via X-WATI-SECRET header.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function adminClient() {
  const url = process.env["SUPABASE_URL"]!;
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"]!;
  return createClient(url, key, { auth: { persistSession: false } });
}

function normalizeWatiEvent(payload: any): {
  workspaceId: string | null;
  message: {
    contact_phone: string;
    contact_name: string | null;
    body: string;
    direction: "inbound" | "outbound";
    provider: "wati";
    raw: unknown;
  } | null;
} {
  const phone =
    payload?.waId ??
    payload?.phone ??
    payload?.from ??
    payload?.contact?.phone ??
    null;

  if (!phone) return { workspaceId: null, message: null };

  const body =
    payload?.text?.body ??
    payload?.message?.text ??
    payload?.text ??
    payload?.caption ??
    "[Non-text message]";

  const name =
    payload?.senderName ??
    payload?.contact?.name ??
    payload?.profile?.name ??
    null;

  return {
    workspaceId: payload?.workspaceId ?? null,
    message: {
      contact_phone: phone,
      contact_name: name,
      body: typeof body === "string" ? body : JSON.stringify(body),
      direction: "inbound",
      provider: "wati",
      raw: payload,
    },
  };
}

export const Route = createFileRoute("/api/webhook/wati-inbound")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS" },
        }),

      POST: async ({ request }) => {
        let payload: any;
        try {
          payload = await request.json();
        } catch {
          return json({ ok: false, error: "Invalid JSON" }, 400);
        }

        const sb = adminClient() as any;

        const receivedSecret = request.headers.get("x-wati-secret") ?? "";

        if (receivedSecret) {
          const { data: conn } = await sb
            .from("wati_connections")
            .select("webhook_secret, workspace_id")
            .not("webhook_secret", "is", null)
            .limit(50);

          const matched = (conn ?? []).find(
            (c: any) => c.webhook_secret === receivedSecret,
          );
          if (!matched) {
            console.warn("[WATI WEBHOOK] Secret mismatch — ignoring");
            return json({ ok: true });
          }
          payload.workspaceId = matched.workspace_id;
        }

        if (!payload.workspaceId) {
          const { data: conns } = await sb
            .from("wati_connections")
            .select("workspace_id")
            .eq("status", "connected")
            .limit(1);
          if (conns?.[0]) payload.workspaceId = conns[0].workspace_id;
        }

        const { workspaceId, message } = normalizeWatiEvent(payload);

        if (!workspaceId || !message) {
          console.warn("[WATI WEBHOOK] Could not normalize event", payload);
          return json({ ok: true });
        }

        try {
          await sb.from("whatsapp_messages").insert({
            workspace_id: workspaceId,
            contact_phone: message.contact_phone,
            contact_name: message.contact_name,
            body: message.body,
            direction: message.direction,
            sent_at: new Date().toISOString(),
          });
        } catch (e) {
          console.error("[WATI WEBHOOK] DB insert error", e);
        }

        return json({ ok: true });
      },
    },
  },
});
