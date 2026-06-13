/**
 * Unified WhatsApp inbound webhook — one URL per workspace:
 *   /api/public/whatsapp-webhook/<workspaceId>
 *
 * Supports two providers:
 *
 * ── Twilio ─────────────────────────────────────────────────────────────────
 * POST application/x-www-form-urlencoded  +  X-Twilio-Signature header.
 * Signature = HMAC-SHA1(authToken, url+sortedParams) base64.
 *
 * ── Meta (WhatsApp Business API) ───────────────────────────────────────────
 * GET  ?hub.mode=subscribe&hub.verify_token=TOKEN&hub.challenge=CHALLENGE
 *      → respond with challenge string if token matches workspace's stored token.
 * POST application/json  { object: "whatsapp_business_account", entry: [...] }
 */
import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { processWhatsAppMessage } from "@/lib/whatsapp/runtime";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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
  const sortedKeys = Object.keys(params).sort();
  const data = sortedKeys.reduce((acc, k) => acc + k + params[k], url);
  const expected = createHmac("sha1", authToken).update(data).digest("base64");
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try { return timingSafeEqual(a, b); } catch { return false; }
}

function stripWhatsappPrefix(v: string | undefined): string | null {
  if (!v) return null;
  return v.replace(/^whatsapp:/i, "").trim() || null;
}

