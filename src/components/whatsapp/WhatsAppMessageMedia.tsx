/**
 * Attachment rendering for one WhatsApp message.
 *
 * Extracted from the inbox so the Listing Leads panel shows the same thing: it previously rendered
 * only `m.body`, so an image or a PDF a seller sent appeared as bare text with no way to view or
 * download it — even though the row already carried the media.
 *
 * WATI never gives a public URL for an inbound attachment, so everything is served through
 * /api/whatsapp/media, which resolves the tenant's storage path server-side. The viewer's access
 * token is needed for that route, which is why this owns the session lookup rather than making
 * every caller pass one in.
 */
import { useEffect, useState } from "react";
import { Download, FileText, Paperclip } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export type MediaMessage = {
  id: string;
  media_url?: string | null;
  media_mime_type?: string | null;
  media_filename?: string | null;
};

/**
 * The viewer's access token, kept in step with the session.
 *
 * Read once on mount originally, which meant every attachment silently 401'd in a tab left open
 * longer than the token's hour.
 */
export function useMediaToken(): string | null {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) setToken(data.session?.access_token ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (active) setToken(session?.access_token ?? null);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);
  return token;
}

export function mediaHref(
  message: MediaMessage,
  token: string | null,
  download = false,
): string | null {
  if (!message.media_url || !token) return null;
  const query = `messageId=${encodeURIComponent(message.id)}&token=${encodeURIComponent(token)}`;
  return `/api/whatsapp/media?${query}${download ? "&download=1" : ""}`;
}

export function WhatsAppMessageMedia({
  message,
  token,
  tone = "light",
}: {
  message: MediaMessage;
  token: string | null;
  /** `onPrimary` when the bubble sits on a filled primary background. */
  tone?: "light" | "onPrimary";
}) {
  if (!message.media_url) return null;

  const src = mediaHref(message, token);
  const downloadSrc = mediaHref(message, token, true);
  const mime = message.media_mime_type ?? "";
  const isImage = mime.startsWith("image/");
  const isAudio = mime.startsWith("audio/");
  const isVideo = mime.startsWith("video/");

  const subtle = tone === "onPrimary" ? "text-primary-foreground/70" : "text-muted-foreground";

  // Token still resolving, or no session: say an attachment exists rather than
  // rendering nothing at all.
  if (!src) {
    return (
      <p className={cn("mb-1 flex items-center gap-1.5 text-[11px]", subtle)}>
        <Paperclip className="h-3 w-3 shrink-0" />
        Attachment
      </p>
    );
  }

  const saveLink = (label: string) => (
    <a
      href={downloadSrc ?? src}
      download={message.media_filename ?? ""}
      className={cn(
        "inline-flex items-center gap-1 text-[10px] underline underline-offset-2",
        subtle,
      )}
    >
      <Download className="h-2.5 w-2.5 shrink-0" />
      {label}
    </a>
  );

  if (isImage) {
    return (
      <div className="mb-1 flex flex-col items-start gap-1">
        <a href={src} target="_blank" rel="noreferrer">
          <img
            src={src}
            alt={message.media_filename ?? "Attachment"}
            className="max-h-56 rounded-lg object-cover"
            loading="lazy"
          />
        </a>
        {saveLink("Save image")}
      </div>
    );
  }

  if (isAudio) {
    return (
      <div className="mb-1 flex flex-col gap-1">
        <audio controls preload="metadata" src={src} className="w-56 max-w-full" />
        {saveLink(message.media_filename ?? "Download voice note")}
      </div>
    );
  }

  if (isVideo) {
    return (
      <div className="mb-1 flex flex-col items-start gap-1">
        <video controls preload="metadata" src={src} className="max-h-56 w-full rounded-lg" />
        {saveLink("Save video")}
      </div>
    );
  }

  // Documents: Open previews it, the icon saves it. `download` alone is ignored
  // cross-origin, so it is paired with the route's own attachment disposition.
  return (
    <div
      className={cn(
        "mb-1 flex items-center gap-2 rounded-lg border px-2 py-1.5",
        tone === "onPrimary"
          ? "border-primary-foreground/25 bg-primary-foreground/10"
          : "border-border bg-muted/40",
      )}
    >
      <FileText className="h-4 w-4 shrink-0 opacity-70" />
      <span className="min-w-0 flex-1 truncate text-[11px]">
        {message.media_filename ?? "Attachment"}
      </span>
      <a
        href={src}
        target="_blank"
        rel="noreferrer"
        className="shrink-0 text-[10px] underline underline-offset-2 opacity-80 hover:opacity-100"
      >
        Open
      </a>
      <a
        href={downloadSrc ?? src}
        download={message.media_filename ?? ""}
        aria-label="Download attachment"
        className="shrink-0 rounded p-0.5 opacity-80 hover:opacity-100"
      >
        <Download className="h-3.5 w-3.5" />
      </a>
    </div>
  );
}
