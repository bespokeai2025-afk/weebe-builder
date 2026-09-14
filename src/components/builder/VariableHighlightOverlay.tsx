import { useLayoutEffect, useRef, type RefObject } from "react";

const TOKEN = /(\{\{\s*[a-zA-Z_][a-zA-Z0-9_.]*\s*\}\})/g;
/** Separate, non-global copy: `.test()` on a /g regex carries lastIndex between
    calls and would misclassify every other part. */
const IS_TOKEN = /^\{\{\s*[a-zA-Z_][a-zA-Z0-9_.]*\s*\}\}$/;

/**
 * Renders `{{variable}}` as a visible chip behind a transparent textarea.
 *
 * A textarea can only hold plain text, so the Retell-style pill is drawn by a
 * mirror layer sitting exactly underneath: same font, padding, border width,
 * wrapping and scroll offset, with the real textarea on top having transparent
 * text and a visible caret. Get any of those metrics wrong and the highlight
 * drifts away from the characters, so every one of them is pinned here rather
 * than inherited.
 *
 * The textarea stays the single source of truth — this layer is purely
 * decorative and never receives pointer events or focus.
 */
export function VariableHighlightOverlay({
  value,
  textareaRef,
  className,
}: {
  value: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  className?: string;
}) {
  const mirrorRef = useRef<HTMLDivElement>(null);

  // Keep the mirror scrolled in step with the textarea.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    const mirror = mirrorRef.current;
    if (!el || !mirror) return;
    const sync = () => {
      mirror.scrollTop = el.scrollTop;
      mirror.scrollLeft = el.scrollLeft;
    };
    sync();
    el.addEventListener("scroll", sync);
    return () => el.removeEventListener("scroll", sync);
  }, [textareaRef, value]);

  const parts = value.split(TOKEN);

  return (
    <div
      ref={mirrorRef}
      aria-hidden="true"
      className={className}
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        pointerEvents: "none",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        // Colour comes from the chips; the surrounding text is drawn by the
        // textarea itself, so keep it invisible here to avoid double-painting.
        color: "transparent",
      }}
    >
      {parts.map((part, i) =>
        IS_TOKEN.test(part) ? (
          <span
            key={i}
            style={{
              borderRadius: "4px",
              // Padding would shift every following character, so tint only.
              backgroundColor: "rgba(56, 189, 248, 0.22)",
              boxShadow: "inset 0 0 0 1px rgba(56, 189, 248, 0.45)",
              color: "inherit",
            }}
          >
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
      {/* A trailing newline is not rendered by the browser; pad so the mirror
          keeps the same height as the textarea. */}
      {value.endsWith("\n") ? " " : null}
    </div>
  );
}
