/**
 * Streams a WhatsApp message attachment to a workspace member.
 *
 * WATI never hands out a public URL for an inbound attachment: the webhook carries the tenant's
 * own storage path and the file only comes back from an endpoint authenticated with that tenant's
 * Bearer token, which must never reach the browser. So the inbox points <img>/<audio>/<a> at this
 * route, which resolves the path and streams the bytes. The user's access token travels as a query
 * param because image and download requests can't carry an Authorization header — the same
 * approach the live-calls SSE route uses.
 *
 * `?download=1` serves the file as an attachment rather than inline.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { normalizeWatiApiHost, watiApiV1Base } from "@/lib/whatsapp/wati-api-base.shared";
import {
  getWatiConnectionForWorkspace,
  watiMediaMimeFromPath,
} from "@/lib/whatsapp/wati-campaign.server";

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

/**
 * Inbound WATI attachments are stored as that tenant's own storage path — `data/documents/x.pdf`
 * — not as a URL, because WATI only serves them through an authenticated endpoint. Resolve such a
 * path against the workspace's own tenant so the attachment can be fetched; reject anything that
 * tries to climb out of it or name a different host.
 */
function watiMediaPathUrl(
  raw: string,
  conn: { tenant_id?: string | null; api_host?: string | null } | null,
): URL | null {
  if (!conn?.tenant_id) return null;
  const path = raw.trim().replace(/^\/+/, "");
  if (!path || path.includes("..") || /^[a-z][a-z0-9+.-]*:/i.test(path)) return null;
  const url = new URL(`${watiApiV1Base(String(conn.tenant_id), conn.api_host)}/getMedia`);
  url.searchParams.set("fileName", path);
  return url;
}

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
        const stored = String(message.media_url);
        const target = isAllowedMediaUrl(stored, watiHost) ?? watiMediaPathUrl(stored, conn);
        if (!target) return fail(400, "Unsupported media host");

        const headers: Record<string, string> = {};
        // Only WATI's own host gets the tenant key — never leak it to a CDN redirect target.
        if (conn?.api_key && target.host.toLowerCase() === watiHost.toLowerCase()) {
          headers.Authorization = `Bearer ${conn.api_key.replace(/^Bearer\s+/i, "")}`;
        }
        // Audio and video elements request byte ranges to seek, and Safari
        // refuses to play media served without range support at all. Forward
        // the caller's Range upstream so voice notes are playable, not just
        // downloadable.
        const range = request.headers.get("range");
        if (range) headers.Range = range;

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

        // A document should save to disk when the user clicks "Download", but an
        // image or a voice note has to stay `inline` or the <img>/<audio> element
        // cannot render it. The caller says which it wants.
        const disposition = url.searchParams.get("download") === "1" ? "attachment" : "inline";
        const filename =
          safeFilename(message.media_filename) ?? safeFilename(stored.split("/").pop() ?? null);
        const passthrough: Record<string, string> = {};
        for (const header of ["content-range", "content-length", "accept-ranges"]) {
          const value = upstream.headers.get(header);
          if (value) passthrough[header] = value;
        }
        return new Response(upstream.body, {
          // Mirror 206 so the browser knows partial content came back; a range
          // request answered with a flat 200 leaves the player unable to seek.
          status: upstream.status === 206 ? 206 : 200,
          headers: {
            "Content-Type":
              upstream.headers.get("content-type") ??
              message.media_mime_type ??
              watiMediaMimeFromPath(filename) ??
              "application/octet-stream",
            "Cache-Control": "private, max-age=300",
            "X-Content-Type-Options": "nosniff",
            "Accept-Ranges": "bytes",
            ...passthrough,
            "Content-Disposition": filename
              ? `${disposition}; filename="${filename}"`
              : disposition,
          },
        });
      },
    },
  },
});
