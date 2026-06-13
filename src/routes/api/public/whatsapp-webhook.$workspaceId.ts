/**
 * Twilio WhatsApp inbound webhook — one URL per workspace:
 *   /api/public/whatsapp-webhook/<workspaceId>
 *
 * Twilio signs each request with HMAC-SHA1(authToken, url + sortedParams)
 * base64 in `X-Twilio-Signature`. We look up the workspace's stored auth
 * token (workspace_settings.twilio_auth_token), verify, then upsert a
 * whatsapp_messages row keyed on (workspace_id, external_id = MessageSid).
 *
 * Body is application/x-www-form-urlencoded. Status callbacks (no Body) are
 * acknowledged with TwiML so Twilio doesn't retry.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { processWhatsAppMessage } from "@/lib/whatsapp/runtime";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Twilio-Signature",
} as const;

const TWIML_OK = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
const TWIML_HEADERS = { "Content-Type": "text/xml", ...CORS } as const;

function verifyTwilio(
  url: string,
  params: Record<string, string>,
  header: string | null,
  authToken: string,
): boolean {
  if (!header) return false;
  // Twilio: sort keys, append key+value pairs to URL, HMAC-SHA1 base64
  const sortedKeys = Object.keys(params).sort();
  const data = sortedKeys.reduce((acc, k) => acc + k + params[k], url);
  const expected = createHmac("sha1", authToken).update(data).digest("base64");
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function stripWhatsappPrefix(v: string | undefined): string | null {
  if (!v) return null;
  return v.replace(/^whatsapp:/i, "").trim() || null;
}

export const Route = createFileRoute("/api/public/whatsapp-webhook/$workspaceId")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request, params }) => {
        const workspaceId = params.workspaceId;
        if (!/^[0-9a-f-]{36}$/i.test(workspaceId)) {
          return new Response("Bad workspace id", { status: 400, headers: CORS });
        }

        const { data: settings, error: settingsErr } = await supabaseAdmin
          .from("workspace_settings")
          .select("twilio_auth_token")
          .eq("workspace_id", workspaceId)
          .maybeSingle();
        if (settingsErr) {
          return new Response("settings lookup failed", { status: 500, headers: CORS });
        }
        const authToken = settings?.twilio_auth_token as string | null | undefined;
        if (!authToken) {
          return new Response("Twilio auth token not configured", {
            status: 401,
            headers: CORS,
          });
        }

        const rawBody = await request.text();
        const form = new URLSearchParams(rawBody);
        const params2: Record<string, string> = {};
        for (const [k, v] of form.entries()) params2[k] = v;

        // Twilio signs the full URL it called.
        const url = new URL(request.url);
        const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
        const host = request.headers.get("x-forwarded-host") ?? url.host;
        const signedUrl = `${proto}://${host}${url.pathname}${url.search}`;

        const sig = request.headers.get("x-twilio-signature");
        if (!verifyTwilio(signedUrl, params2, sig, authToken)) {
          console.error("[whatsapp-webhook] invalid signature", { signedUrl });
          return new Response("Invalid signature", { status: 401, headers: CORS });
        }

        const messageSid = params2.MessageSid || params2.SmsSid;
        const from = stripWhatsappPrefix(params2.From);
        const to = stripWhatsappPrefix(params2.To);
        const body = params2.Body ?? null;
        const profileName = params2.ProfileName ?? null;
        const numMedia = Number(params2.NumMedia ?? "0") || 0;
        const mediaUrl = numMedia > 0 ? (params2.MediaUrl0 ?? null) : null;
        const messageStatus = params2.MessageStatus ?? params2.SmsStatus ?? null;

        // Outbound status callback (no Body, no From-as-contact context).
        // Update status on existing row if we have it, otherwise just ack.
        if (!body && !mediaUrl && messageStatus && messageSid) {
          const mappedStatus =
            messageStatus === "delivered"
              ? "delivered"
              : messageStatus === "read"
                ? "read"
                : messageStatus === "failed" || messageStatus === "undelivered"
                  ? "failed"
                  : "sent";
          await supabaseAdmin
            .from("whatsapp_messages")
            .update({ status: mappedStatus as never })
            .eq("workspace_id", workspaceId)
            .eq("external_id", messageSid);
          return new Response(TWIML_OK, { status: 200, headers: TWIML_HEADERS });
        }

        if (!from || !messageSid) {
          return new Response(TWIML_OK, { status: 200, headers: TWIML_HEADERS });
        }

        // Inbound: link to lead by phone if we can.
        const { data: lead } = await supabaseAdmin
          .from("leads")
          .select("id")
          .eq("workspace_id", workspaceId)
          .eq("phone", from)
          .maybeSingle();

        const row = {
          workspace_id: workspaceId,
          lead_id: (lead?.id as string | undefined) ?? null,
          external_id: messageSid,
          contact_phone: from,
          contact_name: profileName,
          direction: "inbound" as const,
          body,
          media_url: mediaUrl,
          status: "sent" as const,
        };

        const { error } = await supabaseAdmin.from("whatsapp_messages").upsert(row as never, {
          onConflict: "workspace_id,external_id",
        });
        if (error) {
          console.error("[whatsapp-webhook] upsert failed", error.message, {
            to,
            from,
          });
          return new Response("db error", { status: 500, headers: CORS });
        }

        // Trigger WhatsApp flow runtime (non-blocking — errors are logged, not surfaced)
        if (body) {
          processWhatsAppMessage({
            workspaceId,
            contactPhone: from,
            contactName: profileName,
            inboundBody: body,
          }).catch((e) => console.error("[whatsapp-webhook] runtime error", e));
        }

        return new Response(TWIML_OK, { status: 200, headers: TWIML_HEADERS });
      },
    },
  },
});