export const Route = createFileRoute("/api/public/whatsapp-webhook/$workspaceId")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),

      // ── Meta webhook verification (GET) ──────────────────────────────────
      GET: async ({ request, params }) => {
        const workspaceId = params.workspaceId;
        if (!/^[0-9a-f-]{36}$/i.test(workspaceId)) {
          return new Response("Bad workspace id", { status: 400 });
        }

        const url = new URL(request.url);
        const mode      = url.searchParams.get("hub.mode");
        const token     = url.searchParams.get("hub.verify_token");
        const challenge = url.searchParams.get("hub.challenge");

        if (mode !== "subscribe" || !token || !challenge) {
          return new Response("Not a Meta verification request", { status: 400 });
        }

        const { data: ws } = await supabaseAdmin
          .from("workspace_settings" as any)
          .select("meta_verify_token")
          .eq("workspace_id", workspaceId)
          .maybeSingle();

        const stored = (ws as any)?.meta_verify_token as string | null | undefined;
        if (!stored || stored !== token) {
          console.warn("[whatsapp-webhook] Meta verify_token mismatch for workspace", workspaceId);
          return new Response("Forbidden", { status: 403 });
        }

        return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
      },

      // ── Inbound messages (POST) ───────────────────────────────────────────
      POST: async ({ request, params }) => {
        const workspaceId = params.workspaceId;
        if (!/^[0-9a-f-]{36}$/i.test(workspaceId)) {
          return new Response("Bad workspace id", { status: 400, headers: CORS });
        }

        const contentType = request.headers.get("content-type") ?? "";

        // ── Meta JSON payload ─────────────────────────────────────────────
        if (contentType.includes("application/json")) {
          let body: any;
          try { body = await request.json(); } catch {
            return new Response("Bad JSON", { status: 400, headers: CORS });
          }

          if (body?.object !== "whatsapp_business_account") {
            return new Response("OK", { status: 200, headers: CORS });
          }

          for (const entry of body?.entry ?? []) {
            for (const change of entry?.changes ?? []) {
              const value = change?.value;
              if (!value?.messages?.length) continue;

              for (const msg of value.messages) {
                if (msg.type !== "text") continue;

                const from = `+${msg.from}`;
                const msgBody: string = msg.text?.body ?? "";
                const msgId: string = msg.id ?? "";
                const profileName: string | null =
                  value.contacts?.find((c: any) => c.wa_id === msg.from)?.profile?.name ?? null;

                if (!msgBody || !from) continue;

                const { data: lead } = await supabaseAdmin
                  .from("leads")
                  .select("id")
                  .eq("workspace_id", workspaceId)
                  .eq("phone", from)
                  .maybeSingle();

                await supabaseAdmin.from("whatsapp_messages").upsert(
                  {
                    workspace_id:  workspaceId,
                    lead_id:       (lead?.id as string | undefined) ?? null,
                    external_id:   msgId,
                    contact_phone: from,
                    contact_name:  profileName,
                    direction:     "inbound",
                    body:          msgBody,
                    status:        "sent",
                  } as never,
                  { onConflict: "workspace_id,external_id" },
                );

                processWhatsAppMessage({
                  workspaceId,
                  contactPhone: from,
                  contactName:  profileName,
                  inboundBody:  msgBody,
                }).catch((e) => console.error("[whatsapp-webhook] Meta runtime error", e));
              }
            }
          }

          return new Response("EVENT_RECEIVED", { status: 200, headers: CORS });
        }

        // ── Twilio form-urlencoded payload ────────────────────────────────
        const { data: settings } = await supabaseAdmin
          .from("workspace_settings")
          .select("twilio_auth_token")
          .eq("workspace_id", workspaceId)
          .maybeSingle();

        const authToken = settings?.twilio_auth_token as string | null | undefined;
        if (!authToken) {
          return new Response("Twilio auth token not configured", { status: 401, headers: CORS });
        }

        const rawBody = await request.text();
        const form = new URLSearchParams(rawBody);
        const params2: Record<string, string> = {};
        for (const [k, v] of form.entries()) params2[k] = v;

        const url = new URL(request.url);
        const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
        const host  = request.headers.get("x-forwarded-host")  ?? url.host;
        const signedUrl = `${proto}://${host}${url.pathname}${url.search}`;

        const sig = request.headers.get("x-twilio-signature");
        if (!verifyTwilio(signedUrl, params2, sig, authToken)) {
          console.error("[whatsapp-webhook] invalid Twilio signature", { signedUrl });
          return new Response("Invalid signature", { status: 401, headers: CORS });
        }

        const messageSid    = params2.MessageSid || params2.SmsSid;
        const from          = stripWhatsappPrefix(params2.From);
        const to            = stripWhatsappPrefix(params2.To);
        const body          = params2.Body ?? null;
        const profileName   = params2.ProfileName ?? null;
        const numMedia      = Number(params2.NumMedia ?? "0") || 0;
        const mediaUrl      = numMedia > 0 ? (params2.MediaUrl0 ?? null) : null;
        const messageStatus = params2.MessageStatus ?? params2.SmsStatus ?? null;

        if (!body && !mediaUrl && messageStatus && messageSid) {
          const mappedStatus =
            messageStatus === "delivered" ? "delivered" :
            messageStatus === "read"      ? "read" :
            messageStatus === "failed" || messageStatus === "undelivered" ? "failed" : "sent";
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

        const { data: lead } = await supabaseAdmin
          .from("leads")
          .select("id")
          .eq("workspace_id", workspaceId)
          .eq("phone", from)
          .maybeSingle();

        const row = {
          workspace_id:  workspaceId,
          lead_id:       (lead?.id as string | undefined) ?? null,
          external_id:   messageSid,
          contact_phone: from,
          contact_name:  profileName,
          direction:     "inbound" as const,
          body,
          media_url:     mediaUrl,
          status:        "sent" as const,
        };

        const { error } = await supabaseAdmin.from("whatsapp_messages").upsert(row as never, {
          onConflict: "workspace_id,external_id",
        });
        if (error) {
          console.error("[whatsapp-webhook] upsert failed", error.message, { to, from });
          return new Response("db error", { status: 500, headers: CORS });
        }

        if (body) {
          processWhatsAppMessage({
            workspaceId,
            contactPhone: from,
            contactName:  profileName,
            inboundBody:  body,
          }).catch((e) => console.error("[whatsapp-webhook] runtime error", e));
        }

        return new Response(TWIML_OK, { status: 200, headers: TWIML_HEADERS });
      },
    },
  },
});
