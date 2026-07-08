import { useState } from "react";
import { createPortal } from "react-dom";
import { Download, PlayCircle, X } from "lucide-react";

/**
 * Shared call-recording player. Every "Play" button in the app should open
 * this dialog (never a raw <a target="_blank"> to the audio file).
 */
export function RecordingPlayerDialog({
  url,
  contact,
  onClose,
}: {
  url: string;
  contact: string;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Call Recording</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{contact}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <audio controls autoPlay={false} className="w-full" src={url} style={{ colorScheme: "dark" }}>
          Your browser does not support audio playback.
        </audio>
        <a
          href={url}
          download
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md border border-border bg-muted/40 px-4 py-2 text-sm font-medium hover:bg-muted"
        >
          <Download className="h-4 w-4" />
          Download recording
        </a>
      </div>
    </div>
  );
}

/**
 * Self-contained "Play" button that opens the shared recording player.
 * Drop-in replacement for inline recording links in table rows — manages its
 * own open state and renders the dialog in a portal so it isn't clipped by
 * table/overflow containers.
 */
export function PlayRecordingButton({
  url,
  contact,
  className,
  iconClassName = "h-3 w-3",
  label = "Play",
}: {
  url: string;
  contact: string;
  className?: string;
  iconClassName?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className={
          className ??
          "inline-flex items-center gap-1 text-[11px] text-primary hover:underline whitespace-nowrap"
        }
      >
        <PlayCircle className={iconClassName} />
        {label ? <span>{label}</span> : null}
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(
            <RecordingPlayerDialog url={url} contact={contact} onClose={() => setOpen(false)} />,
            document.body,
          )
        : null}
    </>
  );
}
