/**
 * Streams a WhatsApp message attachment to a workspace member.
 *
 * WATI media URLs need the tenant's Bearer token, which must never reach the browser, so the
 * inbox points <img>/<a> at this route instead of the raw URL. The access token travels as a
 * query param because image and download requests can't carry an Authorization header — the same
 * approach the live-calls SSE route uses.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { normalizeWatiApiHost } from "@/lib/whatsapp/wati-api-base.shared";
import { getWatiConnectionForWorkspace } from "@/lib/whatsapp/wati-campaign.server";

/**
 * media_url originates from webhook payloads, so treat it as untrusted and only proxy hosts that
 * actually serve WhatsApp media. Without this the route is an SSRF hole into the private network.
 */
const ALLOWED_MEDIA_HOST_SUFFIXES = [
  ".wati.io",
  ".amazonaws.com",
  ".whatsapp.net",
  ".fbcdn.net",
  "lookaside.fbsbx.com",
];

function isAllowedMediaUrl(raw: string, watiHost: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;

  const host = url.host.toLowerCase();
  if (host === watiHost.toLowerCase()) return url;
  if (ALLOWED_MEDIA_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(suffix))) {
    return url;
  }
  return null;
}

function readBearerToken(request: Request): string | null {
  const url = new URL(request.url);
  const fromQuery = url.searchParams.get("token");
  if (fromQuery) return fromQuery;

  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : null;
}

/** Strip anything that could break out of the Content-Disposition header. */
function safeFilename(name: string | null): string | null {
  const cleaned = (name ?? "").replace(/[^\w.\-() ]/g, "").trim();
  return cleaned ? cleaned.slice(0, 120) : null;
}

function fail(status: number, message: string) {
  return new Response(message, { status, headers: { "Cache-Control": "no-store" } });
}

export const Route = createFileRoute("/api/whatsapp/media")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const messageId = url.searchParams.get("messageId") ?? "";
        const token = readBearerToken(request);

        if (!messageId) return fail(400, "messageId required");
        if (!token) return fail(401, "Unauthorized");

        const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
        const userId = userData?.user?.id;
        if (userErr || !userId) return fail(401, "Unauthorized");

        const { data: message } = await (supabaseAdmin as any)
          .from("whatsapp_messages")
          .select("workspace_id, media_url, media_mime_type, media_filename")
          .eq("id", messageId)
          .maybeSingle();

        if (!message?.media_url) return fail(404, "No media for this message");

        const { data: membership } = await supabaseAdmin
          .from("workspace_members")
          .select("user_id")
          .eq("workspace_id", message.workspace_id)
          .eq("user_id", userId)
          .maybeSingle();
        if (!membership) return fail(403, "Forbidden");

        const conn = await getWatiConnectionForWorkspace(
          supabaseAdmin as any,
          message.workspace_id,
        );
        const watiHost = normalizeWatiApiHost(conn?.api_host);
        const target = isAllowedMediaUrl(String(message.media_url), watiHost);
        if (!target) return fail(400, "Unsupported media host");

        const headers: Record<string, string> = {};
        if (conn?.api_key && target.host.toLowerCase() === watiHost.toLowerCase()) {
          headers.Authorization = `Bearer ${conn.api_key.replace(/^Bearer\s+/i, "")}`;
        }

        let upstream: Response;
        try {
          upstream = await fetch(target.toString(), { headers, redirect: "follow" });
        } catch (e) {
          console.warn("[wa-media] upstream fetch failed", (e as Error).message);
          return fail(502, "Could not load media");
        }

        if (!upstream.ok || !upstream.body) {
          console.warn("[wa-media] upstream returned", upstream.status);
          return fail(502, "Could not load media");
        }

        const filename = safeFilename(message.media_filename);
        return new Response(upstream.body, {
          status: 200,
          headers: {
            "Content-Type":
              upstream.headers.get("content-type") ??
              message.media_mime_type ??
              "application/octet-stream",
            "Cache-Control": "private, max-age=300",
            "X-Content-Type-Options": "nosniff",
            ...(filename ? { "Content-Disposition": `inline; filename="${filename}"` } : {}),
          },
        });
      },
    },
  },
});
